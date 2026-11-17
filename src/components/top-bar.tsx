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
import { BgmPlayer } from "@/components/bgm-player";
import { FocusTimer } from "@/components/focus-timer";
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
  const syncs = (
    await Promise.all([getLastSync("aims"), getLastSync("gmail"), getLastSync("calendar")])
  ).filter(
    (s) => s !== null,
  );
  const imported = [lastImportedAt("aims"), lastImportedAt("gmail")].filter((t) => t !== null);
  const errors = syncs.filter((s) => !s.ok);

  return (
    // Everything stays on one line; only the next-deadline text shrinks (…).
    <header className="glass flex h-[52px] flex-none items-center gap-3 px-4 whitespace-nowrap [&>*]:flex-none 2xl:gap-4 2xl:px-5">
      <div className="flex items-center gap-2.5 text-[14px] font-bold tracking-[0.2em]">
        <span className="grid h-[22px] w-[22px] place-items-center bg-[var(--accent)] text-[12px] tracking-normal text-white">
          M
        </span>
        {/* The word is hidden on narrow screens; the M logo stays. */}
        <span className="hidden 2xl:inline">MANAGER</span>
      </div>
      <div className="border-l border-[var(--line)] pl-3 font-medium">
        {today.getUTCMonth() + 1}月{today.getUTCDate()}日（{WEEKDAYS[today.getUTCDay()]}）
      </div>
      {next ? (
        <div
          className="min-w-0 !flex-1 truncate border-l-[3px] border-[var(--danger)] bg-white px-3 py-1 text-[13px]"
          title={`次の締め切り：${next.title} ${formatDue(next.dueMs, now, next.dateOnly)}`}
        >
          次の締め切り <b className="danger">{next.title}</b> {formatDue(next.dueMs, now, next.dateOnly)} ・{" "}
          {formatRemaining(next.dueMs, now)}
        </div>
      ) : (
        <div className="!flex-1" />
      )}
      {errors.length > 0 && (
        // Short label; the full messages show on hover and on 設定.
        <Link
          href="/settings"
          className="text-xs font-semibold danger underline"
          title={errors.map((e) => e.message).join("\n")}
        >
          ⚠ エラー{errors.length > 1 ? ` ${errors.length}` : ""}
        </Link>
      )}
      <AutoRefresh />
      {imported.length > 0 && (
        <span className="hidden text-xs muted 2xl:inline">
          {formatAgo(Math.min(...imported), now).replace(/前$/, "前に")}更新
        </span>
      )}
      <RefreshButton />
      <span className="h-6 border-l border-[var(--line)]" aria-hidden />
      <FocusTimer />
      <BgmPlayer />
      <Link href="/settings" className="btn btn-icon" title="設定" aria-label="設定">
        ⚙
      </Link>
    </header>
  );
}
