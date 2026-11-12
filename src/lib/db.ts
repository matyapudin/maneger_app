// Node.js built-in SQLite: no native add-on to compile, works on any Node >= 22.13.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connection } from "next/server";
import { senderAddress } from "@/lib/format";

// The database lives in a per-user folder, outside the app folder, so
// re-downloading or updating the app keeps logins and data.
// Windows: %APPDATA%\maneger_app\app.db   others: ~/.maneger_app/app.db
// Override with DATABASE_PATH (see .env.example).
function defaultDbPath() {
  const base =
    process.platform === "win32" && process.env.APPDATA
      ? path.join(process.env.APPDATA, "maneger_app")
      : path.join(os.homedir(), ".maneger_app");
  return path.join(base, "app.db");
}

export const dbPath = process.env.DATABASE_PATH || defaultDbPath();

// Older versions kept the database in ./data/app.db inside the app folder.
const legacyDbPath = path.join(process.cwd(), "data", "app.db");

function migrateLegacyDb() {
  if (process.env.DATABASE_PATH || fs.existsSync(dbPath) || !fs.existsSync(legacyDbPath)) return;
  // VACUUM INTO writes a complete copy, including changes still in the WAL file.
  const old = new DatabaseSync(legacyDbPath);
  try {
    old.exec(`VACUUM INTO '${dbPath.replaceAll("'", "''")}'`);
  } finally {
    old.close();
  }
}

let db: DatabaseSync | undefined;

