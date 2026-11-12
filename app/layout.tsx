import type { Metadata, Viewport } from "next";
import { Albert_Sans, Martian_Mono, Unbounded } from "next/font/google";
import Link from "next/link";
import { Suspense, ViewTransition } from "react";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { FilmBadge } from "./components/FilmBadge";
import { NavLinks, StartHereButton } from "./components/NavLinks";
import { VerdictLegend } from "./components/VerdictLegend";
import { MOTION_SCRIPT, stillAtBuild } from "./components/motion";
import { cursorScript } from "./components/cursor";
import { filmFromEnv } from "@/lib/filming/flag";
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
        <script dangerouslySetInnerHTML={{ __html: cursorScript(filmFromEnv()) }} />
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
            <Suspense fallback={<StartHereButton static />}>
              <StartHereButton />
            </Suspense>
          </div>
        </header>
        <ViewTransition default="page-swap">{children}</ViewTransition>
        <footer className="footer">
          <div className="footer-inner">
            <div className="footer-brand">
              <Link href="/" className="footer-wordmark">
                {APP_NAME}
              </Link>
              <p>Stop buying what you already own. Pay for the rest with one PayPal yes.</p>
            </div>
            <nav className="footer-cols" aria-label="Footer">
              <div className="footer-col">
                <h2 className="footer-head">Product</h2>
                <ul>
                  <li><Link href="/week">This week</Link></li>
                  <li><Link href="/check">Check a post</Link></li>
                  <li><Link href="/shelf">Shelf</Link></li>
                  <li><Link href="/rebuys">Reorders</Link></li>
                  <li><Link href="/payments">Payments</Link></li>
                  <li><Link href="/studio">Dashboard</Link></li>
                </ul>
              </div>
              <div className="footer-col">
                <h2 className="footer-head">Try it</h2>
                <ul>
                  <li><Link href="/judge" className="btn small">Start here</Link></li>
                  <li><Link href="/proof">Accuracy test</Link></li>
                  <li><Link href="/events">Webhook events</Link></li>
                </ul>
              </div>
              <div className="footer-col">
                <h2 className="footer-head">About</h2>
                <ul>
                  <li><a href="https://github.com/Zen-cronic/looklook">Source code on GitHub</a></li>
                  <li><a href="https://github.com/Zen-cronic/looklook#how-a-verdict-is-decided">How it works</a></li>
                  <li><a href="https://github.com/Zen-cronic/looklook/blob/main/LICENSE">MIT licence</a></li>
                </ul>
              </div>
            </nav>
          </div>
          <div className="footer-base">
            <p>Built with PayPal, Claude, Channel3, AG Studio and Render</p>
            <p>&copy; 2026 {APP_NAME}</p>
          </div>
        </footer>
        <VerdictLegend />
        {process.env.NODE_ENV !== "production" && <FilmBadge />}
      </body>
    </html>
  );
}
