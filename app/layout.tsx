import type { Metadata, Viewport } from "next";
import { Albert_Sans, Martian_Mono, Unbounded } from "next/font/google";
import Link from "next/link";
import { Suspense, ViewTransition } from "react";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { FilmBadge } from "./components/FilmBadge";
import { NavLinks } from "./components/NavLinks";
import { VerdictLegend } from "./components/VerdictLegend";
import { MOTION_SCRIPT, stillAtBuild } from "./components/motion";
import "./globals.css";

const display = Unbounded({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const ui = Albert_Sans({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", axes: ["wdth"] });

export const metadata: Metadata = {
  title: { default: `${APP_NAME}: ${APP_TAGLINE}`, template: `%s | ${APP_NAME}` },
  description: APP_DESCRIPTION,
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f4f2",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`} data-still={stillAtBuild() ? "" : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_SCRIPT }} />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="wordmark">
              <strong>{APP_NAME}</strong>
              <span>{APP_TAGLINE}</span>
            </Link>
            <Suspense fallback={<NavLinks static />}>
              <NavLinks />
            </Suspense>
          </div>
        </header>
        <ViewTransition default="page-swap">{children}</ViewTransition>
        <footer className="footer">
          <nav className="footer-group" aria-labelledby="footer-product">
            <h2 id="footer-product" className="footer-head">
              {APP_NAME}
            </h2>
            <Link href="/week">This week</Link>
            <Link href="/check">Check a post</Link>
            <Link href="/shelf">Shelf</Link>
            <Link href="/rebuys">Reorders</Link>
            <Link href="/payments">Payments</Link>
            <Link href="/studio">Dashboard</Link>
          </nav>
          <nav className="footer-group" aria-labelledby="footer-resources">
            <h2 id="footer-resources" className="footer-head">
              Resources
            </h2>
            <Link href="/judge">Start here</Link>
            <Link href="/proof">Accuracy test</Link>
            <Link href="/events">Webhook events</Link>
          </nav>
        </footer>
        <VerdictLegend />
        {process.env.NODE_ENV !== "production" && <FilmBadge />}
      </body>
    </html>
  );
}
