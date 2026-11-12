import Link from "next/link";
import { HideButton } from "@/app/hide-button";
import type { Email } from "@/lib/db";
import { displayName, formatDue, jstDay, senderColor } from "@/lib/format";

function senderLabel(m: Email) {
  const name = displayName(m.sender);
  return m.sender_address && name.toLowerCase() !== m.sender_address
    ? `${name}（${m.sender_address}）`
    : (m.sender_address ?? name);
}

function MailRow({ m, now }: { m: Email; now: number }) {
  const name = displayName(m.sender);
  const ms = Date.parse(m.received_at);
  const when = jstDay(ms) === jstDay(now) ? formatDue(ms, now).replace("今日 ", "") : formatDue(ms, now, true);
  const unread = !m.is_read;
  return (
    <li className="row flex gap-2.5 border-b border-[var(--line)] px-[18px] py-2.5">
      <span className={`mt-3 h-1.5 w-1.5 flex-none ${unread ? "bg-[var(--accent)]" : ""}`} />
      <span
        className="grid h-7 w-7 flex-none place-items-center text-[11px] font-bold text-white"
        style={{ background: unread ? senderColor(m.sender_address ?? name) : "#94a3b8" }}
      >
        {name.trim().charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`truncate text-[13px] ${unread ? "font-semibold" : "muted"}`}>{name}</span>
          <span className="ml-auto flex-none text-[11.5px] muted tabular-nums">{when}</span>
        </div>
        <div className={`truncate text-[13px] ${unread ? "" : "muted"}`}>
          {m.url ? (
            <a href={m.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {m.subject}
            </a>
          ) : (
            m.subject
          )}
        </div>
        <div className="flex items-center gap-2">
          {m.snippet && <div className="min-w-0 flex-1 truncate text-xs muted">{m.snippet}</div>}
          <div className="row-actions ml-auto flex-none">
            <HideButton kind="email" value={m.gmail_id} label={m.subject}>
              非表示
            </HideButton>
            {m.sender_address && (
              <HideButton kind="sender" value={m.sender_address} label={senderLabel(m)}>
                この差出人を非表示
              </HideButton>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export function MailPanel({
  emails,
  connected,
  primaryOnly,
  hiddenCount,
  now,
}: {
  emails: Email[];
  connected: boolean;
  primaryOnly: boolean;
  hiddenCount: number;
  now: number;
}) {
  const unread = emails.filter((m) => !m.is_read).length;
  return (
    <section className="glass panel">
      <div className="panel-head">
        <span className="panel-no">02</span>
        <h2 className="panel-title">メール</h2>
        {unread > 0 && <span className="badge">未読 {unread}</span>}
        <span className="panel-right">
          {primaryOnly && <span>メインのみ</span>}
          {hiddenCount > 0 && (
            <Link href="/settings#hidden" className="hover:underline">
              非表示 {hiddenCount}
            </Link>
          )}
        </span>
      </div>
      <div className="panel-body">
        {!connected ? (
          <p className="empty">
            Gmail はまだ接続されていません。<Link href="/settings">設定</Link>から接続してください。
          </p>
        ) : emails.length === 0 ? (
          <p className="empty">メールはまだありません。右上の ↻ で取り込めます。</p>
        ) : (
          <ul>
            {emails.map((m) => (
              <MailRow key={m.id} m={m} now={now} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
