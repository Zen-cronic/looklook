import { cookies, headers } from "next/headers";
import { PayPalApiError } from "../paypal/errors";
import { SESSION_COOKIE, sessionSecret, verifySession } from "./session-cookie";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** The shopper's session id, only from a cookie this server signed. */
export async function sessionIdOrThrow(): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new HttpError(503, "Sessions aren't set up on this server (SESSION_SECRET).");
  const id = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, secret);
  if (!id) throw new HttpError(401, "Open the app in a browser first: no session.");
  return id;
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Expected a JSON body.");
  }
}

/** Public base URL for PayPal return links (Render sets the forwarded headers). */
export async function baseUrl(): Promise<string> {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Wrap a handler: HttpError and PayPal errors become plain JSON answers; nothing secret is echoed. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message, ...e.extra }, { status: e.status });
    if (e instanceof PayPalApiError) {
      console.error(`PayPal error: ${e.message} (debug id ${e.debugId ?? "none"})`);
      return Response.json({ error: `PayPal said ${e.errorName}${e.issues[0] ? ` (${e.issues[0].issue})` : ""}.`, issue: e.issues[0]?.issue ?? e.errorName, debugId: e.debugId }, { status: 502 });
    }
    const message = e instanceof Error ? e.message : "Something went wrong.";
    console.error("request failed:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    return Response.json({ error: message }, { status: 500 });
  }
}
