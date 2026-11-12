import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "マネージャー",
  description: "タスク・メール・大学の課題をまとめて管理するアプリ",
};

const navItems = [
  { href: "/", label: "ホーム" },
  { href: "/tasks", label: "タスク" },
  { href: "/mail", label: "メール" },
  { href: "/assignments", label: "課題" },
  { href: "/settings", label: "設定" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 dark:border-white/15">
          <nav className="mx-auto flex max-w-3xl flex-wrap gap-4 px-4 py-3">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="font-medium hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
