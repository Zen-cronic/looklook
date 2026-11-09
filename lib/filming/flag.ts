/**
 * Filming mode: a display-only switch that shows product, brand and store
 * names generically, for recording the app on video. Off unless asked for:
 * `?film=1` on any URL sets a browser-session cookie (`?film=0` clears it),
 * or NEXT_PUBLIC_FILM_MODE=1 turns it on for a whole deployment.
 *
 * This file has no imports so client components can read the names.
 */

export const FILM_PARAM = "film";
export const FILM_COOKIE = "ll_film";

/** The deployment-wide switch. */
export function filmFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_FILM_MODE === "1";
}

/** Is filming mode on for this request? Only an exact "1" counts. */
export function filmFromCookie(value: string | undefined): boolean {
  return value === "1";
}

/** What `?film=` asks for on this URL: turn on, turn off, or leave as is. */
export function filmParam(search: URLSearchParams): "on" | "off" | null {
  const v = search.get(FILM_PARAM);
  if (v === "1") return "on";
  if (v === "0") return "off";
  return null;
}
