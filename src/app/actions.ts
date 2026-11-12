"use server";

import { revalidatePath } from "next/cache";
import {
  addTask,
  addTaskFromSuggestion,
  dismissSuggestion,
  hide,
  recordSync,
  setAssignmentUserStatus,
  setSetting,
  toggleTask,
  unhide,
  type AssignmentUserStatus,
  type HiddenKind,
} from "@/lib/db";
import { clearDeadlines, WRITE_DEADLINES_KEY } from "@/lib/calendar";
import { GMAIL_PRIMARY_ONLY_KEY, getGoogleConfig, hasCalendarAccess } from "@/lib/google";
import { isStale, syncAll, syncCalendar } from "@/lib/sync";

// ---------- Refresh ----------

// The ↻ button: import from AIMS, Gmail and Google Calendar now.
export async function refreshAllAction() {
  await syncAll();
  revalidatePath("/", "layout");
}

// Called when the app opens: refresh only if the data is old.
export async function refreshIfStaleAction(): Promise<boolean> {
  if (!(await isStale(Date.now()))) return false;
  await syncAll();
  revalidatePath("/", "layout");
  return true;
}

// ---------- Tasks ----------

export async function addTaskAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const due = String(formData.get("due_date") ?? "").trim();
  if (title) addTask(title, /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null);
  revalidatePath("/", "layout");
}

export async function toggleTaskAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) toggleTask(id);
  revalidatePath("/", "layout");
}

// Suggested from an email: added only when the user presses the button.
export async function addSuggestedTaskAction(formData: FormData) {
  addTaskFromSuggestion(String(formData.get("id") ?? ""));
  revalidatePath("/", "layout");
}

export async function dismissSuggestionAction(formData: FormData) {
  dismissSuggestion(String(formData.get("id") ?? ""));
  revalidatePath("/", "layout");
}

// ---------- Assignments ----------

// "done" / "not_required", or empty to undo.
export async function setAssignmentStatusAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const raw = String(formData.get("status") ?? "");
  const status: AssignmentUserStatus | null = raw === "done" || raw === "not_required" ? raw : null;
  if (Number.isInteger(id)) setAssignmentUserStatus(id, status);
  revalidatePath("/", "layout");
}

// ---------- Hiding ----------

const KINDS: HiddenKind[] = ["email", "sender", "assignment", "course"];

function readRule(formData: FormData) {
  const kind = String(formData.get("kind") ?? "") as HiddenKind;
  const value = String(formData.get("value") ?? "");
  if (!KINDS.includes(kind) || !value) return null;
  return { kind, value };
}

// Hide one email / assignment, or everything from a sender / course.
export async function hideAction(formData: FormData) {
  const rule = readRule(formData);
  if (rule) hide(rule.kind, rule.value, String(formData.get("label") ?? "") || null);
  revalidatePath("/", "layout");
}

export async function unhideAction(formData: FormData) {
  const rule = readRule(formData);
  if (rule) unhide(rule.kind, rule.value);
  revalidatePath("/", "layout");
}

// Only import Gmail's "Primary" tab (skips Promotions, Social, ...).
export async function setPrimaryOnlyAction(formData: FormData) {
  setSetting(GMAIL_PRIMARY_ONLY_KEY, formData.get("enabled") === "1" ? "1" : null);
  revalidatePath("/", "layout");
}

// Turn writing AIMS deadlines to Google Calendar on or off. Turning it off
// removes the events the app wrote; turning it on writes them right away.
export async function setWriteDeadlinesAction(formData: FormData) {
  const on = formData.get("enabled") === "1";
  setSetting(WRITE_DEADLINES_KEY, on ? null : "0");
  const config = getGoogleConfig();
  if (config && hasCalendarAccess()) {
    if (on) {
      await syncCalendar();
    } else {
      try {
        const removed = await clearDeadlines(config);
        recordSync("calendar", true, `カレンダーへの書き込みをやめ、追加した締め切り ${removed} 件を削除しました。`);
      } catch (e) {
        recordSync("calendar", false, `締め切りの削除に失敗しました：${e instanceof Error ? e.message : "不明なエラー"}`);
      }
    }
  }
  revalidatePath("/", "layout");
}
