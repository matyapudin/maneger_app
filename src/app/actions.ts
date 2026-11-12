"use server";

import { revalidatePath } from "next/cache";
import { hide, setSetting, unhide, type HiddenKind } from "@/lib/db";
import { GMAIL_PRIMARY_ONLY_KEY } from "@/lib/google";

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
