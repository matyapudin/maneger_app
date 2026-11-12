import { Suspense } from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { formatDateTime } from "@/lib/format";
import { connection } from "next/server";
import {
  clearServiceToken,
  getLastSync,
  getServiceToken,
  listAssignments,
  recordSync,
  replaceAssignments,
  setAssignmentUserStatus,
  assignmentState,
  type Assignment,
  type AssignmentState,
  type AssignmentUserStatus,
} from "@/lib/db";
import { AIMS_SERVICE, fetchAssignments, getMoodleConfig, MoodleError } from "@/lib/moodle";

const SOURCE = "aims";

async function syncFromAims() {
  "use server";
  const config = getMoodleConfig();
  if (!config) {
    recordSync(SOURCE, false, "AIMS に接続されていません。設定画面でログインしてください。");
  } else {
    try {
      const items = await fetchAssignments(config);
      replaceAssignments("aims-", items);
      recordSync(SOURCE, true, `${items.length} 件の課題を取り込みました。`);
    } catch (e) {
      if (e instanceof MoodleError && e.code === "invalidtoken") {
        // The saved key no longer works: forget it so the login form shows again.
        clearServiceToken(AIMS_SERVICE);
        recordSync(SOURCE, false, "AIMS との接続が切れました。設定画面でもう一度ログインしてください。");
      } else {
        recordSync(SOURCE, false, `取り込みに失敗しました：${e instanceof Error ? e.message : "不明なエラー"}`);
      }
    }
  }
  revalidatePath("/", "layout");
}

// Request time; the list is rendered per request (listAssignments calls connection()).
function requestTime() {
  return Date.now();
}

const buttonClass = "rounded bg-foreground px-4 py-2 text-background";

async function SyncPanel() {
  await connection();
  const connected = getServiceToken(AIMS_SERVICE) !== null;
  const last = await getLastSync(SOURCE);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
      {connected ? (
        <form action={syncFromAims}>
          <button type="submit" className={buttonClass}>
            AIMS から取り込む
          </button>
        </form>
      ) : (
        <p className="text-sm">
          AIMS はまだ接続されていません。
          <Link href="/settings" className="font-medium underline">
            設定
          </Link>
          から接続してください。
        </p>
      )}
      {last && (
        <p className={`text-sm ${last.ok ? "opacity-75" : "text-red-600 dark:text-red-400"}`}>
          {formatDateTime(last.synced_at)}：{last.message}
        </p>
      )}
    </div>
  );
}

async function setStatus(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  const raw = String(formData.get("status") ?? "");
  const status: AssignmentUserStatus | null =
    raw === "done" || raw === "not_required" ? raw : null;
  if (Number.isInteger(id)) setAssignmentUserStatus(id, status);
  revalidatePath("/", "layout");
}

const stateLabel: Record<Exclude<AssignmentState, "pending">, string> = {
  submitted: "提出済み",
  done: "完了",
  not_required: "提出不要",
};

const smallButtonClass =
  "rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/[.05] dark:border-white/20 dark:hover:bg-white/[.08]";

function StatusButton({ id, status, label }: { id: number; status: string; label: string }) {
  return (
    <form action={setStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={smallButtonClass}>
        {label}
      </button>
    </form>
  );
}

function Title({ a }: { a: Assignment }) {
  return a.url ? (
    <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
      {a.title}
    </a>
  ) : (
    <>{a.title}</>
  );
}

function PendingItem({ a, now }: { a: Assignment; now: number }) {
  const overdue = a.due_at !== null && new Date(a.due_at).getTime() < now;
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          <Title a={a} />
        </div>
        <div className={`text-sm ${overdue ? "text-red-600 dark:text-red-400" : "opacity-75"}`}>
          {a.due_at ? `〆 ${formatDateTime(a.due_at)}${overdue ? "（期限切れ）" : ""}` : "締め切りなし"}
        </div>
      </div>
      <div className="flex gap-1">
        <StatusButton id={a.id} status="done" label="完了にする" />
        <StatusButton id={a.id} status="not_required" label="提出不要" />
      </div>
    </li>
  );
}

function OtherItem({ a }: { a: Assignment }) {
  const state = assignmentState(a) as Exclude<AssignmentState, "pending">;
  // Only states the user set can be undone; "submitted" and auto-detected
  // "no submission needed" come from AIMS.
  const userSet = a.user_status !== null && state !== "submitted";
  return (
    <li className="flex items-baseline gap-3 py-1.5 text-sm opacity-70">
      <span className="shrink-0 rounded bg-black/[.06] px-1.5 text-xs dark:bg-white/[.1]">
        {stateLabel[state]}
      </span>
      <div className="min-w-0 flex-1 truncate">
        <Title a={a} />
      </div>
      {userSet && <StatusButton id={a.id} status="" label="元に戻す" />}
    </li>
  );
}

type CourseGroup = { course: string; pending: Assignment[]; other: Assignment[] };

async function AssignmentList() {
  const items = await listAssignments();
  if (items.length === 0) {
    return <p className="opacity-75">課題はまだありません。</p>;
  }
  const now = requestTime();

  const byCourse = new Map<string, CourseGroup>();
  for (const a of items) {
    const g = byCourse.get(a.course) ?? { course: a.course, pending: [], other: [] };
    (assignmentState(a) === "pending" ? g.pending : g.other).push(a);
    byCourse.set(a.course, g);
  }
  // Courses with the most urgent pending work first; finished courses last.
  const earliest = (g: CourseGroup) =>
    Math.min(...g.pending.map((a) => (a.due_at ? Date.parse(a.due_at) : Infinity)));
  const groups = [...byCourse.values()].sort((x, y) => {
    if (!!x.pending.length !== !!y.pending.length) return x.pending.length ? -1 : 1;
    return earliest(x) - earliest(y) || x.course.localeCompare(y.course, "ja");
  });

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const overdue = g.pending.filter((a) => a.due_at && Date.parse(a.due_at) < now).length;
        return (
          <details
            key={g.course}
            open={g.pending.length > 0}
            className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/15"
          >
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3">
              <span className="font-semibold">{g.course}</span>
              <span className="text-sm opacity-75">
                {g.pending.length > 0 ? `未提出 ${g.pending.length} 件` : "やることなし"}
              </span>
              {overdue > 0 && (
                <span className="text-sm text-red-600 dark:text-red-400">期限切れ {overdue} 件</span>
              )}
            </summary>
            {g.pending.length > 0 && (
              <ul className="mt-1 divide-y divide-black/10 dark:divide-white/15">
                {g.pending.map((a) => (
                  <PendingItem key={a.id} a={a} now={now} />
                ))}
              </ul>
            )}
            {g.other.length > 0 && (
              <ul className="mt-2 border-t border-black/10 pt-1 dark:border-white/15">
                {g.other.map((a) => (
                  <OtherItem key={a.id} a={a} />
                ))}
              </ul>
            )}
          </details>
        );
      })}
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
