import { Suspense } from "react";
import Link from "next/link";
import { getDashboard } from "@/lib/db";
import { displayName, formatDate, formatDateTime, taskDueToIso } from "@/lib/format";

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;

// Calendar day number in Japan time, so "today"/"tomorrow" follow the local date.
function jstDay(ms: number) {
  return Math.floor((ms + JST_OFFSET_MS) / DAY_MS);
}

// Request time; the page is rendered per request (getDashboard calls connection()).
function requestTime() {
  return Date.now();
}

type Deadline = {
  key: string;
  kind: "課題" | "タスク";
  title: string;
  detail?: string;
  dueMs: number;
  dateOnly: boolean; // tasks have a date but no time
  href: string;
  external: boolean;
};

type Group = { label: string; items: Deadline[]; danger?: boolean };

const cardClass = "rounded-lg border border-black/10 p-4 dark:border-white/15";

function SummaryTile({
  href,
  label,
  value,
  danger,
}: {
  href: string;
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${cardClass} block hover:bg-black/[.03] dark:hover:bg-white/[.05]`}
    >
      <div className="text-sm opacity-75">{label}</div>
      <div
        className={`text-3xl font-semibold ${danger && value > 0 ? "text-red-600 dark:text-red-400" : ""}`}
      >
        {value}
      </div>
    </Link>
  );
}

function DeadlineRow({ d }: { d: Deadline }) {
  const due = d.dateOnly
    ? formatDate(new Date(d.dueMs).toISOString())
    : formatDateTime(new Date(d.dueMs).toISOString());
  return (
    <li className="flex items-baseline gap-3 py-2">
      <span className="shrink-0 rounded bg-black/[.06] px-1.5 text-xs dark:bg-white/[.1]">
        {d.kind}
      </span>
      <div className="min-w-0 flex-1">
        {d.external ? (
          <a href={d.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {d.title}
          </a>
        ) : (
          <Link href={d.href} className="hover:underline">
            {d.title}
          </Link>
        )}
        {d.detail && <div className="truncate text-sm opacity-60">{d.detail}</div>}
      </div>
      <span className="shrink-0 text-sm opacity-75">{due}</span>
    </li>
  );
}

async function Dashboard() {
  const data = await getDashboard();
  const now = requestTime();
  const today = jstDay(now);

  const deadlines: Deadline[] = [
    ...data.pendingAssignments
      .filter((a) => a.due_at)
      .map((a) => ({
        key: `a${a.id}`,
        kind: "課題" as const,
        title: a.title,
        detail: a.course,
        dueMs: Date.parse(a.due_at!),
        dateOnly: false,
        href: a.url ?? "/assignments",
        external: Boolean(a.url),
      })),
    ...data.openTasks
      .filter((t) => t.due_date)
      .map((t) => ({
        key: `t${t.id}`,
        kind: "タスク" as const,
        title: t.title,
        dueMs: Date.parse(taskDueToIso(t.due_date!)),
        dateOnly: true,
        href: "/tasks",
        external: false,
      })),
  ].sort((a, b) => a.dueMs - b.dueMs);

  const overdue = deadlines.filter((d) => d.dueMs < now);
  const upcoming = deadlines.filter((d) => d.dueMs >= now);
  const inDays = (d: Deadline) => jstDay(d.dueMs) - today;
  const groups: Group[] = [
    { label: "期限切れ", items: overdue, danger: true },
    { label: "今日", items: upcoming.filter((d) => inDays(d) === 0) },
    { label: "明日", items: upcoming.filter((d) => inDays(d) === 1) },
    { label: "今週（7 日以内）", items: upcoming.filter((d) => inDays(d) >= 2 && inDays(d) <= 6) },
  ];
  const thisWeek = upcoming.filter((d) => inDays(d) <= 6).length;
  const later = upcoming.length - thisWeek;
  const noDue =
    data.pendingAssignments.filter((a) => !a.due_at).length +
    data.openTasks.filter((t) => !t.due_date).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile href="#deadlines" label="期限切れ" value={overdue.length} danger />
        <SummaryTile href="#deadlines" label="7 日以内の締め切り" value={thisWeek} />
        <SummaryTile href="/mail" label="未読メール" value={data.unreadCount} />
        <SummaryTile href="/tasks" label="未完了タスク" value={data.openTasks.length} />
      </div>

      <section id="deadlines" className={`${cardClass} scroll-mt-4`}>
        <h2 className="font-semibold">締め切り（課題・タスク）</h2>
        {groups.every((g) => g.items.length === 0) ? (
          <p className="mt-2 text-sm opacity-75">7 日以内の締め切りはありません。</p>
        ) : (
          groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.label} className="mt-3">
                <h3
                  className={`text-sm font-semibold ${g.danger ? "text-red-600 dark:text-red-400" : "opacity-75"}`}
                >
                  {g.label}（{g.items.length}）
                </h3>
                <ul className="divide-y divide-black/10 dark:divide-white/15">
                  {g.items.map((d) => (
                    <DeadlineRow key={d.key} d={d} />
                  ))}
                </ul>
              </div>
            ))
        )}
        {(later > 0 || noDue > 0) && (
          <p className="mt-3 text-sm opacity-60">
            {later > 0 && `8 日以降：${later} 件`}
            {later > 0 && noDue > 0 && "・"}
            {noDue > 0 && `締め切りなし：${noDue} 件`}
          </p>
        )}
      </section>

      <section className={cardClass}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">未読メール</h2>
          <Link href="/mail" className="text-sm hover:underline">
            すべて見る
          </Link>
        </div>
        {data.unreadEmails.length === 0 ? (
          <p className="mt-2 text-sm opacity-75">未読メールはありません。</p>
        ) : (
          <ul className="mt-1 divide-y divide-black/10 dark:divide-white/15">
            {data.unreadEmails.map((m) => (
              <li key={m.id} className="flex items-baseline gap-3 py-2">
                <div className="min-w-0 flex-1">
                  {m.url ? (
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline"
                    >
                      {m.subject}
                    </a>
                  ) : (
                    <span className="font-medium">{m.subject}</span>
                  )}
                  <div className="truncate text-sm opacity-60">{displayName(m.sender)}</div>
                </div>
                <span className="shrink-0 text-sm opacity-75">
                  {formatDateTime(m.received_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.unreadCount > data.unreadEmails.length && (
          <p className="mt-2 text-sm opacity-60">
            ほか {data.unreadCount - data.unreadEmails.length} 件
          </p>
        )}
      </section>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">ホーム</h1>
      <Suspense fallback={<p>読み込み中…</p>}>
        <Dashboard />
      </Suspense>
    </div>
  );
}
