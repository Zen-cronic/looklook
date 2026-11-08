/**
 * Shopper sessions are issued by the server: the cookie holds the session id
 * and an HMAC of it under SESSION_SECRET, so an id can't be made up. Shared by
 * the proxy and server code; Web Crypto only, no Node-only imports here.
 */
export const SESSION_COOKIE = "sl_session";

const SESSION_ID = /^[a-zA-Z0-9_-]{8,64}$/;
/** Used only outside production when SESSION_SECRET is unset (local runs and tests). */
const DEV_SECRET = "looklook-local-development-only";

export function newSessionId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

/** The signing secret, or undefined in production when it isn't configured (sessions are then refused). */
export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const s = env.SESSION_SECRET?.trim();
  if (s) return s;
  return env.NODE_ENV === "production" ? undefined : DEV_SECRET;
}

function base64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mac(id: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`session:${id}`)));
}

/** The cookie value for a session id. */
export async function signSession(id: string, secret: string): Promise<string> {
  if (!SESSION_ID.test(id)) throw new Error("bad session id");
  return `${id}.${await mac(id, secret)}`;
}

/** The session id in a cookie value, only when its signature is ours. */
export async function verifySession(value: string | undefined, secret: string | undefined): Promise<string | undefined> {
  if (!value || !secret) return undefined;
  const dot = value.indexOf(".");
  if (dot < 0) return undefined;
  const id = value.slice(0, dot);
  const given = value.slice(dot + 1);
  if (!SESSION_ID.test(id)) return undefined;
  const expected = await mac(id, secret);
  if (given.length !== expected.length) return undefined;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? id : undefined;
}
