import { Suspense } from "react";
import { revalidatePath } from "next/cache";
import { addTask, listTasks, toggleTask } from "@/lib/db";

async function createTask(formData: FormData) {
  "use server";
  const title = String(formData.get("title") ?? "").trim();
  const due = String(formData.get("due_date") ?? "").trim();
  if (!title) return;
  addTask(title, due || null);
  revalidatePath("/tasks");
}

async function toggle(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) toggleTask(id);
  revalidatePath("/tasks");
}

async function TaskList() {
  const tasks = await listTasks();
  if (tasks.length === 0) {
    return <p className="opacity-75">タスクはまだありません。</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-3">
          <form action={toggle}>
            <input type="hidden" name="id" value={t.id} />
            <button
              type="submit"
              aria-label={t.done ? "未完了に戻す" : "完了にする"}
              className="h-5 w-5 rounded border border-current text-xs leading-none"
            >
              {t.done ? "✓" : ""}
            </button>
          </form>
          <span className={t.done ? "line-through opacity-60" : ""}>{t.title}</span>
          {t.due_date && <span className="text-sm opacity-60">〆 {t.due_date}</span>}
        </li>
      ))}
    </ul>
  );
}

export default function TasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">タスク</h1>
      <form action={createTask} className="flex flex-wrap gap-2">
        <input
          name="title"
          required
          placeholder="やること"
          className="flex-1 rounded border border-black/20 bg-transparent px-3 py-2 dark:border-white/25"
        />
        <input
          name="due_date"
          type="date"
          className="rounded border border-black/20 bg-transparent px-3 py-2 dark:border-white/25"
        />
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-background">
          追加
        </button>
      </form>
      <Suspense fallback={<p>読み込み中…</p>}>
        <TaskList />
      </Suspense>
    </div>
  );
}
