import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Newt Studio — Portable AI Limb & UI Workbench",
  description:
    "Standalone platform-agnostic AI-Agentic UI & Salamanda Limb authoring studio with live Pluggable Base Shell Simulator and SQLite Sidecar Explorer.",
};

const FOUC_SCHEME_SCRIPT = `
try {
  var stored = localStorage.getItem("color-scheme");
  var meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = stored === "dark" || stored === "light" ? stored : "light dark";
  var isDark = stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
} catch (e) {}
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: FOUC_SCHEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
