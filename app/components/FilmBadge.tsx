"use client";

import { useSyncExternalStore } from "react";
import { FILM_COOKIE, filmFromCookie, filmFromEnv } from "@/lib/filming/flag";

const noSubscription = () => () => {};

function filmInBrowser(): boolean {
  const cookie = document.cookie.split("; ").find((c) => c.startsWith(`${FILM_COOKIE}=`));
  return filmFromEnv({ NEXT_PUBLIC_FILM_MODE: process.env.NEXT_PUBLIC_FILM_MODE }) || filmFromCookie(cookie?.split("=")[1]);
}

/**
 * A small marker in the corner while filming mode is on, so it isn't left on
 * by mistake during development. The layout renders it only in development
 * builds, so production captures never show it.
 */
export function FilmBadge() {
  const on = useSyncExternalStore(noSubscription, filmInBrowser, () => false);
  if (!on) return null;
  return (
    <span className="film-badge" title="Filming mode is on (?film=0 turns it off)" aria-hidden="true">
      film
    </span>
  );
}
