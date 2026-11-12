import Link from "next/link";
import type { Assignment, Task } from "@/lib/db";
import {
  courseColor,
  formatTime,
  jstDate,
  jstDay,
  taskDueToIso,
  weekStart,
  WEEKDAYS,
} from "@/lib/format";

type CalItem = {
  key: string;
  title: string;
  sub: string;
  ms: number;
  allDay: boolean;
  color: string;
  href: string | null;
};

function items(assignments: Assignment[], tasks: Task[]): CalItem[] {
  return [
    ...assignments
      .filter((a) => a.due_at)
      .map((a) => ({
        key: `a${a.id}`,
        title: `${a.title}〆`,
        sub: a.course,
        ms: Date.parse(a.due_at!),
        allDay: false,
        color: courseColor(a.course),
        href: a.url,
      })),
    ...tasks
      .filter((t) => t.due_date)
      .map((t) => ({
        key: `t${t.id}`,
        title: t.title,
        sub: "タスク",
        ms: Date.parse(taskDueToIso(t.due_date!)),
        allDay: true,
        color: "#64748b",
        href: null,
      })),
  ];
}

function Chip({ it, now }: { it: CalItem; now: number }) {
  const overdue = it.ms < now;
  const body = (
    <>
      <b className="block truncate font-semibold">{it.title}</b>
      <span className="block truncate opacity-75">
        {it.allDay ? "終日" : formatTime(it.ms)} ・ {it.sub}
      </span>
    </>
  );
  const style = {
    borderLeftColor: overdue ? "var(--danger)" : it.color,
    background: overdue ? "var(--danger-soft)" : `color-mix(in srgb, ${it.color} 10%, white)`,
  };
  const cls = "block border-l-2 px-1.5 py-1 text-[11px] leading-[1.35]";
  return it.href ? (
    <a href={it.href} target="_blank" rel="noopener noreferrer" className={`${cls} hover:brightness-95`} style={style} title={`${it.title}（${it.sub}）`}>
      {body}
    </a>
  ) : (
    <div className={cls} style={style} title={`${it.title}（${it.sub}）`}>
      {body}
    </div>
  );
}

export function CalendarPanel({
  assignments,
  tasks,
  now,
  weekOffset,
}: {
  assignments: Assignment[];
  tasks: Task[];
  now: number;
  weekOffset: number;
}) {
  const today = jstDay(now);
  const start = weekStart(today) + weekOffset * 7;
  const days = Array.from({ length: 7 }, (_, i) => start + i);
  const all = items(assignments, tasks);
  const first = jstDate(start);
  const last = jstDate(start + 6);
  const range = `${first.getUTCMonth() + 1}/${first.getUTCDate()} – ${last.getUTCMonth() + 1}/${last.getUTCDate()}`;
  const label = weekOffset === 0 ? "今週" : weekOffset === 1 ? "来週" : weekOffset === -1 ? "先週" : null;

  return (
    <section className="glass panel">
      <div className="panel-head">
        <span className="panel-no">03</span>
        <h2 className="panel-title">カレンダー</h2>
        {label && <span className="badge">{label}</span>}
        <span className="panel-right">
          <Link href={`/?week=${weekOffset - 1}`} className="btn btn-xs" aria-label="前の週">
            ‹
          </Link>
          <span className="tabular-nums">{range}</span>
          <Link href={`/?week=${weekOffset + 1}`} className="btn btn-xs" aria-label="次の週">
            ›
          </Link>
          {weekOffset !== 0 && (
            <Link href="/" className="btn btn-xs">
              今週
            </Link>
          )}
        </span>
      </div>
      <div className="panel-body grid grid-cols-7">
        {days.map((day) => {
          const d = jstDate(day);
          const isToday = day === today;
          const dayItems = all.filter((it) => jstDay(it.ms) === day).sort((a, b) => a.ms - b.ms);
          return (
            <div
              key={day}
              className={`flex min-w-0 flex-col border-l border-[var(--line)] first:border-l-0 ${isToday ? "bg-[#f2f7fd]" : ""}`}
            >
              <div
                className={`flex-none border-b border-[var(--line)] py-1.5 text-center text-[11px] ${
                  isToday ? "bg-[var(--accent)] text-white" : d.getUTCDay() === 0 ? "danger" : "muted"
                }`}
              >
                {WEEKDAYS[d.getUTCDay()]}
                <b className={`block text-[16px] font-semibold ${isToday ? "" : "text-[var(--text)]"}`}>
                  {d.getUTCDate()}
                </b>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1">
                {dayItems.map((it) => (
                  <Chip key={it.key} it={it} now={now} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
