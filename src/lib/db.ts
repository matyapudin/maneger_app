// Node.js built-in SQLite: no native add-on to compile, works on any Node >= 22.13.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";

// SQLite database file. Override with DATABASE_PATH (see .env.example).
const dbPath =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");

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
    addColumnIfMissing(db, "emails", "snippet", "TEXT");
    addColumnIfMissing(db, "emails", "url", "TEXT");
  }
  return db;
}

export type Task = {
  id: number;
  title: string;
  due_date: string | null;
  done: number;
};

export type Email = {
  id: number;
  sender: string;
  subject: string;
  received_at: string;
  is_read: number;
  snippet: string | null;
  url: string | null;
};

export type Assignment = {
  id: number;
  course: string;
  title: string;
  due_at: string | null;
  submitted: number;
  url: string | null;
};

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
      "SELECT id, title, due_date, done FROM tasks ORDER BY done, due_date IS NULL, due_date, id",
    )
    .all() as Task[];
}

export function addTask(title: string, dueDate: string | null) {
  getDb()
    .prepare("INSERT INTO tasks (title, due_date) VALUES (?, ?)")
    .run(title, dueDate);
}

export function toggleTask(id: number) {
  getDb().prepare("UPDATE tasks SET done = 1 - done WHERE id = ?").run(id);
}

export async function listEmails(): Promise<Email[]> {
  await connection();
  return getDb()
    .prepare(
      "SELECT id, sender, subject, received_at, is_read, snippet, url FROM emails ORDER BY received_at DESC",
    )
    .all() as Email[];
}

export async function listAssignments(): Promise<Assignment[]> {
  await connection();
  return getDb()
    .prepare(
      "SELECT id, course, title, due_at, submitted, url FROM assignments ORDER BY submitted, due_at IS NULL, due_at",
    )
    .all() as Assignment[];
}

export type AssignmentInput = {
  sourceId: string;
  course: string;
  title: string;
  dueAt: string | null;
  submitted: boolean;
  url: string;
};

// Replaces all assignments from one source (e.g. "aims-") with the given list.
export function replaceAssignments(prefix: string, items: AssignmentInput[]) {
  const d = getDb();
  const upsert = d.prepare(`
    INSERT INTO assignments (source_id, course, title, due_at, submitted, url)
    VALUES (@sourceId, @course, @title, @dueAt, @submitted, @url)
    ON CONFLICT(source_id) DO UPDATE SET
      course = excluded.course, title = excluded.title, due_at = excluded.due_at,
      submitted = excluded.submitted, url = excluded.url
  `);
  inTransaction(d, () => {
    const keep = new Set(items.map((i) => i.sourceId));
    const existing = d
      .prepare("SELECT source_id FROM assignments WHERE source_id LIKE ? || '%'")
      .all(prefix) as { source_id: string }[];
    const del = d.prepare("DELETE FROM assignments WHERE source_id = ?");
    for (const row of existing) if (!keep.has(row.source_id)) del.run(row.source_id);
    for (const i of items) upsert.run({ ...i, submitted: i.submitted ? 1 : 0 });
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
    INSERT INTO emails (gmail_id, sender, subject, snippet, received_at, is_read, url)
    VALUES (@gmailId, @sender, @subject, @snippet, @receivedAt, @isRead, @url)
    ON CONFLICT(gmail_id) DO UPDATE SET
      sender = excluded.sender, subject = excluded.subject, snippet = excluded.snippet,
      received_at = excluded.received_at, is_read = excluded.is_read, url = excluded.url
  `);
  inTransaction(d, () => {
    const keep = new Set(items.map((i) => i.gmailId));
    const existing = d.prepare("SELECT gmail_id FROM emails").all() as { gmail_id: string }[];
    const del = d.prepare("DELETE FROM emails WHERE gmail_id = ?");
    for (const row of existing) if (!keep.has(row.gmail_id)) del.run(row.gmail_id);
    for (const i of items) upsert.run({ ...i, isRead: i.isRead ? 1 : 0 });
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
};

export function getOAuthToken(provider: string): OAuthToken | null {
  return (
    (getDb()
      .prepare(
        "SELECT refresh_token, access_token, expires_at, account FROM oauth_tokens WHERE provider = ?",
      )
      .get(provider) as OAuthToken | undefined) ?? null
  );
}

export function saveOAuthToken(
  provider: string,
  t: { refreshToken: string; accessToken: string; expiresAt: number; account: string | null },
) {
  getDb()
    .prepare(
      `INSERT INTO oauth_tokens (provider, refresh_token, access_token, expires_at, account)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET refresh_token = excluded.refresh_token,
         access_token = excluded.access_token, expires_at = excluded.expires_at,
         account = excluded.account`,
    )
    .run(provider, t.refreshToken, t.accessToken, t.expiresAt, t.account);
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
      .prepare("SELECT id, title, due_date, done FROM tasks WHERE done = 0")
      .all() as Task[],
    pendingAssignments: d
      .prepare(
        "SELECT id, course, title, due_at, submitted, url FROM assignments WHERE submitted = 0",
      )
      .all() as Assignment[],
    unreadEmails: d
      .prepare(
        "SELECT id, sender, subject, received_at, is_read, snippet, url FROM emails WHERE is_read = 0 ORDER BY received_at DESC LIMIT 5",
      )
      .all() as Email[],
    unreadCount: (d.prepare("SELECT count(*) AS n FROM emails WHERE is_read = 0").get() as {
      n: number;
    }).n,
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
