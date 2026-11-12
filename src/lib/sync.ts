// Importing from AIMS and Gmail, shared by the refresh button and auto refresh.
import {
  clearOAuthToken,
  clearServiceToken,
  getConnectedAccount,
  getServiceToken,
  getSetting,
  pendingDeadlines,
  recordSync,
  replaceCalendarEvents,
  setSetting,
  replaceAssignments,
  replaceEmails,
  replaceSuggestions,
} from "@/lib/db";
import { extractDates } from "@/lib/date-extract";
import { fetchCalendarEvents, writeDeadlines, writeDeadlinesEnabled } from "@/lib/calendar";
import { fetchInbox, getGoogleConfig, GoogleError, hasCalendarAccess } from "@/lib/google";
import { AIMS_SERVICE, fetchAssignments, getMoodleConfig, MoodleError } from "@/lib/moodle";

// When each source was last imported (success or failure). Kept apart from
// the status messages, which connecting / disconnecting also write.
const importedKey = (source: string) => `imported_at:${source}`;

type Source = "aims" | "gmail" | "calendar";

export function lastImportedAt(source: Source): number | null {
  const v = getSetting(importedKey(source));
  return v ? Number(v) : null;
}

function markImported(source: Source) {
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
    // Dates written in each email become task suggestions (never added
    // automatically; the user adds them from the mail panel).
    const now = Date.now();
    replaceSuggestions(
      items.flatMap((m) =>
        extractDates(`${m.subject}\n${m.bodyText}`, Date.parse(m.receivedAt), now).map((f) => ({
          gmailId: m.gmailId,
          ...f,
        })),
      ),
    );
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

function calendarErrorMessage(e: unknown) {
  if (e instanceof GoogleError && e.code === "api_disabled") {
    return "Google Calendar API が有効になっていません。Google Cloud で有効にしてください（README の手順）。";
  }
  if (e instanceof GoogleError && e.code === "insufficient_scope") {
    return "カレンダーの許可がありません。設定画面で「カレンダーの許可を追加」を押してください。";
  }
  return e instanceof Error ? e.message : "不明なエラー";
}

// Reads events into the calendar panel, then writes AIMS deadlines.
export async function syncCalendar(): Promise<void> {
  const config = getGoogleConfig();
  if (!config || !(await getConnectedAccount("google")) || !hasCalendarAccess()) return;
  markImported("calendar");
  try {
    const events = await fetchCalendarEvents(config);
    replaceCalendarEvents(events);
    let message = `${events.length} 件の予定を取り込みました。`;
    if (writeDeadlinesEnabled()) {
      const w = await writeDeadlines(config, pendingDeadlines());
      const changes = [
        w.added && `${w.added} 件追加`,
        w.updated && `${w.updated} 件更新`,
        w.removed && `${w.removed} 件削除`,
      ].filter(Boolean);
      if (changes.length) message += `締め切りをカレンダーに ${changes.join("・")}しました。`;
    }
    recordSync("calendar", true, message);
  } catch (e) {
    if (e instanceof GoogleError && e.needsReconnect) {
      clearOAuthToken("google");
      recordSync("calendar", false, "Google との接続が切れました。設定画面で「Gmail に接続」を押してください。");
    } else {
      recordSync("calendar", false, `カレンダーの取り込みに失敗しました：${calendarErrorMessage(e)}`);
    }
  }
}

export async function syncAll(): Promise<void> {
  await Promise.all([syncAims(), syncGmail()]);
  // After AIMS, so the deadlines written to the calendar are up to date.
  await syncCalendar();
}

// Data counts as stale after this long; opening the app then refreshes it.
export const STALE_AFTER_MS = 10 * 60 * 1000;

// True when a connected source was never imported or imported too long ago.
export async function isStale(now: number): Promise<boolean> {
  const sources: Source[] = [];
  if (getServiceToken(AIMS_SERVICE)) sources.push("aims");
  if (getGoogleConfig() && (await getConnectedAccount("google"))) {
    sources.push("gmail");
    if (hasCalendarAccess()) sources.push("calendar");
  }
  return sources.some((s) => {
    const last = lastImportedAt(s);
    return last === null || now - last > STALE_AFTER_MS;
  });
}
