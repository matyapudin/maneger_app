import Link from "next/link";
import type { Assignment, CalendarEvent, Task } from "@/lib/db";
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
  endMs: number | null; // events only
  firstDay: number; // JST day numbers the item covers
  lastDay: number;
  allDay: boolean;
  color: string;
  href: string | null;
  isEvent: boolean;
};

function items(assignments: Assignment[], tasks: Task[], events: CalendarEvent[]): CalItem[] {
  const point = <T extends Omit<CalItem, "firstDay" | "lastDay">>(it: T): CalItem => ({
    ...it,
    firstDay: jstDay(it.ms),
    lastDay: jstDay(it.ms),
  });
  return [
    ...events.map((e) => ({
      key: `e${e.id}`,
      title: e.title,
      // The main calendar is named after the email address; that isn't useful here.
      sub: e.location ?? (e.calendar_name.includes("@") ? "予定" : e.calendar_name),
      ms: e.start_ms,
      endMs: e.end_ms,
      firstDay: jstDay(e.start_ms),
      // The end is exclusive: an event ending at midnight doesn't cover that day.
      lastDay: jstDay(Math.max(e.start_ms, e.end_ms - 1)),
      allDay: !!e.all_day,
      color: e.color,
      href: e.url,
      isEvent: true,
    })),
    ...assignments
      .filter((a) => a.due_at)
      .map((a) =>
        point({
          key: `a${a.id}`,
          title: `${a.title}〆`,
          sub: a.course,
          ms: Date.parse(a.due_at!),
          endMs: null,
          allDay: false,
          color: courseColor(a.course),
          href: a.url,
          isEvent: false,
        }),
      ),
    ...tasks
      .filter((t) => t.due_date)
      .map((t) =>
        point({
          key: `t${t.id}`,
          title: t.title,
          sub: "タスク",
          ms: Date.parse(taskDueToIso(t.due_date!)),
          endMs: null,
          allDay: true,
          color: "#64748b",
          href: null,
          isEvent: false,
        }),
      ),
  ];
}

function timeLabel(it: CalItem, day: number) {
  if (it.allDay) return "終日";
  if (!it.isEvent || it.endMs === null) return formatTime(it.ms);
  // Multi-day timed events: show the part of the range on this day.
  const from = it.firstDay === day ? formatTime(it.ms) : "";
  const to = it.lastDay === day ? formatTime(it.endMs) : "";
  return `${from}–${to}`;
}

function Chip({ it, now, day }: { it: CalItem; now: number; day: number }) {
  // Events are never "overdue"; deadlines and tasks are when past.
  const overdue = !it.isEvent && it.ms < now;
  const body = (
    <>
      <b className="block truncate font-semibold">{it.title}</b>
      <span className="block truncate opacity-75">
        {timeLabel(it, day)} ・ {it.sub}
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
  events,
  calendarNotice,
  now,
  weekOffset,
}: {
  assignments: Assignment[];
  tasks: Task[];
  events: CalendarEvent[];
  calendarNotice: React.ReactNode;
  now: number;
  weekOffset: number;
}) {
  const today = jstDay(now);
  const start = weekStart(today) + weekOffset * 7;
  const days = Array.from({ length: 7 }, (_, i) => start + i);
  const all = items(assignments, tasks, events);
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
          {calendarNotice}
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
          const dayItems = all
            .filter((it) => it.firstDay <= day && day <= it.lastDay)
            // All-day first, then by time.
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.ms - b.ms);
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
                  <Chip key={it.key} it={it} now={now} day={day} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
