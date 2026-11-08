import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, newSessionId, sessionSecret, signSession, verifySession } from "./lib/app/session-cookie";

/**
 * Every visitor gets their own shopper session (shelf, saved methods,
 * receipts), issued here and kept in a signed cookie. A cookie we didn't sign
 * gets a fresh, empty session instead. Webhook endpoints don't need one.
 */
export async function proxy(request: NextRequest) {
  const secret = sessionSecret();
  if (!secret) {
    console.error("SESSION_SECRET is not set: sessions are off.");
    return NextResponse.next();
  }
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(existing, secret)) return NextResponse.next();
  const value = await signSession(newSessionId(), secret);
  request.cookies.set(SESSION_COOKIE, value);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(SESSION_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 60 });
  return response;
}

export const config = {
  matcher: ["/((?!_next/|api/webhooks/|api/health|favicon.ico|samples/).*)"],
};
