import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Agent Studio — Self-Hosted AI Workflow Builder",
    template: "%s — Agent Studio",
  },
  description:
    "Build AI workflows, run multi-model comparisons, control costs, and generate assets locally. Self-hosted, privacy-first, Docker-ready.",
  openGraph: {
    title: "Agent Studio — Self-Hosted AI Workflow Builder",
    description:
      "Build AI workflows, run multi-model comparisons, control costs, and generate assets locally.",
    siteName: "Agent Studio",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
