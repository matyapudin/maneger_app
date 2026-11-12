"use server";

import { revalidatePath } from "next/cache";
import {
  addTask,
  hide,
  setAssignmentUserStatus,
  setSetting,
  toggleTask,
  unhide,
  type AssignmentUserStatus,
  type HiddenKind,
} from "@/lib/db";
import { GMAIL_PRIMARY_ONLY_KEY } from "@/lib/google";
import { isStale, syncAll } from "@/lib/sync";

// ---------- Refresh ----------

// The ↻ button: import from AIMS and Gmail now.
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
