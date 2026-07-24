import type { Metadata } from "next";
import "./globals.css";

const title = "风之海";
const description = "进入原创蓝色沉浸舞台：导入你有权使用的音乐，伸手捏破藏着白色烟雾的泡泡，在手机与电脑上体验空间环绕。";
const metadataBase = new URL("https://xiezhengru68-gif.github.io/wind-sea-interactive/");

export const metadata: Metadata = {
  metadataBase,
  title,
  description,
  icons: { icon: new URL("favicon.png", metadataBase).toString(), shortcut: new URL("favicon.png", metadataBase).toString() },
  openGraph: {
    title,
    description,
    type: "website",
    locale: "zh_CN",
    images: [{ url: new URL("wind-sea-stage-reimagined-v2.png", metadataBase).toString(), width: 1674, height: 945, alt: "风之海，蓝色沉浸舞台" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [new URL("wind-sea-stage-reimagined-v2.png", metadataBase).toString()],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
