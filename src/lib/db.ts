import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";

// SQLite database file. Override with DATABASE_PATH (see .env.example).
const dbPath =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");

let db: Database.Database | undefined;

function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
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
    `);
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
};

export type Assignment = {
  id: number;
  course: string;
  title: string;
  due_at: string | null;
  submitted: number;
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
      "SELECT id, sender, subject, received_at, is_read FROM emails ORDER BY received_at DESC",
    )
    .all() as Email[];
}

export async function listAssignments(): Promise<Assignment[]> {
  await connection();
  return getDb()
    .prepare(
      "SELECT id, course, title, due_at, submitted FROM assignments ORDER BY submitted, due_at IS NULL, due_at",
    )
    .all() as Assignment[];
}
