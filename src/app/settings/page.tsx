import { Suspense } from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { setPrimaryOnlyAction, unhideAction } from "@/app/actions";
import { smallButtonClass } from "@/app/hide-button";
import {
  clearEmails,
  clearServiceToken,
  dbPath,
  getConnectedAccount,
  getLastSync,
  getServiceToken,
  getSetting,
  listHidden,
  recordSync,
  type HiddenKind,
  setSetting,
} from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import {
  disconnect,
  GMAIL_PRIMARY_ONLY_KEY,
  getGoogleConfig,
  GOOGLE_CLIENT_ID_KEY,
  GOOGLE_CLIENT_SECRET_KEY,
} from "@/lib/google";
import { AIMS_SERVICE, loginToMoodle, MoodleError } from "@/lib/moodle";

// Sections keep text on solid white; only the page frame is glass.
const cardClass =
  "flex flex-col gap-3 border border-[var(--edge)] bg-white p-5 shadow-[0_8px_32px_rgba(0,0,0,0.06)]";
const inputClass = "input flex-1";
const buttonClass = "btn btn-primary";
const subtleButtonClass = "btn";

// ---------- AIMS ----------

async function loginAims(formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    recordSync("aims", false, "ユーザー名とパスワードを入力してください。");
  } else {
    try {
      const account = await loginToMoodle(username, password);
      recordSync("aims", true, `${account} さんとして AIMS に接続しました。`);
    } catch (e) {
      const msg =
        e instanceof MoodleError && e.code === "invalidlogin"
          ? "ユーザー名かパスワードが違います。AIMS にログインするときと同じものを入れてください。"
          : e instanceof Error
            ? e.message
            : "不明なエラー";
      recordSync("aims", false, `AIMS への接続に失敗しました：${msg}`);
    }
  }
  revalidatePath("/", "layout");
}

async function logoutAims() {
  "use server";
  clearServiceToken(AIMS_SERVICE);
  recordSync("aims", true, "AIMS との接続を解除しました。");
  revalidatePath("/", "layout");
}

// ---------- Google ----------

async function saveGoogleClient(formData: FormData) {
  "use server";
  const id = String(formData.get("client_id") ?? "").trim();
  const secret = String(formData.get("client_secret") ?? "").trim();
  if (!id || !secret) {
    recordSync("gmail", false, "クライアント ID とシークレットの両方を入れてください。");
  } else if (!id.endsWith(".apps.googleusercontent.com")) {
    recordSync(
      "gmail",
      false,
      "クライアント ID の形が違うようです（「….apps.googleusercontent.com」で終わる文字列です）。",
    );
  } else {
    setSetting(GOOGLE_CLIENT_ID_KEY, id);
    setSetting(GOOGLE_CLIENT_SECRET_KEY, secret);
    recordSync("gmail", true, "Google の設定を保存しました。「Gmail に接続」を押してください。");
  }
  revalidatePath("/settings");
}

async function clearGoogleClient() {
  "use server";
  await disconnect();
  clearEmails();
  setSetting(GOOGLE_CLIENT_ID_KEY, null);
  setSetting(GOOGLE_CLIENT_SECRET_KEY, null);
  recordSync("gmail", true, "Google の設定を削除しました。");
  revalidatePath("/", "layout");
}

async function disconnectGoogle() {
  "use server";
  await disconnect();
  clearEmails();
  recordSync("gmail", true, "Gmail との接続を解除しました。");
  revalidatePath("/", "layout");
}

function Status({ source }: { source: { synced_at: string; ok: number; message: string } | null }) {
  if (!source) return null;
  return (
    <p className={`text-sm ${source.ok ? "muted" : "danger"}`}>
      {formatDateTime(source.synced_at)}：{source.message}
    </p>
  );
}

async function AimsSection() {
  await connection();
  const saved = getServiceToken(AIMS_SERVICE);
  const last = await getLastSync("aims");
  return (
    <section className={cardClass}>
      <h2 className="panel-title">AIMS（大学の課題）</h2>
      {saved ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            接続中：<span className="font-medium">{saved.account ?? "AIMS"}</span>
          </p>
          <form action={logoutAims}>
            <button type="submit" className={subtleButtonClass}>
              接続を解除
            </button>
          </form>
        </div>
      ) : (
        <form action={loginAims} className="flex flex-col gap-2">
          <p className="text-sm muted">
            AIMS にログインするときのユーザー名とパスワードを入れてください。
            パスワードは保存せず、AIMS から受け取った「鍵」だけを保存します。一度つなげば、次からは入力不要です。
          </p>
          <div className="flex flex-wrap gap-2">
            <input name="username" required autoComplete="username" placeholder="ユーザー名" className={inputClass} />
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="パスワード"
              className={inputClass}
            />
            <button type="submit" className={buttonClass}>
              AIMS に接続
            </button>
          </div>
        </form>
      )}
      <Status source={last} />
    </section>
  );
}

