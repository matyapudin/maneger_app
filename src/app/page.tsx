import Link from "next/link";

const sections = [
  { href: "/tasks", title: "タスク", body: "やることを登録して、終わったらチェック。" },
  { href: "/mail", title: "メール", body: "Gmail の受信メールを一覧で確認（連携は準備中）。" },
  { href: "/assignments", title: "課題", body: "大学（AIMS）の課題と締め切りを確認（連携は準備中）。" },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">マネージャー</h1>
      <ul className="grid gap-4 sm:grid-cols-3">
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="block h-full rounded-lg border border-black/10 p-4 hover:bg-black/[.03] dark:border-white/15 dark:hover:bg-white/[.05]"
            >
              <h2 className="font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm opacity-75">{s.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
