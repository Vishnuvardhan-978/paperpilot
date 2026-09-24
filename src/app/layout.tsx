import type { Metadata, Viewport } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PaperPilot — Truth Tutor for every age",
  description:
    "Open tutor without a file, Library ask across chats, Bridge lens (source vs world), plus PDFs/YouTube with Kid/Study/Proof. Built by Vishnu.",
};

export const viewport: Viewport = {
  themeColor: "#00d4aa",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg0 text-text">{children}</body>
    </html>
  );
}
