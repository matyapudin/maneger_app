import { Suspense } from "react";
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
  type Assignment,
} from "@/lib/db";
import {
  AIMS_SERVICE,
  fetchAssignments,
  getMoodleConfig,
  loginToMoodle,
  MoodleError,
} from "@/lib/moodle";

const SOURCE = "aims";

async function loginAims(formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    recordSync(SOURCE, false, "ユーザー名とパスワードを入力してください。");
  } else {
    try {
      const account = await loginToMoodle(username, password);
      recordSync(SOURCE, true, `${account} さんとして AIMS に接続しました。「AIMS から取り込む」を押してください。`);
    } catch (e) {
      const msg =
        e instanceof MoodleError && e.code === "invalidlogin"
          ? "ユーザー名かパスワードが違います。AIMS にログインするときと同じものを入れてください。"
          : e instanceof Error
            ? e.message
            : "不明なエラー";
      recordSync(SOURCE, false, `AIMS への接続に失敗しました：${msg}`);
    }
  }
  revalidatePath("/assignments");
}

async function logoutAims() {
  "use server";
  clearServiceToken(AIMS_SERVICE);
  recordSync(SOURCE, true, "AIMS との接続を解除しました。");
  revalidatePath("/assignments");
}

async function syncFromAims() {
  "use server";
  const config = getMoodleConfig();
  if (!config) {
    recordSync(SOURCE, false, "AIMS に接続されていません。ユーザー名とパスワードでログインしてください。");
  } else {
    try {
      const items = await fetchAssignments(config);
      replaceAssignments("aims-", items);
      recordSync(SOURCE, true, `${items.length} 件の課題を取り込みました。`);
    } catch (e) {
      if (e instanceof MoodleError && e.code === "invalidtoken") {
        // The saved key no longer works: forget it so the login form shows again.
        clearServiceToken(AIMS_SERVICE);
        recordSync(SOURCE, false, "AIMS との接続が切れました。もう一度ログインしてください。");
      } else {
        recordSync(SOURCE, false, `取り込みに失敗しました：${e instanceof Error ? e.message : "不明なエラー"}`);
      }
    }
  }
  revalidatePath("/assignments");
}

// Request time; the list is rendered per request (listAssignments calls connection()).
function requestTime() {
  return Date.now();
}

const inputClass =
  "rounded border border-black/20 bg-transparent px-3 py-2 dark:border-white/25";
const buttonClass = "rounded bg-foreground px-4 py-2 text-background";
const subtleButtonClass = "rounded border border-black/20 px-4 py-2 dark:border-white/25";

async function SyncPanel() {
  await connection();
  const saved = getServiceToken(AIMS_SERVICE);
  const last = await getLastSync(SOURCE);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15">
      {saved ? (
        <>
          <p className="text-sm">
            接続中：<span className="font-medium">{saved.account ?? "AIMS"}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={syncFromAims}>
              <button type="submit" className={buttonClass}>
                AIMS から取り込む
              </button>
            </form>
            <form action={logoutAims}>
              <button type="submit" className={subtleButtonClass}>
                接続を解除
              </button>
            </form>
          </div>
        </>
      ) : (
        <form action={loginAims} className="flex flex-col gap-2">
          <p className="text-sm">
            AIMS にログインするときのユーザー名とパスワードを入れてください。
            パスワードは保存せず、AIMS から受け取った「鍵」だけをこのパソコンに保存します。
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              name="username"
              required
              autoComplete="username"
              placeholder="ユーザー名"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="パスワード"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="submit" className={buttonClass}>
              AIMS に接続
            </button>
          </div>
        </form>
      )}
      {last && (
        <p className={`text-sm ${last.ok ? "opacity-75" : "text-red-600 dark:text-red-400"}`}>
          {formatDateTime(last.synced_at)}：{last.message}
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
            {formatDateTime(a.due_at)}
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
