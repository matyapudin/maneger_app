const dateTimeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

export function formatDateTime(iso: string) {
  return dateTimeFmt.format(new Date(iso));
}

export function formatDate(iso: string) {
  return dateFmt.format(new Date(iso));
}

// A task's due date ("YYYY-MM-DD") means the end of that day in Japan time.
export function taskDueToIso(date: string) {
  return new Date(`${date}T23:59:59+09:00`).toISOString();
}

// "Taro <taro@example.com>" -> "Taro"
export function displayName(from: string) {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return m ? m[1] : from;
}

// "Taro <taro@example.com>" -> "taro@example.com" (lower case, for matching)
export function senderAddress(from: string) {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

// ---------- Time helpers (Japan time) ----------

export const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;

// Request time. Pages that call this render per request (they read data
// through functions that call connection()).
export function requestTime() {
  return Date.now();
}

// Calendar day number in Japan time ("days since 1970-01-01 JST").
export function jstDay(ms: number) {
  return Math.floor((ms + JST_OFFSET_MS) / DAY_MS);
}

// The JST calendar date of a day number, as a UTC Date (use getUTC* on it).
export function jstDate(day: number) {
  return new Date(day * DAY_MS);
}

// Day number of the Monday that starts the week containing `day`.
export function weekStart(day: number) {
  const dow = (jstDate(day).getUTCDay() + 6) % 7; // Monday = 0
  return day - dow;
}

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const timeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "numeric",
  minute: "2-digit",
});

export function formatTime(ms: number) {
  return timeFmt.format(new Date(ms));
}

// "今日 17:48", "明日", "11/15（日）", ...
export function formatDue(ms: number, now: number, dateOnly = false) {
  const diff = jstDay(ms) - jstDay(now);
  const d = jstDate(jstDay(ms));
  const label =
    diff === 0
      ? "今日"
      : diff === 1
        ? "明日"
        : diff === -1
          ? "昨日"
          : `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[d.getUTCDay()]}）`;
  return dateOnly ? label : `${label} ${formatTime(ms)}`;
}

// "あと 3 時間", "あと 2 日", "3 日超過"
export function formatRemaining(ms: number, now: number) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const text =
    abs < 3_600_000
      ? `${Math.max(1, Math.round(abs / 60_000))} 分`
      : abs < DAY_MS
        ? `${Math.round(abs / 3_600_000)} 時間`
        : `${Math.round(abs / DAY_MS)} 日`;
  return diff >= 0 ? `あと ${text}` : `${text}超過`;
}

// "3 分前", "2 時間前"
export function formatAgo(ms: number, now: number) {
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return "たった今";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分前`;
  if (diff < DAY_MS) return `${Math.round(diff / 3_600_000)} 時間前`;
  return `${Math.round(diff / DAY_MS)} 日前`;
}

// ---------- Course colours ----------

const COURSE_COLORS = [
  "#0067c0", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

// A stable colour per course name.
export function courseColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return COURSE_COLORS[h % COURSE_COLORS.length];
}

// A stable avatar colour per sender.
export function senderColor(address: string) {
  return courseColor(address);
}