function addColumnIfMissing(d: DatabaseSync, table: string, column: string, type: string) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// Runs fn inside one transaction; rolls back if it throws.
function inTransaction(d: DatabaseSync, fn: () => void) {
  d.exec("BEGIN");
  try {
    fn();
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

function getDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    migrateLegacyDb();
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        due_date TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gmail_id TEXT UNIQUE,
        sender TEXT NOT NULL,
        subject TEXT NOT NULL,
        received_at TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT UNIQUE,
        course TEXT NOT NULL,
        title TEXT NOT NULL,
        due_at TEXT,
        submitted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sync_log (
        source TEXT PRIMARY KEY,
        synced_at TEXT NOT NULL,
        ok INTEGER NOT NULL,
        message TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,          -- calendarId|eventId
        calendar_name TEXT NOT NULL,
        color TEXT NOT NULL,
        title TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        all_day INTEGER NOT NULL,
        location TEXT,
        url TEXT
      );
      CREATE TABLE IF NOT EXISTS mail_suggestions (
        id TEXT PRIMARY KEY,          -- gmailId|date|time
        gmail_id TEXT NOT NULL,
        date TEXT NOT NULL,           -- YYYY-MM-DD
        time TEXT,                    -- HH:MM
        kind TEXT NOT NULL,           -- deadline | event | date
        context TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new'  -- new | added | dismissed
      );
      CREATE TABLE IF NOT EXISTS hidden (
        kind TEXT NOT NULL,   -- 'email' | 'sender' | 'assignment' | 'course'
        value TEXT NOT NULL,  -- gmail id, sender address, assignment source id, course name
        label TEXT,           -- what to show in the 設定 list
        PRIMARY KEY (kind, value)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS service_tokens (
        service TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        account TEXT
      );
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        provider TEXT PRIMARY KEY,
        refresh_token TEXT NOT NULL,
        access_token TEXT,
        expires_at INTEGER,
        account TEXT
      );
    `);
    // Columns added after the first version: add them to older databases.
    addColumnIfMissing(db, "assignments", "url", "TEXT");
    addColumnIfMissing(db, "assignments", "course_id", "INTEGER");
    addColumnIfMissing(db, "assignments", "requires_submission", "INTEGER NOT NULL DEFAULT 1");
    // Set by the user: 'done' or 'not_required'. Never overwritten by a sync.
    addColumnIfMissing(db, "assignments", "user_status", "TEXT");
    addColumnIfMissing(db, "emails", "snippet", "TEXT");
    addColumnIfMissing(db, "emails", "url", "TEXT");
    addColumnIfMissing(db, "emails", "sender_address", "TEXT");
    addColumnIfMissing(db, "oauth_tokens", "scopes", "TEXT");
    addColumnIfMissing(db, "tasks", "url", "TEXT");
  }
  return db;
}

export type Task = {
  id: number;
  title: string;
  due_date: string | null;
  done: number;
  url: string | null; // e.g. the email a suggested task came from
};

export type Email = {
  id: number;
  gmail_id: string;
  sender: string;
  sender_address: string | null;
  subject: string;
  received_at: string;
  is_read: number;
  snippet: string | null;
  url: string | null;
};

export type Assignment = {
  id: number;
  source_id: string | null;
  course: string;
  title: string;
  due_at: string | null;
  submitted: number;
  url: string | null;
  course_id: number | null;
  requires_submission: number;
  user_status: AssignmentUserStatus | null;
};

export type AssignmentUserStatus = "done" | "not_required";

// What the assignment needs from the user right now.
export type AssignmentState = "pending" | "submitted" | "done" | "not_required";

export function assignmentState(a: Assignment): AssignmentState {
  if (a.submitted) return "submitted";
  if (a.user_status === "done") return "done";
  if (a.user_status === "not_required" || !a.requires_submission) return "not_required";
  return "pending";
}

const ASSIGNMENT_COLUMNS =
  "id, source_id, course, title, due_at, submitted, url, course_id, requires_submission, user_status";

const EMAIL_COLUMNS =
  "id, gmail_id, sender, sender_address, subject, received_at, is_read, snippet, url";

// Rows not hidden by the user (one by one, or by sender / course rules).
const VISIBLE_EMAIL_SQL = `gmail_id NOT IN (SELECT value FROM hidden WHERE kind = 'email')
  AND coalesce(sender_address, '') NOT IN (SELECT value FROM hidden WHERE kind = 'sender')`;
const VISIBLE_ASSIGNMENT_SQL = `coalesce(source_id, '') NOT IN (SELECT value FROM hidden WHERE kind = 'assignment')
  AND course NOT IN (SELECT value FROM hidden WHERE kind = 'course')`;

// SQL version of assignmentState(...) === "pending", for queries.
const PENDING_ASSIGNMENT_SQL =
  "submitted = 0 AND requires_submission = 1 AND user_status IS NULL";

export type SyncLog = {
  synced_at: string;
  ok: number;
  message: string;
};

// Reads call connection() so they run per request, not at build time.
export async function listTasks(): Promise<Task[]> {
  await connection();
  return getDb()
    .prepare(
      "SELECT id, title, due_date, done, url FROM tasks ORDER BY done, due_date IS NULL, due_date, id",
    )
    .all() as Task[];
}

export function addTask(title: string, dueDate: string | null, url: string | null = null) {
  getDb()
    .prepare("INSERT INTO tasks (title, due_date, url) VALUES (?, ?, ?)")
    .run(title, dueDate, url);
}

export function toggleTask(id: number) {
  getDb().prepare("UPDATE tasks SET done = 1 - done WHERE id = ?").run(id);
}

export async function listEmails(): Promise<Email[]> {
  await connection();
  return getDb()
    .prepare(
      `SELECT ${EMAIL_COLUMNS} FROM emails WHERE ${VISIBLE_EMAIL_SQL} ORDER BY received_at DESC`,
    )
    .all() as Email[];
}

export async function listAssignments(): Promise<Assignment[]> {
  await connection();
  return getDb()
    .prepare(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM assignments WHERE ${VISIBLE_ASSIGNMENT_SQL}
       ORDER BY course, due_at IS NULL, due_at`,
    )
    .all() as Assignment[];
}

export function setAssignmentUserStatus(id: number, status: AssignmentUserStatus | null) {
  getDb().prepare("UPDATE assignments SET user_status = ? WHERE id = ?").run(status, id);
}

export type AssignmentInput = {
  sourceId: string;
  courseId: number;
  course: string;
  title: string;
  dueAt: string | null;
  submitted: boolean;
  requiresSubmission: boolean;
  url: string;
};

// Replaces all assignments from one source (e.g. "aims-") with the given list.
export function replaceAssignments(prefix: string, items: AssignmentInput[]) {
  const d = getDb();
  const upsert = d.prepare(`
    INSERT INTO assignments (source_id, course_id, course, title, due_at, submitted, requires_submission, url)
    VALUES (@sourceId, @courseId, @course, @title, @dueAt, @submitted, @requiresSubmission, @url)
    ON CONFLICT(source_id) DO UPDATE SET
      course_id = excluded.course_id, course = excluded.course, title = excluded.title,
      due_at = excluded.due_at, submitted = excluded.submitted,
      requires_submission = excluded.requires_submission, url = excluded.url
  `);
  inTransaction(d, () => {
    const keep = new Set(items.map((i) => i.sourceId));
    const existing = d
      .prepare("SELECT source_id FROM assignments WHERE source_id LIKE ? || '%'")
      .all(prefix) as { source_id: string }[];
    const del = d.prepare("DELETE FROM assignments WHERE source_id = ?");
    for (const row of existing) if (!keep.has(row.source_id)) del.run(row.source_id);
    for (const i of items) {
      upsert.run({
        sourceId: i.sourceId,
        courseId: i.courseId,
        course: i.course,
        title: i.title,
        dueAt: i.dueAt,
        submitted: i.submitted ? 1 : 0,
        requiresSubmission: i.requiresSubmission ? 1 : 0,
        url: i.url,
      });
    }
  });
}

