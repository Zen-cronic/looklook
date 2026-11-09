import type { Metadata } from "next";
import LandingPage from "../page";

/** The landing page as filming mode shows it; `/` is served from here while `?film=1` is on. */
export const metadata: Metadata = { robots: { index: false } };

export default function FilmLandingPage() {
  return <LandingPage film />;
}
