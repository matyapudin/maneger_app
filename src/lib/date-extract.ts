// Finds dates written in an email (Japanese and numeric formats) so they can
// be offered as task suggestions. Rule-based: no AI, no network.
//
// Recognises: 2026年11月20日, 2026/11/20, 11月20日, 11/20, and 明日 / 明後日
// (the latter only next to a deadline word or a time), each optionally
// followed by a weekday and a time (17:00, 17時, 17時30分, 午後5時, 5時半).

export type DateKind = "deadline" | "event" | "date";

export type FoundDate = {
  date: string; // YYYY-MM-DD (Japan time)
  time: string | null; // HH:MM
  kind: DateKind;
  context: string; // the words around the date, for display
};

const DAY = 86_400_000;
const JST = 9 * 3_600_000;

const DEADLINE_WORDS = /締切|締め切|〆切|〆|期限|期日|までに|まで|迄|提出|deadline|due/i;
const EVENT_WORDS =
  /開催|日時|集合|開始|説明会|面接|会議|ミーティング|イベント|予定|実施|講義|授業|ゼミ|試験|テスト|発表|から/;

// Full-width digits and punctuation to ASCII, URLs removed (their paths
// often look like dates), whitespace collapsed.
function normalize(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/／/g, "/")
    .replace(/：/g, ":")
    .replace(/[ \t　]+/g, " ")
    .replace(/\s*\n\s*/g, "\n");
}

function jstParts(ms: number) {
  const d = new Date(ms + JST);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function dayNumber(y: number, m: number, d: number): number | null {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // Reject impossible dates such as 2/30.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t / DAY;
}

const pad = (n: number) => String(n).padStart(2, "0");

// A time written right after the date (possibly after a weekday).
const TIME_AFTER =
  /^\s*(?:[(（][月火水木金土日](?:曜日?)?[)）]|[月火水木金土日]曜日?)?\s*(?:(午前|午後|AM|PM|am|pm)\s*)?(\d{1,2})\s*(?::\s*(\d{2})|時\s*(?:(\d{1,2})\s*分|(半))?)/;

function readTime(after: string): { time: string | null; length: number } {
  const m = after.match(TIME_AFTER);
  if (!m) return { time: null, length: 0 };
  let h = Number(m[2]);
  const min = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? Number(m[4]) : m[5] ? 30 : 0;
  const ampm = m[1]?.toLowerCase();
  if ((ampm === "午後" || ampm === "pm") && h < 12) h += 12;
  if ((ampm === "午前" || ampm === "am") && h === 12) h = 0;
  if (h > 24 || min > 59) return { time: null, length: 0 };
  if (h === 24) h = 23; // "24時" deadlines mean the end of the day
  return { time: `${pad(h)}:${pad(min)}`, length: m[0].length };
}

type Hit = { index: number; length: number; y: number | null; m: number; d: number };

function findHits(text: string, receivedMs: number): Hit[] {
  const hits: Hit[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => taken.every(([s, e]) => b <= s || a >= e);
  const add = (h: Hit) => {
    if (!free(h.index, h.index + h.length)) return;
    taken.push([h.index, h.index + h.length]);
    hits.push(h);
  };

  // 2026年11月20日 / 2026/11/20 / 2026-11-20 / 2026.11.20
  for (const m of text.matchAll(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?(?!\d)/g)) {
    add({ index: m.index, length: m[0].length, y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  }
  // 11月20日
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    add({ index: m.index, length: m[0].length, y: null, m: Number(m[1]), d: Number(m[2]) });
  }
  // 11/20 (not part of a longer number or path)
  for (const m of text.matchAll(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    add({ index: m.index, length: m[0].length, y: null, m: Number(m[1]), d: Number(m[2]) });
  }
  // 明日 / 明後日 / あさって: relative to when the email was received.
  // Only when a deadline word or a time is close by ("明日のゼミ" alone is
  // usually just conversation).
  for (const m of text.matchAll(/明後日|あさって|明日/g)) {
    const near = text.slice(m.index, m.index + m[0].length + 14);
    const hasTime = readTime(text.slice(m.index + m[0].length)).time !== null;
    if (!hasTime && !DEADLINE_WORDS.test(near)) continue;
    const offset = m[0] === "明日" ? 1 : 2;
    const r = jstParts(receivedMs + offset * DAY);
    add({ index: m.index, length: m[0].length, y: r.y, m: r.m, d: r.d });
  }
  return hits.sort((a, b) => a.index - b.index);
}

// The kind whose word comes first in `s` (or null when neither appears).
function firstKind(s: string, fromEnd = false): DateKind | null {
  const pos = (re: RegExp) => {
    if (!fromEnd) return s.search(re);
    // Search backwards: the word closest to the date wins.
    let last = -1;
    for (const m of s.matchAll(new RegExp(re.source, re.flags + "g"))) last = m.index;
    return last;
  };
  const d = pos(DEADLINE_WORDS);
  const e = pos(EVENT_WORDS);
  if (d < 0 && e < 0) return null;
  if (d < 0) return "event";
  if (e < 0) return "deadline";
  return (fromEnd ? d > e : d < e) ? "deadline" : "event";
}

// Words just after the date matter most ("11/20 までに提出"), then before.
// The look-ahead stops at the next date, so in "11/18 から 11/22 まで"
// the まで belongs to 11/22 only.
function classify(text: string, start: number, end: number, nextStart: number): DateKind {
  const after = text.slice(end, Math.min(end + 16, nextStart));
  const before = text.slice(Math.max(0, start - 16), start);
  return firstKind(after) ?? firstKind(before, true) ?? "date";
}

function contextAround(text: string, start: number, end: number) {
  const s = Math.max(0, start - 14);
  const e = Math.min(text.length, end + 18);
  return `${s > 0 ? "…" : ""}${text.slice(s, e).replace(/\n/g, " ").trim()}${e < text.length ? "…" : ""}`;
}

// Dates in `text` that are today or later (Japan time) and within a year.
// `receivedMs` decides the year for dates written without one, and what
// 明日 means; `nowMs` decides what counts as already past.
export function extractDates(
  text: string,
  receivedMs: number,
  nowMs: number,
  max = 3,
): FoundDate[] {
  const t = normalize(text);
  const received = jstParts(receivedMs);
  const receivedDay = dayNumber(received.y, received.m, received.d)!;
  const now = jstParts(nowMs);
  const today = dayNumber(now.y, now.m, now.d)!;

  const out: FoundDate[] = [];
  const seen = new Set<string>();
  const hits = findHits(t, receivedMs);
  for (const [i, h] of hits.entries()) {
    if (h.m < 1 || h.m > 12 || h.d < 1 || h.d > 31) continue;
    let y = h.y ?? received.y;
    let day = dayNumber(y, h.m, h.d);
    // No year written: a date well before the email means next year
    // (e.g. "1/15" in a December email).
    if (h.y === null && day !== null && day < receivedDay - 30) {
      y += 1;
      day = dayNumber(y, h.m, h.d);
    }
    if (day === null || day < today || day > today + 366) continue;

    const end = h.index + h.length;
    const { time, length } = readTime(t.slice(end));
    const key = `${y}-${h.m}-${h.d} ${time ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      date: `${y}-${pad(h.m)}-${pad(h.d)}`,
      time,
      kind: classify(t, h.index, end + length, hits[i + 1]?.index ?? t.length),
      context: contextAround(t, h.index, end + length),
    });
    if (out.length >= max) break;
  }
  return out;
}
