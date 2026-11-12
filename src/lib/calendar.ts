// Google Calendar: read the user's events, and keep AIMS deadlines in a
// calendar that this app creates (it can only write to calendars it created).
import { getSetting, setSetting } from "@/lib/db";
import { CALENDAR_API, getAccessToken, googleFetch, type GoogleConfig } from "@/lib/google";

const DAY = 86_400_000;
export const APP_CALENDAR_NAME = "Manager 課題の締め切り";
export const APP_CALENDAR_ID_KEY = "app_calendar_id";
// "0" = don't write deadlines to Google Calendar (on by default).
export const WRITE_DEADLINES_KEY = "calendar_write_deadlines";

export function writeDeadlinesEnabled() {
  return getSetting(WRITE_DEADLINES_KEY) !== "0";
}

// Import window around today.
export const READ_FROM_DAYS = 14;
export const READ_TO_DAYS = 60;

type CalendarListEntry = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
};

type EventTime = { date?: string; dateTime?: string; timeZone?: string };

type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: EventTime;
  end?: EventTime;
  extendedProperties?: { private?: Record<string, string> };
};

type Page<T> = { items?: T[]; nextPageToken?: string };

export type CalendarEventRow = {
  id: string; // `${calendarId}|${eventId}`
  calendarName: string;
  color: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string | null;
  url: string | null;
};

const enc = encodeURIComponent;

async function listAll<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const sep = url.includes("?") ? "&" : "?";
    const page = await googleFetch<Page<T>>(
      pageToken ? `${url}${sep}pageToken=${enc(pageToken)}` : url,
      token,
      "Google カレンダー",
    );
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

// An all-day date "YYYY-MM-DD" is midnight in Japan time.
function toMs(t: EventTime | undefined): number | null {
  if (!t) return null;
  if (t.dateTime) return Date.parse(t.dateTime);
  if (t.date) return Date.parse(`${t.date}T00:00:00+09:00`);
  return null;
}

// Events on the user's visible calendars, except the app's own calendar
// (its deadlines are already shown from AIMS).
export async function fetchCalendarEvents(config: GoogleConfig): Promise<CalendarEventRow[]> {
  const token = await getAccessToken(config);
  const appCalendarId = getSetting(APP_CALENDAR_ID_KEY);
  const calendars = (
    await listAll<CalendarListEntry>(`${CALENDAR_API}/users/me/calendarList`, token)
  ).filter((c) => !c.deleted && !c.hidden && c.selected !== false && c.id !== appCalendarId);

  const now = Date.now();
  const params = new URLSearchParams({
    timeMin: new Date(now - READ_FROM_DAYS * DAY).toISOString(),
    timeMax: new Date(now + READ_TO_DAYS * DAY).toISOString(),
    singleEvents: "true", // expand repeating events
    orderBy: "startTime",
    maxResults: "250",
  });

  const perCalendar = await Promise.all(
    calendars.map(async (c) => {
      const events = await listAll<GEvent>(
        `${CALENDAR_API}/calendars/${enc(c.id)}/events?${params}`,
        token,
      );
      const rows: CalendarEventRow[] = [];
      for (const e of events) {
        if (e.status === "cancelled") continue;
        const startMs = toMs(e.start);
        const endMs = toMs(e.end) ?? startMs;
        if (startMs === null || endMs === null) continue;
        rows.push({
          id: `${c.id}|${e.id}`,
          calendarName: c.summaryOverride ?? c.summary ?? "カレンダー",
          color: c.backgroundColor ?? "#0067c0",
          title: e.summary || "（タイトルなし）",
          startMs,
          endMs,
          allDay: !e.start?.dateTime,
          location: e.location ?? null,
          url: e.htmlLink ?? null,
        });
      }
      return rows;
    }),
  );
  return perCalendar.flat();
}

// ---------- Writing AIMS deadlines ----------

export type Deadline = {
  sourceId: string;
  title: string;
  course: string;
  dueMs: number;
  url: string | null;
};

