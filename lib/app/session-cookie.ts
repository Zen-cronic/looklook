/** Shared by the proxy and server code; no Node-only imports here. */
export const SESSION_COOKIE = "sl_session";

export function newSessionId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}
