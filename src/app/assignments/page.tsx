import { Suspense } from "react";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import {
  getLastSync,
  listAssignments,
  recordSync,
  replaceAssignments,
  type Assignment,
} from "@/lib/db";
import { fetchAssignments, getMoodleConfig, MoodleError } from "@/lib/moodle";

const SOURCE = "aims";

async function syncFromAims() {
  "use server";
  const config = getMoodleConfig();
  if (!config) {
    recordSync(SOURCE, false, "AIMS の設定（MOODLE_BASE_URL / MOODLE_TOKEN）がありません。");
  } else {
    try {
      const items = await fetchAssignments(config);
      replaceAssignments("aims-", items);
      recordSync(SOURCE, true, `${items.length} 件の課題を取り込みました。`);
    } catch (e) {
      const msg =
        e instanceof MoodleError && e.code === "invalidtoken"
          ? "トークンが正しくないか、期限切れです。新しいトークンを設定してください。"
          : e instanceof Error
            ? e.message
            : "不明なエラー";
      recordSync(SOURCE, false, `取り込みに失敗しました：${msg}`);
    }
  }
  revalidatePath("/assignments");
}

const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// Request time; the list is rendered per request (listAssignments calls connection()).
function requestTime() {
  return Date.now();
}

function formatDate(iso: string) {
  return dateFmt.format(new Date(iso));
}

async function SyncPanel() {
  await connection();
  const configured = getMoodleConfig() !== null;
  const last = await getLastSync(SOURCE);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/15">
      {configured ? (
        <form action={syncFromAims}>
          <button type="submit" className="rounded bg-foreground px-4 py-2 text-background">
            AIMS から取り込む
          </button>
        </form>
      ) : (
        <p className="text-sm">
          AIMS と連携するには、<code>.env.local</code> に <code>MOODLE_BASE_URL</code> と{" "}
          <code>MOODLE_TOKEN</code> を設定してください（<code>.env.example</code> を参照）。
        </p>
      )}
      {last && (
        <p className={`text-sm ${last.ok ? "opacity-75" : "text-red-600 dark:text-red-400"}`}>
          {formatDate(last.synced_at)}：{last.message}
        </p>
      )}
    </div>
  );
}

function AssignmentItem({ a, now }: { a: Assignment; now: number }) {
  const overdue = !a.submitted && a.due_at !== null && new Date(a.due_at).getTime() < now;
  return (
    <li className="py-2">
      <div className={a.submitted ? "line-through opacity-60" : "font-medium"}>
        {a.url ? (
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {a.title}
          </a>
        ) : (
          a.title
        )}
      </div>
      <div className="text-sm opacity-75">
        {a.course}
        {a.due_at && (
          <span className={overdue ? "text-red-600 dark:text-red-400" : ""}>
            {" ・ 〆 "}
            {formatDate(a.due_at)}
            {overdue && "（期限切れ）"}
          </span>
        )}
      </div>
    </li>
  );
}

async function AssignmentList() {
  const items = await listAssignments();
  if (items.length === 0) {
    return <p className="opacity-75">課題はまだありません。</p>;
  }
  const now = requestTime();
  const todo = items.filter((a) => !a.submitted);
  const done = items.filter((a) => a.submitted);
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="font-semibold">未提出（{todo.length}）</h2>
        <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/15">
          {todo.map((a) => (
            <AssignmentItem key={a.id} a={a} now={now} />
          ))}
        </ul>
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="font-semibold">提出済み（{done.length}）</h2>
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/15">
            {done.map((a) => (
              <AssignmentItem key={a.id} a={a} now={now} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function AssignmentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">課題</h1>
      <Suspense fallback={<p>読み込み中…</p>}>
        <SyncPanel />
      </Suspense>
      <Suspense fallback={<p>読み込み中…</p>}>
        <AssignmentList />
      </Suspense>
    </div>
  );
}
