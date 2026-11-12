import { Suspense } from "react";
import { revalidatePath } from "next/cache";
import { displayName, formatDateTime } from "@/lib/format";
import { connection } from "next/server";
import Link from "next/link";
import { HideButton } from "@/app/hide-button";
import {
  countHidden,
  clearOAuthToken,
  getConnectedAccount,
  getLastSync,
  listEmails,
  recordSync,
  replaceEmails,
} from "@/lib/db";
import { fetchInbox, getGoogleConfig, GoogleError } from "@/lib/google";

const SOURCE = "gmail";

async function syncFromGmail() {
  "use server";
  const config = getGoogleConfig();
  if (!config) {
    recordSync(SOURCE, false, "Google の設定がありません。設定画面で入力してください。");
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
          ? "Gmail との接続が切れています。設定画面で「Gmail に接続」を押してください。"
          : e instanceof Error
            ? e.message
            : "不明なエラー";
      recordSync(SOURCE, false, `取り込みに失敗しました：${msg}`);
    }
  }
  revalidatePath("/mail");
}

const buttonClass = "rounded bg-foreground px-4 py-2 text-background";

async function SyncPanel() {
  await connection();
  const connected = getGoogleConfig() !== null && (await getConnectedAccount("google")) !== null;
  const last = await getLastSync(SOURCE);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
      {connected ? (
        <form action={syncFromGmail}>
          <button type="submit" className={buttonClass}>
            Gmail から取り込む
          </button>
        </form>
      ) : (
        <p className="text-sm">
          Gmail はまだ接続されていません。
          <Link href="/settings" className="font-medium underline">
            設定
          </Link>
          から接続してください。
        </p>
      )}
      {last && (
        <p className={`text-sm ${last.ok ? "opacity-75" : "text-red-600 dark:text-red-400"}`}>
          {formatDateTime(last.synced_at)}：{last.message}
        </p>
      )}
    </div>
  );
}

function HiddenNote({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="mt-2 text-sm opacity-60">
      非表示 {count} 件（
      <Link href="/settings#hidden" className="underline">
        設定
      </Link>
      で戻せます）
    </p>
  );
}

async function EmailList() {
  const emails = await listEmails();
  const hiddenCount = await countHidden("emails");
  if (emails.length === 0) {
    return (
      <div>
        <p className="opacity-75">メールはまだありません。</p>
        <HiddenNote count={hiddenCount} />
      </div>
    );
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
              <span className="shrink-0 text-sm opacity-60">{formatDateTime(m.received_at)}</span>
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
            <div className="mt-1 flex flex-wrap gap-1">
              <HideButton kind="email" value={m.gmail_id} label={m.subject}>
                非表示
              </HideButton>
              {m.sender_address && (
                <HideButton
                  kind="sender"
                  value={m.sender_address}
                  label={
                    displayName(m.sender).toLowerCase() === m.sender_address
                      ? m.sender_address
                      : `${displayName(m.sender)}（${m.sender_address}）`
                  }
                >
                  この差出人を非表示
                </HideButton>
              )}
            </div>
          </li>
        ))}
      </ul>
      <HiddenNote count={hiddenCount} />
    </section>
  );
}

export default function MailPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">メール</h1>
      <Suspense fallback={<p>読み込み中…</p>}>
        <SyncPanel />
      </Suspense>
      <Suspense fallback={<p>読み込み中…</p>}>
        <EmailList />
      </Suspense>
    </div>
  );
}
