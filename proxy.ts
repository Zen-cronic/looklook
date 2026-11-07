import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, newSessionId } from "./lib/app/session-cookie";

/**
 * Every visitor gets their own shopper session (shelf, saved methods,
 * receipts), kept in a cookie. Webhook endpoints don't need one.
 */
export function proxy(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return NextResponse.next();
  const id = newSessionId();
  request.cookies.set(SESSION_COOKIE, id);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(SESSION_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 60 });
  return response;
}

export const config = {
  matcher: ["/((?!_next/|api/webhooks/|api/health|favicon.ico|samples/).*)"],
};
