import { cookies } from "next/headers";
import { connection } from "next/server";
import { appToday } from "./dates";
import { isSessionId, loadSession } from "./store";
import { SESSION_COOKIE } from "./session-cookie";
import type { SessionState } from "./types";

export { SESSION_COOKIE };

/** The shopper's session id from the cookie the proxy sets on every request. */
export async function currentSessionId(): Promise<string> {
  await connection();
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isSessionId(value)) throw new Error("No session cookie");
  return value;
}

export async function currentSession(): Promise<{ id: string; state: SessionState; today: string }> {
  const id = await currentSessionId();
  const state = loadSession(id);
  return { id, state, today: appToday(state.dayOffset) };
}