export function recordSync(source: string, ok: boolean, message: string) {
  getDb()
    .prepare(
      `INSERT INTO sync_log (source, synced_at, ok, message) VALUES (?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET synced_at = excluded.synced_at,
         ok = excluded.ok, message = excluded.message`,
    )
    .run(source, new Date().toISOString(), ok ? 1 : 0, message);
}

export async function getLastSync(source: string): Promise<SyncLog | null> {
  await connection();
  return (
    (getDb()
      .prepare("SELECT synced_at, ok, message FROM sync_log WHERE source = ?")
      .get(source) as SyncLog | undefined) ?? null
  );
}

export type EmailInput = {
  gmailId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  isRead: boolean;
  url: string;
};

// Replaces the stored inbox with the given messages.
export function replaceEmails(items: EmailInput[]) {
  const d = getDb();
  const upsert = d.prepare(`
    INSERT INTO emails (gmail_id, sender, sender_address, subject, snippet, received_at, is_read, url)
    VALUES (@gmailId, @sender, @senderAddress, @subject, @snippet, @receivedAt, @isRead, @url)
    ON CONFLICT(gmail_id) DO UPDATE SET
      sender = excluded.sender, sender_address = excluded.sender_address,
      subject = excluded.subject, snippet = excluded.snippet,
      received_at = excluded.received_at, is_read = excluded.is_read, url = excluded.url
  `);
  inTransaction(d, () => {
    const keep = new Set(items.map((i) => i.gmailId));
    const existing = d.prepare("SELECT gmail_id FROM emails").all() as { gmail_id: string }[];
    const del = d.prepare("DELETE FROM emails WHERE gmail_id = ?");
    for (const row of existing) if (!keep.has(row.gmail_id)) del.run(row.gmail_id);
    for (const i of items) {
      // Pass only the stored fields: node:sqlite rejects unknown named parameters.
      upsert.run({
        gmailId: i.gmailId,
        sender: i.sender,
        senderAddress: senderAddress(i.sender),
        subject: i.subject,
        snippet: i.snippet,
        receivedAt: i.receivedAt,
        isRead: i.isRead ? 1 : 0,
        url: i.url,
      });
    }
  });
}

export function clearEmails() {
  getDb().prepare("DELETE FROM emails").run();
}

export type OAuthToken = {
  refresh_token: string;
  access_token: string | null;
  expires_at: number | null;
  account: string | null;
  scopes: string | null; // space-separated scopes the user granted
};

export function getOAuthToken(provider: string): OAuthToken | null {
  return (
    (getDb()
      .prepare(
        "SELECT refresh_token, access_token, expires_at, account, scopes FROM oauth_tokens WHERE provider = ?",
      )
      .get(provider) as OAuthToken | undefined) ?? null
  );
}

export function saveOAuthToken(
  provider: string,
  t: {
    refreshToken: string;
    accessToken: string;
    expiresAt: number;
    account: string | null;
    scopes: string | null;
  },
) {
  getDb()
    .prepare(
      `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, account, scopes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET refresh_token = excluded.refresh_token,
         access_token = excluded.access_token, expires_at = excluded.expires_at,
         account = excluded.account, scopes = excluded.scopes`,
    )
    .run(provider, t.refreshToken, t.accessToken, t.expiresAt, t.account, t.scopes);
}

export function clearOAuthToken(provider: string) {
  getDb().prepare("DELETE FROM oauth_tokens WHERE provider = ?").run(provider);
}

// Which account is connected, for display (never returns the tokens themselves).
export async function getConnectedAccount(provider: string): Promise<string | null> {
  await connection();
  const t = getOAuthToken(provider);
  return t ? (t.account ?? "（アカウント不明）") : null;
}

export type DashboardData = {
  openTasks: Task[];
  pendingAssignments: Assignment[];
  unreadEmails: Email[];
  unreadCount: number;
};

