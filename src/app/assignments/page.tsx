import { Suspense } from "react";
import { listAssignments } from "@/lib/db";

async function AssignmentList() {
  const items = await listAssignments();
  if (items.length === 0) {
    return (
      <p className="opacity-75">
        課題はまだありません。大学（AIMS）との連携は今後追加します。
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/15">
      {items.map((a) => (
        <li key={a.id} className="py-2">
          <div className={a.submitted ? "line-through opacity-60" : "font-medium"}>
            {a.title}
          </div>
          <div className="text-sm opacity-60">
            {a.course}
            {a.due_at && ` ・ 〆 ${a.due_at}`}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AssignmentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">課題</h1>
      <Suspense fallback={<p>読み込み中…</p>}>
        <AssignmentList />
      </Suspense>
    </div>
  );
}
