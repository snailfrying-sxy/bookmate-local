import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "泊舟 · 与你把书谈深的 AI 书友",
  description: "让一本书在合上以后仍能继续发生，让每一句没说完的话都有地方被认真接住。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
