import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "泊舟 · 你的个人书友",
  description: "一个能与你共同思考、形成长期记忆的个人 AI 书友。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

