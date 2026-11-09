import { cookies } from "next/headers";
import { currentSession } from "../app/session";
import { FILM_COOKIE, filmFromCookie, filmFromEnv } from "./flag";
import { neutralDeep, filmState, type ViewOptions } from "./view";

/** Is filming mode on for this request (deployment switch or this browser's `?film=1`)? */
export async function filmOn(): Promise<boolean> {
  if (filmFromEnv()) return true;
  return filmFromCookie((await cookies()).get(FILM_COOKIE)?.value);
}

/**
 * The shopper's session for a page to show. In filming mode `state` is the
 * neutral copy (names, stores and images made generic); `raw` is always the
 * real record. Pages only read; nothing here is saved.
 */
export async function displaySession(opts: ViewOptions = {}) {
  const s = await currentSession();
  const film = await filmOn();
  return { ...s, raw: s.state, state: film ? filmState(s.state, opts) : s.state, film };
}

/** A JSON answer that filming mode shows generically (ids and links kept, PayPal ids shortened). */
export async function displayJson(body: unknown, init?: ResponseInit): Promise<Response> {
  return Response.json((await filmOn()) ? neutralDeep(body, { shortIds: true }) : body, init);
}
