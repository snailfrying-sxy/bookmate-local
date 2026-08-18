import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookMate · 泊舟",
  description: "Your private AI book friend · 与你把书谈深的私人 AI 书友",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
