import { addTaskAction, toggleTaskAction } from "@/app/actions";
import type { Task } from "@/lib/db";
import { formatDue, taskDueToIso } from "@/lib/format";

function TaskCell({ t, now }: { t: Task; now: number }) {
  const dueMs = t.due_date ? Date.parse(taskDueToIso(t.due_date)) : null;
  const overdue = dueMs !== null && dueMs < now;
  return (
    <div className="flex w-[240px] flex-none items-start gap-2.5 border-r border-[var(--line)] px-4 py-2.5">
      <form action={toggleTaskAction} className="pt-0.5">
        <input type="hidden" name="id" value={t.id} />
        <button type="submit" className="checkbox" aria-label="完了にする" title="完了にする" />
      </form>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium" title={t.title}>
          {t.url ? (
            <a href={t.url} target="_blank" rel="noopener noreferrer" className="hover:underline" title="元のメールを開く">
              {t.title} <span className="accent">↗</span>
            </a>
          ) : (
            t.title
          )}
        </div>
        <div className={`text-xs ${overdue ? "danger font-semibold" : "muted"}`}>
          {dueMs === null ? "締め切りなし" : `${formatDue(dueMs, now, true)}${overdue ? " 期限切れ" : ""}`}
        </div>
      </div>
    </div>
  );
}

export function TasksBand({ tasks, now }: { tasks: Task[]; now: number }) {
  // Overdue and soonest first; tasks without a date at the end.
  const sorted = [...tasks].sort((a, b) => {
    if (!a.due_date !== !b.due_date) return a.due_date ? -1 : 1;
    return (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.id - b.id;
  });
  return (
    <section className="glass panel flex-none">
      <div className="panel-head">
        <span className="panel-no">01</span>
        <h2 className="panel-title">タスク</h2>
        <span className="badge">{tasks.length}</span>
        <span className="panel-right">締め切り順</span>
      </div>
      <div className="panel-body flex h-[62px] items-stretch overflow-x-auto overflow-y-hidden">
        {sorted.length === 0 && (
          <div className="flex items-center px-4 text-[13px] muted">やることはありません。</div>
        )}
        {sorted.map((t) => (
          <TaskCell key={t.id} t={t} now={now} />
        ))}
        <form action={addTaskAction} className="flex min-w-[380px] flex-1 items-center gap-2 px-4">
          <input name="title" required placeholder="＋ タスクを追加" className="input flex-1" />
          <input name="due_date" type="date" className="input w-[140px]" aria-label="締め切り日" />
          <button type="submit" className="btn btn-primary">
            追加
          </button>
        </form>
      </div>
    </section>
  );
}
