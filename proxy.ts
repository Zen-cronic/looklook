import { NextResponse, type NextRequest } from "next/server";
import { FILM_COOKIE, filmFromCookie, filmFromEnv, filmParam } from "./lib/filming/flag";
import { SESSION_COOKIE, newSessionId, sessionSecret, signSession, verifySession } from "./lib/app/session-cookie";

/**
 * Every visitor gets their own shopper session (shelf, saved methods,
 * receipts), issued here and kept in a signed cookie. A cookie we didn't sign
 * gets a fresh, empty session instead. Webhook endpoints don't need one, and
 * neither does /api/share: the page it sends a phone to gets the session.
 *
 * `?film=1` turns on filming mode for this browser session and `?film=0`
 * turns it off (see lib/filming/flag.ts). The landing page is static, so in
 * filming mode it is served from its generic copy.
 */
export async function proxy(request: NextRequest) {
  const film = filmParam(request.nextUrl.searchParams);
  if (film === "on") request.cookies.set(FILM_COOKIE, "1");
  if (film === "off") request.cookies.delete(FILM_COOKIE);
  const landingCopy = request.nextUrl.pathname === "/" && (filmFromEnv() || filmFromCookie(request.cookies.get(FILM_COOKIE)?.value));

  const secret = sessionSecret();
  let issued: string | undefined;
  if (!secret) {
    console.error("SESSION_SECRET is not set: sessions are off.");
  } else if (!(await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret))) {
    issued = await signSession(newSessionId(), secret);
    request.cookies.set(SESSION_COOKIE, issued);
  }

  if (!issued && film === null && !landingCopy) return NextResponse.next();

  const forward = { request: { headers: request.headers } };
  const response = landingCopy ? NextResponse.rewrite(new URL("/filming", request.url), forward) : NextResponse.next(forward);
  if (issued) response.cookies.set(SESSION_COOKIE, issued, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 60 });
  // A browser-session cookie: filming mode ends when the browser closes.
  if (film === "on") response.cookies.set(FILM_COOKIE, "1", { sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/" });
  if (film === "off") response.cookies.delete(FILM_COOKIE);
  return response;
}

export const config = {
  matcher: ["/((?!_next/|api/webhooks/|api/health|api/share|favicon.ico|manifest.webmanifest|icons/|samples/|media/|filming/).*)"],
};
