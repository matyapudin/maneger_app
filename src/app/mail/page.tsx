import { Suspense } from "react";
import { listEmails } from "@/lib/db";

async function EmailList() {
  const emails = await listEmails();
  if (emails.length === 0) {
    return (
      <p className="opacity-75">
        メールはまだありません。Gmail 連携は今後追加します。
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/15">
      {emails.map((m) => (
        <li key={m.id} className="py-2">
          <div className={m.is_read ? "" : "font-semibold"}>{m.subject}</div>
          <div className="text-sm opacity-60">
            {m.sender} ・ {m.received_at}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function MailPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">メール</h1>
      <Suspense fallback={<p>読み込み中…</p>}>
        <EmailList />
      </Suspense>
    </div>
  );
}
