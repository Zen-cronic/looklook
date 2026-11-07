import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { NavLinks } from "./components/NavLinks";
import "./globals.css";

const ui = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = Spline_Sans_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: `${APP_NAME}: ${APP_TAGLINE}`, template: `%s | ${APP_NAME}` },
  description: APP_DESCRIPTION,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3f1ec",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
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
        {children}
        <footer className="footer">
          <Link href="/judge">Start here</Link>
          <Link href="/proof">How often skip is right</Link>
          <Link href="/events">Webhook events</Link>
        </footer>
      </body>
    </html>
  );
}
