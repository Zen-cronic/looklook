import { cookies } from "next/headers";
import { connection } from "next/server";
import { appToday } from "./dates";
import { loadSession } from "./store";
import { SESSION_COOKIE, sessionSecret, verifySession } from "./session-cookie";
import type { SessionState } from "./types";

export { SESSION_COOKIE };

/** The shopper's session id from the signed cookie the proxy sets on every request. */
export async function currentSessionId(): Promise<string> {
  await connection();
  const id = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret());
  if (!id) throw new Error("No signed session cookie");
  return id;
}

export async function currentSession(): Promise<{ id: string; state: SessionState; today: string }> {
  const id = await currentSessionId();
  const state = loadSession(id);
  return { id, state, today: appToday(state.dayOffset) };
}
