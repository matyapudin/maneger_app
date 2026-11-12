import Link from "next/link";
import { getLastSync, type Assignment, type Task } from "@/lib/db";
import {
  formatAgo,
  formatDue,
  formatRemaining,
  jstDate,
  jstDay,
  taskDueToIso,
  WEEKDAYS,
} from "@/lib/format";
import { AutoRefresh, RefreshButton } from "@/components/refresh";
import { lastImportedAt } from "@/lib/sync";

type Deadline = { title: string; dueMs: number; dateOnly: boolean };

// The next thing due that hasn't passed yet.
function nextDeadline(assignments: Assignment[], tasks: Task[], now: number): Deadline | null {
  const all: Deadline[] = [
    ...assignments
      .filter((a) => a.due_at)
      .map((a) => ({ title: a.title, dueMs: Date.parse(a.due_at!), dateOnly: false })),
    ...tasks
      .filter((t) => t.due_date)
      .map((t) => ({ title: t.title, dueMs: Date.parse(taskDueToIso(t.due_date!)), dateOnly: true })),
  ].filter((d) => d.dueMs >= now);
  all.sort((a, b) => a.dueMs - b.dueMs);
  return all[0] ?? null;
}

export async function TopBar({
  pendingAssignments,
  openTasks,
  now,
}: {
  pendingAssignments: Assignment[];
  openTasks: Task[];
  now: number;
}) {
  const today = jstDate(jstDay(now));
  const next = nextDeadline(pendingAssignments, openTasks, now);
  const syncs = (await Promise.all([getLastSync("aims"), getLastSync("gmail")])).filter(
    (s) => s !== null,
  );
  const imported = [lastImportedAt("aims"), lastImportedAt("gmail")].filter((t) => t !== null);
  const errors = syncs.filter((s) => !s.ok);

  return (
    <header className="glass flex h-[52px] flex-none items-center gap-5 px-5">
      <div className="flex items-center gap-2.5 text-[14px] font-bold tracking-[0.2em]">
        <span className="grid h-[22px] w-[22px] place-items-center bg-[var(--accent)] text-[12px] tracking-normal text-white">
          M
        </span>
        MANAGER
      </div>
      <div className="border-l border-[var(--line)] pl-4 font-medium">
        {today.getUTCMonth() + 1}月{today.getUTCDate()}日（{WEEKDAYS[today.getUTCDay()]}）
      </div>
      {next && (
        <div className="min-w-0 truncate border-l-[3px] border-[var(--danger)] bg-white px-3 py-1 text-[13px]">
          次の締め切り <b className="danger">{next.title}</b> {formatDue(next.dueMs, now, next.dateOnly)} ・{" "}
          {formatRemaining(next.dueMs, now)}
        </div>
      )}
      <div className="flex-1" />
      {errors.length > 0 && (
        <Link href="/settings" className="max-w-[360px] truncate text-xs danger underline" title={errors.map((e) => e.message).join("\n")}>
          ⚠ {errors[0].message}
        </Link>
      )}
      <AutoRefresh />
      {imported.length > 0 && (
        <span className="text-xs muted">
          {formatAgo(Math.min(...imported), now).replace(/前$/, "前に")}更新
        </span>
      )}
      <RefreshButton />
      <Link href="/settings" className="btn btn-icon" title="設定" aria-label="設定">
        ⚙
      </Link>
    </header>
  );
}