async function GoogleSection({ origin }: { origin: string }) {
  await connection();
  const configured = getGoogleConfig() !== null;
  const savedInApp = getSetting(GOOGLE_CLIENT_ID_KEY) !== null;
  const account = await getConnectedAccount("google");
  const last = await getLastSync("gmail");
  const redirect = `${origin}/api/auth/google/callback`;
  return (
    <section className={cardClass}>
      <h2 className="panel-title">Google（Gmail）</h2>

      {!configured ? (
        <form action={saveGoogleClient} className="flex flex-col gap-2">
          <p className="text-sm muted">
            Google Cloud で作った「OAuth クライアント」の ID とシークレットを入れてください（作り方は README
            の「Gmail との連携」）。リダイレクト URI には次を登録します：
          </p>
          <code className="w-fit bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-sm select-all">
            {redirect}
          </code>
          <div className="flex flex-wrap gap-2">
            <input name="client_id" required placeholder="クライアント ID" className={inputClass} />
            <input
              name="client_secret"
              type="password"
              required
              placeholder="クライアント シークレット"
              className={inputClass}
            />
            <button type="submit" className={buttonClass}>
              保存
            </button>
          </div>
        </form>
      ) : account ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            接続中：<span className="font-medium">{account}</span>
          </p>
          <form action={disconnectGoogle}>
            <button type="submit" className={subtleButtonClass}>
              接続を解除
            </button>
          </form>
        </div>
      ) : (
        <div>
          {/* A plain link: the route redirects the browser to Google. */}
          <a href="/api/auth/google" className={`inline-block ${buttonClass}`}>
            Gmail に接続
          </a>
        </div>
      )}

      <Status source={last} />

      {configured && savedInApp && (
        <details className="text-sm">
          <summary className="cursor-pointer muted">Google の設定を変更・削除する</summary>
          <form action={clearGoogleClient} className="mt-2">
            <button type="submit" className={subtleButtonClass}>
              クライアント ID とシークレットを削除
            </button>
          </form>
        </details>
      )}
    </section>
  );
}

const hiddenKindLabel: Record<HiddenKind, string> = {
  course: "授業",
  assignment: "課題",
  sender: "差出人",
  email: "メール",
};

async function FilterSection() {
  await connection();
  const primaryOnly = getSetting(GMAIL_PRIMARY_ONLY_KEY) === "1";
  const rules = await listHidden();
  return (
    <section id="hidden" className={`${cardClass} scroll-mt-4`}>
      <h2 className="panel-title">表示しないもの</h2>

      <form action={setPrimaryOnlyAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="enabled" value={primaryOnly ? "0" : "1"} />
        <p className="text-sm">
          Gmail の「メイン」タブだけ取り込む（プロモーション・ソーシャルなどは取り込まない）：
          <span className="font-medium">{primaryOnly ? "オン" : "オフ"}</span>
        </p>
        <button type="submit" className={smallButtonClass}>
          {primaryOnly ? "オフにする" : "オンにする"}
        </button>
      </form>
      <p className="-mt-2 text-xs muted">切り替えたあと、ホーム右上の ↻ で取り込み直すと反映されます。</p>

      <h3 className="text-sm font-semibold">非表示にしたもの（{rules.length}）</h3>
      {rules.length === 0 ? (
        <p className="text-sm muted">
          ありません。ホームのメールや課題の行にマウスを乗せると出る「非表示」ボタンで追加できます。
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {rules.map((r) => (
            <li key={`${r.kind}:${r.value}`} className="flex items-baseline gap-3 py-1.5 text-sm">
              <span className="badge shrink-0">
                {hiddenKindLabel[r.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.label ?? r.value}</span>
              <form action={unhideAction}>
                <input type="hidden" name="kind" value={r.kind} />
                <input type="hidden" name="value" value={r.value} />
                <button type="submit" className={smallButtonClass}>
                  表示に戻す
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function DataSection() {
  await connection();
  return (
    <section className={cardClass}>
      <h2 className="panel-title">データの保存場所</h2>
      <p className="text-sm muted">
        アプリのフォルダーとは別の場所に保存しているので、アプリを新しくしてもログインやデータは残ります。
      </p>
      <code className="w-fit bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-sm select-all">
        {dbPath}
      </code>
    </section>
  );
}

export default async function SettingsPage() {
  // The redirect URI shown above must match the address the app is opened at.
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-[var(--gap)] p-[var(--gap)] pb-10">
      <header className="glass flex h-[52px] items-center gap-4 px-5">
        <Link href="/" className="btn">
          ← ホームに戻る
        </Link>
        <h1 className="text-[15px] font-bold">設定</h1>
      </header>
      <Suspense fallback={<p>読み込み中…</p>}>
        <AimsSection />
      </Suspense>
      <Suspense fallback={<p>読み込み中…</p>}>
        <GoogleSection origin={origin} />
      </Suspense>
      <Suspense fallback={<p>読み込み中…</p>}>
        <FilterSection />
      </Suspense>
      <Suspense fallback={<p>読み込み中…</p>}>
        <DataSection />
      </Suspense>
    </div>
  );
}