const APP_TAG = "maneger_app";

// The app's own calendar; created on first use, re-created if deleted.
async function ensureAppCalendar(token: string): Promise<string> {
  const saved = getSetting(APP_CALENDAR_ID_KEY);
  if (saved) {
    try {
      await googleFetch(`${CALENDAR_API}/calendars/${enc(saved)}`, token, "Google カレンダー");
      return saved;
    } catch {
      // Deleted or inaccessible: make a new one below.
    }
  }
  const created = await googleFetch<{ id: string }>(`${CALENDAR_API}/calendars`, token, "Google カレンダー", {
    method: "POST",
    body: JSON.stringify({
      summary: APP_CALENDAR_NAME,
      description: "マネージャーアプリが AIMS の課題の締め切りを自動で書き込むカレンダーです。",
      timeZone: "Asia/Tokyo",
    }),
  });
  setSetting(APP_CALENDAR_ID_KEY, created.id);
  return created.id;
}

function eventBody(d: Deadline) {
  // A 30-minute block that ends at the deadline.
  const end = new Date(d.dueMs);
  const start = new Date(d.dueMs - 30 * 60_000);
  return {
    summary: `〆 ${d.title}`,
    description: `${d.course}${d.url ? `\n${d.url}` : ""}\n\n（マネージャーアプリが自動で追加しました）`,
    start: { dateTime: start.toISOString(), timeZone: "Asia/Tokyo" },
    end: { dateTime: end.toISOString(), timeZone: "Asia/Tokyo" },
    extendedProperties: { private: { app: APP_TAG, sourceId: d.sourceId } },
  };
}

function sameEvent(e: GEvent, body: ReturnType<typeof eventBody>) {
  return (
    e.summary === body.summary &&
    toMs(e.start) === Date.parse(body.start.dateTime) &&
    toMs(e.end) === Date.parse(body.end.dateTime)
  );
}

export type WriteResult = { added: number; updated: number; removed: number };

// Makes the app calendar match `deadlines`: adds missing events, updates
// changed ones, and removes ones whose assignment is no longer pending.
export async function writeDeadlines(
  config: GoogleConfig,
  deadlines: Deadline[],
): Promise<WriteResult> {
  const token = await getAccessToken(config);
  const calendarId = await ensureAppCalendar(token);
  const base = `${CALENDAR_API}/calendars/${enc(calendarId)}/events`;

  const existing = await listAll<GEvent>(
    `${base}?${new URLSearchParams({
      privateExtendedProperty: `app=${APP_TAG}`,
      timeMin: new Date(Date.now() - 90 * DAY).toISOString(),
      maxResults: "250",
    })}`,
    token,
  );
  const bySource = new Map<string, GEvent>();
  for (const e of existing) {
    const id = e.extendedProperties?.private?.sourceId;
    if (id && e.status !== "cancelled") bySource.set(id, e);
  }

  const result: WriteResult = { added: 0, updated: 0, removed: 0 };
  const wanted = new Set<string>();
  for (const d of deadlines) {
    wanted.add(d.sourceId);
    const body = eventBody(d);
    const current = bySource.get(d.sourceId);
    if (!current) {
      await googleFetch(base, token, "Google カレンダー", { method: "POST", body: JSON.stringify(body) });
      result.added++;
    } else if (!sameEvent(current, body)) {
      await googleFetch(`${base}/${enc(current.id)}`, token, "Google カレンダー", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      result.updated++;
    }
  }
  for (const [sourceId, e] of bySource) {
    if (wanted.has(sourceId)) continue;
    await googleFetch(`${base}/${enc(e.id)}`, token, "Google カレンダー", { method: "DELETE" });
    result.removed++;
  }
  return result;
}

// Removes every deadline the app wrote (used when writing is turned off).
export async function clearDeadlines(config: GoogleConfig): Promise<number> {
  if (!getSetting(APP_CALENDAR_ID_KEY)) return 0;
  const r = await writeDeadlines(config, []);
  return r.removed;
}