// Everything the home screen needs, read in one go.
export async function getDashboard(): Promise<DashboardData> {
  await connection();
  const d = getDb();
  return {
    openTasks: d
      .prepare("SELECT id, title, due_date, done, url FROM tasks WHERE done = 0")
      .all() as Task[],
    pendingAssignments: d
      .prepare(
        `SELECT ${ASSIGNMENT_COLUMNS} FROM assignments WHERE ${PENDING_ASSIGNMENT_SQL} AND ${VISIBLE_ASSIGNMENT_SQL}`,
      )
      .all() as Assignment[],
    unreadEmails: d
      .prepare(
        `SELECT ${EMAIL_COLUMNS} FROM emails WHERE is_read = 0 AND ${VISIBLE_EMAIL_SQL}
         ORDER BY received_at DESC LIMIT 5`,
      )
      .all() as Email[],
    unreadCount: (
      d
        .prepare(`SELECT count(*) AS n FROM emails WHERE is_read = 0 AND ${VISIBLE_EMAIL_SQL}`)
        .get() as { n: number }
    ).n,
  };
}

// Simple API tokens (e.g. the AIMS/Moodle web service token).
export function getServiceToken(service: string): { token: string; account: string | null } | null {
  return (
    (getDb()
      .prepare("SELECT token, account FROM service_tokens WHERE service = ?")
      .get(service) as { token: string; account: string | null } | undefined) ?? null
  );
}

export function saveServiceToken(service: string, token: string, account: string | null) {
  getDb()
    .prepare(
      `INSERT INTO service_tokens (service, token, account) VALUES (?, ?, ?)
       ON CONFLICT(service) DO UPDATE SET token = excluded.token, account = excluded.account`,
    )
    .run(service, token, account);
}

export function clearServiceToken(service: string) {
  getDb().prepare("DELETE FROM service_tokens WHERE service = ?").run(service);
}

// App settings entered on the 設定 screen (e.g. the Google OAuth client).
export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  if (value === null || value === "") {
    getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
  } else {
    getDb()
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }
}

// ---------- Hidden items and rules ----------

export type HiddenKind = "email" | "sender" | "assignment" | "course";
export type HiddenRule = { kind: HiddenKind; value: string; label: string | null };

export function hide(kind: HiddenKind, value: string, label: string | null) {
  getDb()
    .prepare(
      `INSERT INTO hidden (kind, value, label) VALUES (?, ?, ?)
       ON CONFLICT(kind, value) DO UPDATE SET label = excluded.label`,
    )
    .run(kind, value, label);
}

export function unhide(kind: HiddenKind, value: string) {
  getDb().prepare("DELETE FROM hidden WHERE kind = ? AND value = ?").run(kind, value);
}

export async function listHidden(): Promise<HiddenRule[]> {
  await connection();
  return getDb()
    .prepare("SELECT kind, value, label FROM hidden ORDER BY kind, label")
    .all() as HiddenRule[];
}

export async function countHidden(table: "emails" | "assignments"): Promise<number> {
  await connection();
  const visible = table === "emails" ? VISIBLE_EMAIL_SQL : VISIBLE_ASSIGNMENT_SQL;
  return (
    getDb().prepare(`SELECT count(*) AS n FROM ${table} WHERE NOT (${visible})`).get() as {
      n: number;
    }
  ).n;
}

// ---------- Google Calendar events ----------

export type CalendarEvent = {
  id: string;
  calendar_name: string;
  color: string;
  title: string;
  start_ms: number;
  end_ms: number;
  all_day: number;
  location: string | null;
  url: string | null;
};

export function replaceCalendarEvents(
  rows: {
    id: string;
    calendarName: string;
    color: string;
    title: string;
    startMs: number;
    endMs: number;
    allDay: boolean;
    location: string | null;
    url: string | null;
  }[],
) {
  const d = getDb();
  const insert = d.prepare(
    `INSERT OR REPLACE INTO calendar_events
       (id, calendar_name, color, title, start_ms, end_ms, all_day, location, url)
     VALUES (@id, @calendarName, @color, @title, @startMs, @endMs, @allDay, @location, @url)`,
  );
  inTransaction(d, () => {
    d.exec("DELETE FROM calendar_events");
    for (const r of rows) {
      insert.run({
        id: r.id,
        calendarName: r.calendarName,
        color: r.color,
        title: r.title,
        startMs: r.startMs,
        endMs: r.endMs,
        allDay: r.allDay ? 1 : 0,
        location: r.location,
        url: r.url,
      });
    }
  });
}

export function clearCalendarEvents() {
  getDb().exec("DELETE FROM calendar_events");
}

