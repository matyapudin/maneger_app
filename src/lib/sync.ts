// Importing from AIMS and Gmail, shared by the refresh button and auto refresh.
import {
  clearOAuthToken,
  clearServiceToken,
  getConnectedAccount,
  getServiceToken,
  getSetting,
  recordSync,
  setSetting,
  replaceAssignments,
  replaceEmails,
} from "@/lib/db";
import { fetchInbox, getGoogleConfig, GoogleError } from "@/lib/google";
import { AIMS_SERVICE, fetchAssignments, getMoodleConfig, MoodleError } from "@/lib/moodle";

// When each source was last imported (success or failure). Kept apart from
// the status messages, which connecting / disconnecting also write.
const importedKey = (source: string) => `imported_at:${source}`;

export function lastImportedAt(source: "aims" | "gmail"): number | null {
  const v = getSetting(importedKey(source));
  return v ? Number(v) : null;
}

function markImported(source: "aims" | "gmail") {
  setSetting(importedKey(source), String(Date.now()));
}

export async function syncAims(): Promise<void> {
  const config = getMoodleConfig();
  if (!config) return; // not connected: nothing to do
  markImported("aims");
  try {
    const items = await fetchAssignments(config);
    replaceAssignments("aims-", items);
    recordSync("aims", true, `${items.length} 件の課題を取り込みました。`);
  } catch (e) {
    if (e instanceof MoodleError && e.code === "invalidtoken") {
      // The saved key no longer works: forget it so 設定 shows the login form.
      clearServiceToken(AIMS_SERVICE);
      recordSync("aims", false, "AIMS との接続が切れました。設定画面でもう一度ログインしてください。");
    } else {
      recordSync("aims", false, `AIMS の取り込みに失敗しました：${e instanceof Error ? e.message : "不明なエラー"}`);
    }
  }
}

export async function syncGmail(): Promise<void> {
  const config = getGoogleConfig();
  if (!config || !(await getConnectedAccount("google"))) return; // not connected
  markImported("gmail");
  try {
    const items = await fetchInbox(config);
    replaceEmails(items);
    recordSync("gmail", true, `${items.length} 件のメールを取り込みました。`);
  } catch (e) {
    if (e instanceof GoogleError && e.needsReconnect) {
      clearOAuthToken("google");
      recordSync("gmail", false, "Gmail との接続が切れました。設定画面で「Gmail に接続」を押してください。");
    } else {
      recordSync("gmail", false, `Gmail の取り込みに失敗しました：${e instanceof Error ? e.message : "不明なエラー"}`);
    }
  }
}

export async function syncAll(): Promise<void> {
  await Promise.all([syncAims(), syncGmail()]);
}

// Data counts as stale after this long; opening the app then refreshes it.
export const STALE_AFTER_MS = 10 * 60 * 1000;

// True when a connected source was never imported or imported too long ago.
export async function isStale(now: number): Promise<boolean> {
  const sources: ("aims" | "gmail")[] = [];
  if (getServiceToken(AIMS_SERVICE)) sources.push("aims");
  if (getGoogleConfig() && (await getConnectedAccount("google"))) sources.push("gmail");
  return sources.some((s) => {
    const last = lastImportedAt(s);
    return last === null || now - last > STALE_AFTER_MS;
  });
}
