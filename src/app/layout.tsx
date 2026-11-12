import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manager",
  description: "タスク・メール・大学の課題をまとめて管理するアプリ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
