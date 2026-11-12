import Link from "next/link";
import { setAssignmentStatusAction } from "@/app/actions";
import { HideButton } from "@/app/hide-button";
import { assignmentState, type Assignment, type AssignmentState } from "@/lib/db";
import { courseColor, formatDue } from "@/lib/format";

const stateLabel: Record<Exclude<AssignmentState, "pending">, string> = {
  submitted: "提出済み",
  done: "完了",
  not_required: "提出不要",
};

function StatusButton({ id, status, label }: { id: number; status: string; label: string }) {
  return (
    <form action={setAssignmentStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className="btn btn-xs">
        {label}
      </button>
    </form>
  );
}

function Title({ a }: { a: Assignment }) {
  return a.url ? (
    <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
      {a.title}
    </a>
  ) : (
    <>{a.title}</>
  );
}

function PendingRow({ a, now }: { a: Assignment; now: number }) {
  const dueMs = a.due_at ? Date.parse(a.due_at) : null;
  const overdue = dueMs !== null && dueMs < now;
  const soon = dueMs !== null && !overdue && dueMs - now < 86_400_000;
  return (
    <li className="row flex items-start gap-2.5 px-[18px] py-1.5">
      <form action={setAssignmentStatusAction} className="pt-[3px]">
        <input type="hidden" name="id" value={a.id} />
        <input type="hidden" name="status" value="done" />
        <button type="submit" className="checkbox" aria-label="完了にする" title="完了にする" />
      </form>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">
          <Title a={a} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={overdue ? "danger font-semibold" : soon ? "accent font-semibold" : "muted"}>
            {dueMs === null ? "締め切りなし" : formatDue(dueMs, now)}
          </span>
          {overdue && <span className="badge badge-red">期限切れ</span>}
          <span className="row-actions">
            <StatusButton id={a.id} status="not_required" label="提出不要" />
            {a.source_id && (
              <HideButton kind="assignment" value={a.source_id} label={`${a.course}：${a.title}`}>
                非表示
              </HideButton>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

function OtherRow({ a }: { a: Assignment }) {
  const state = assignmentState(a) as Exclude<AssignmentState, "pending">;
  const userSet = a.user_status !== null && state !== "submitted";
  return (
    <li className="row flex items-center gap-2.5 px-[18px] py-1 text-[12.5px] muted">
      <span className="badge flex-none">{stateLabel[state]}</span>
      <span className="min-w-0 flex-1 truncate">
        <Title a={a} />
      </span>
      <span className="row-actions flex-none">
        {userSet && <StatusButton id={a.id} status="" label="元に戻す" />}
        {a.source_id && (
          <HideButton kind="assignment" value={a.source_id} label={`${a.course}：${a.title}`}>
            非表示
          </HideButton>
        )}
      </span>
    </li>
  );
}

type Group = { course: string; pending: Assignment[]; other: Assignment[] };

export function AimsPanel({
  assignments,
  connected,
  hiddenCount,
  now,
}: {
  assignments: Assignment[];
  connected: boolean;
  hiddenCount: number;
  now: number;
}) {
  const byCourse = new Map<string, Group>();
  for (const a of assignments) {
    const g = byCourse.get(a.course) ?? { course: a.course, pending: [], other: [] };
    (assignmentState(a) === "pending" ? g.pending : g.other).push(a);
    byCourse.set(a.course, g);
  }
  for (const g of byCourse.values()) {
    g.pending.sort((x, y) => (x.due_at ?? "9").localeCompare(y.due_at ?? "9"));
  }
  const earliest = (g: Group) =>
    Math.min(...g.pending.map((a) => (a.due_at ? Date.parse(a.due_at) : Infinity)));
  const groups = [...byCourse.values()].sort((x, y) => {
    if (!!x.pending.length !== !!y.pending.length) return x.pending.length ? -1 : 1;
    return earliest(x) - earliest(y) || x.course.localeCompare(y.course, "ja");
  });
  const active = groups.filter((g) => g.pending.length > 0);
  const idle = groups.filter((g) => g.pending.length === 0);
  const pendingCount = active.reduce((n, g) => n + g.pending.length, 0);
  const overdueCount = active.reduce(
    (n, g) => n + g.pending.filter((a) => a.due_at && Date.parse(a.due_at) < now).length,
    0,
  );

  return (
    <section className="glass panel">
      <div className="panel-head">
        <span className="panel-no">04</span>
        <h2 className="panel-title">AIMS 課題</h2>
        {pendingCount > 0 && <span className="badge">未提出 {pendingCount}</span>}
        {overdueCount > 0 && <span className="badge badge-red">期限切れ {overdueCount}</span>}
        <span className="panel-right">
          {hiddenCount > 0 && (
            <Link href="/settings#hidden" className="hover:underline">
              非表示 {hiddenCount}
            </Link>
          )}
        </span>
      </div>
      <div className="panel-body">
        {!connected && assignments.length === 0 ? (
          <p className="empty">
            AIMS はまだ接続されていません。<Link href="/settings">設定</Link>から接続してください。
          </p>
        ) : assignments.length === 0 ? (
          <p className="empty">課題はまだありません。右上の ↻ で取り込めます。</p>
        ) : (
          <>
            {active.map((g) => (
              <div key={g.course} className="border-b border-[var(--line)] py-1.5">
                <div className="row flex items-center gap-2 px-[18px] py-1.5">
                  <span className="dot" style={{ background: courseColor(g.course) }} />
                  <span className="min-w-0 truncate text-[13px] font-bold">{g.course}</span>
                  <span className="row-actions">
                    <HideButton kind="course" value={g.course} label={g.course}>
                      この授業を非表示
                    </HideButton>
                  </span>
                  <span className="ml-auto flex-none text-[11px] muted">{g.pending.length} 件</span>
                </div>
                <ul>
                  {g.pending.map((a) => (
                    <PendingRow key={a.id} a={a} now={now} />
                  ))}
                </ul>
                {g.other.length > 0 && (
                  <details className="px-[18px] pt-0.5 text-[12px] muted">
                    <summary className="cursor-pointer select-none">
                      提出済み・提出不要 {g.other.length} 件
                    </summary>
                    <ul className="-mx-[18px]">
                      {g.other.map((a) => (
                        <OtherRow key={a.id} a={a} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
            {idle.length > 0 && (
              <details className="m-[18px] border border-dashed border-[var(--line)] px-3 py-2 text-[12.5px] muted">
                <summary className="cursor-pointer select-none">
                  やることがない授業 {idle.length} 件（{idle.map((g) => g.course).join("・")}）
                </summary>
                {idle.map((g) => (
                  <div key={g.course} className="mt-2">
                    <div className="row flex items-center gap-2 py-1">
                      <span className="dot" style={{ background: courseColor(g.course) }} />
                      <span className="font-semibold text-[var(--text)]">{g.course}</span>
                      <span className="row-actions">
                        <HideButton kind="course" value={g.course} label={g.course}>
                          この授業を非表示
                        </HideButton>
                      </span>
                    </div>
                    <ul className="-mx-[18px]">
                      {g.other.map((a) => (
                        <OtherRow key={a.id} a={a} />
                      ))}
                    </ul>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