// Events overlapping [fromMs, toMs).
export async function listCalendarEvents(fromMs: number, toMs: number): Promise<CalendarEvent[]> {
  await connection();
  return getDb()
    .prepare(
      `SELECT id, calendar_name, color, title, start_ms, end_ms, all_day, location, url
       FROM calendar_events WHERE start_ms < ? AND end_ms > ? ORDER BY all_day DESC, start_ms`,
    )
    .all(toMs, fromMs) as CalendarEvent[];
}

// Pending, visible assignments with a due date: what goes to Google Calendar.
export function pendingDeadlines(): {
  sourceId: string;
  title: string;
  course: string;
  dueMs: number;
  url: string | null;
}[] {
  const rows = getDb()
    .prepare(
      `SELECT source_id, title, course, due_at, url FROM assignments
       WHERE ${PENDING_ASSIGNMENT_SQL} AND ${VISIBLE_ASSIGNMENT_SQL}
         AND due_at IS NOT NULL AND source_id IS NOT NULL`,
    )
    .all() as { source_id: string; title: string; course: string; due_at: string; url: string | null }[];
  return rows.map((r) => ({
    sourceId: r.source_id,
    title: r.title,
    course: r.course,
    dueMs: Date.parse(r.due_at),
    url: r.url,
  }));
}

// ---------- Task suggestions from emails ----------

export type SuggestionKind = "deadline" | "event" | "date";

export type MailSuggestion = {
  id: string;
  gmail_id: string;
  date: string;
  time: string | null;
  kind: SuggestionKind;
  context: string;
};

// Stores the dates found in each imported email. Suggestions the user added
// or dismissed keep that status, so they never come back.
export function replaceSuggestions(
  found: { gmailId: string; date: string; time: string | null; kind: SuggestionKind; context: string }[],
) {
  const d = getDb();
  const ids = found.map((f) => `${f.gmailId}|${f.date}|${f.time ?? ""}`);
  const insert = d.prepare(
    `INSERT OR IGNORE INTO mail_suggestions (id, gmail_id, date, time, kind, context)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  inTransaction(d, () => {
    const keep = new Set(ids);
    const open = d.prepare("SELECT id FROM mail_suggestions WHERE status = 'new'").all() as {
      id: string;
    }[];
    const del = d.prepare("DELETE FROM mail_suggestions WHERE id = ?");
    for (const row of open) if (!keep.has(row.id)) del.run(row.id);
    found.forEach((f, i) => insert.run(ids[i], f.gmailId, f.date, f.time, f.kind, f.context));
  });
}

// Open suggestions for emails still shown, from `today` (YYYY-MM-DD) on.
export async function listSuggestions(today: string): Promise<MailSuggestion[]> {
  await connection();
  return getDb()
    .prepare(
      `SELECT s.id, s.gmail_id, s.date, s.time, s.kind, s.context
       FROM mail_suggestions s JOIN emails e ON e.gmail_id = s.gmail_id
       WHERE s.status = 'new' AND s.date >= ? AND ${VISIBLE_EMAIL_SQL.replaceAll("gmail_id", "e.gmail_id").replaceAll("sender_address", "e.sender_address")}
       ORDER BY s.date, s.time`,
    )
    .all(today) as MailSuggestion[];
}

export function dismissSuggestion(id: string) {
  getDb().prepare("UPDATE mail_suggestions SET status = 'dismissed' WHERE id = ?").run(id);
}

// "Re: 【経済学入門】第4回レポート" -> "【経済学入門】第4回レポート"
function taskTitleFromSubject(subject: string) {
  return subject.replace(/^\s*((re|fwd?|fw|転送)\s*[:：]\s*)+/i, "").trim() || "メールの件名なし";
}

// Adds the suggestion as a task (only when the user asks) and marks it added.
export function addTaskFromSuggestion(id: string): boolean {
  const d = getDb();
  const s = d
    .prepare(
      `SELECT s.date, s.time, s.kind, e.subject, e.url FROM mail_suggestions s
       JOIN emails e ON e.gmail_id = s.gmail_id WHERE s.id = ? AND s.status = 'new'`,
    )
    .get(id) as
    | { date: string; time: string | null; kind: SuggestionKind; subject: string; url: string | null }
    | undefined;
  if (!s) return false;
  const when = s.time ? (s.kind === "deadline" ? `（${s.time}まで）` : `（${s.time}〜）`) : "";
  inTransaction(d, () => {
    addTask(`${taskTitleFromSubject(s.subject)}${when}`, s.date, s.url);
    d.prepare("UPDATE mail_suggestions SET status = 'added' WHERE id = ?").run(id);
  });
  return true;
}
