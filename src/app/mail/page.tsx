import { Suspense } from "react";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import {
  clearEmails,
  clearOAuthToken,
  getConnectedAccount,
  getLastSync,
  listEmails,
  recordSync,
  replaceEmails,
} from "@/lib/db";
import { disconnect, fetchInbox, getGoogleConfig, GoogleError } from "@/lib/google";

const SOURCE = "gmail";

async function syncFromGmail() {
  "use server";
  const config = getGoogleConfig();
  if (!config) {
    recordSync(SOURCE, false, "Google の設定（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）がありません。");
  } else {
    try {
      const items = await fetchInbox(config);
      replaceEmails(items);
      recordSync(SOURCE, true, `${items.length} 件のメールを取り込みました。`);
    } catch (e) {
      // The saved login no longer works: forget it so the "connect" button shows again.
      if (e instanceof GoogleError && e.needsReconnect) clearOAuthToken("google");
      const msg =
        e instanceof GoogleError && e.needsReconnect
          ? "Gmail との接続が切れています。もう一度「Gmail に接続」を押してください。"
          : e instanceof Error
            ? e.message
            : "不明なエラー";
      recordSync(SOURCE, false, `取り込みに失敗しました：${msg}`);
    }
  }
  revalidatePath("/mail");
}

async function disconnectGmail() {
  "use server";
  await disconnect();
  clearEmails();
  recordSync(SOURCE, true, "Gmail との接続を解除しました。");
  revalidatePath("/mail");
}

const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(iso: string) {
  return dateFmt.format(new Date(iso));
}

// "Taro <taro@example.com>" -> "Taro"
function displayName(from: string) {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return m ? m[1] : from;
}

const buttonClass = "rounded bg-foreground px-4 py-2 text-background";
const subtleButtonClass =
  "rounded border border-black/20 px-4 py-2 dark:border-white/25";

async function ConnectionPanel() {
  await connection();
  const configured = getGoogleConfig() !== null;
  const account = await getConnectedAccount("google");
  const last = await getLastSync(SOURCE);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
      {!configured ? (
        <p className="text-sm">
          Gmail と連携するには、<code>.env.local</code> に <code>GOOGLE_CLIENT_ID</code> と{" "}
          <code>GOOGLE_CLIENT_SECRET</code> を設定してください（README を参照）。
        </p>
      ) : account ? (
        <>
          <p className="text-sm">
            接続中：<span className="font-medium">{account}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={syncFromGmail}>
              <button type="submit" className={buttonClass}>
                Gmail から取り込む
              </button>
            </form>
            <form action={disconnectGmail}>
              <button type="submit" className={subtleButtonClass}>
                接続を解除
              </button>
            </form>
          </div>
        </>
      ) : (
        <div>
          {/* A plain link: the route redirects the browser to Google. */}
          <a href="/api/auth/google" className={`inline-block ${buttonClass}`}>
            Gmail に接続
          </a>
        </div>
      )}
      {last && (
        <p className={`text-sm ${last.ok ? "opacity-75" : "text-red-600 dark:text-red-400"}`}>
          {formatDate(last.synced_at)}：{last.message}
        </p>
      )}
    </div>
  );
}

async function EmailList() {
  const emails = await listEmails();
  if (emails.length === 0) {
    return <p className="opacity-75">メールはまだありません。</p>;
  }
  const unread = emails.filter((m) => !m.is_read).length;
  return (
    <section>
      <h2 className="font-semibold">
        受信トレイ（{emails.length} 件・未読 {unread} 件）
      </h2>
      <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/15">
        {emails.map((m) => (
          <li key={m.id} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`truncate ${m.is_read ? "" : "font-semibold"}`}>
                {displayName(m.sender)}
              </span>
              <span className="shrink-0 text-sm opacity-60">{formatDate(m.received_at)}</span>
            </div>
            <div className={m.is_read ? "" : "font-semibold"}>
              {m.url ? (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {m.subject}
                </a>
              ) : (
                m.subject
              )}
            </div>
            {m.snippet && <div className="truncate text-sm opacity-60">{m.snippet}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MailPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">メール</h1>
      <Suspense fallback={<p>読み込み中…</p>}>
        <ConnectionPanel />
      </Suspense>
      <Suspense fallback={<p>読み込み中…</p>}>
        <EmailList />
      </Suspense>
    </div>
  );
}
