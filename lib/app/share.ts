import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envInt } from "../studio/guard";
import { fitForReading, ImageFitError, MAX_UPLOAD_BYTES } from "../vision/fit";
import { sniffMediaType, type ImageMediaType } from "../vision/read";
import { CheckInputError, normaliseLink } from "./checks";
import { sessionSecret } from "./session-cookie";
import { dataDir } from "./store";

/**
 * Sharing to LookLook from a phone's share sheet. A shared link opens
 * `/check?url=…` (or `?text=…` with a link inside); a shared screenshot is
 * posted to `/api/share`, kept here for a few minutes under a signed
 * one-time token, and checked when the phone opens `/check?shared=<token>`
 * in its browser, in that browser's own session and under the normal check
 * limits. Nothing here calls a model.
 */

export const MAX_SHARED_LINK = 2048;
export const MAX_SHARED_TEXT = 4096;
export const MAX_SHARED_IMAGE_BYTES = MAX_UPLOAD_BYTES;
/** How long a shared screenshot waits to be opened. */
export const SHARE_TTL_MS = 10 * 60 * 1000;

/** What /check was asked to do by a share: check a link or an upload, or say why it can't. */
export type SharedInput = { kind: "url"; url: string } | { kind: "upload"; token: string } | { kind: "error"; message: string };

type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p)?.trim() || undefined;

/** The first web link in a piece of shared text ("Look at this https://… #ad"), without trailing punctuation. */
export function firstLink(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s<>"'`]+/i);
  return m?.[0].replace(/[.,;:!?)\]}'"»”’]+$/, "");
}

/**
 * The link in `/s?u=<link>`, from the raw query string: the Shortcut pastes
 * the link in without encoding it, so everything after `u=` is the link, its
 * own `?` and `&` included. An encoded link (`u=https%3A%2F%2F…`) is decoded
 * once. Only the first link is kept when several were pasted in.
 */
export function linkFromRawQuery(search: string): string | undefined {
  const q = search.replace(/^\?/, "");
  const at = q.startsWith("u=") ? 2 : q.indexOf("&u=") >= 0 ? q.indexOf("&u=") + 3 : -1;
  if (at < 0) return undefined;
  let link = q.slice(at);
  if (/^https?%3A/i.test(link)) {
    try {
      link = decodeURIComponent(link);
    } catch {
      return undefined;
    }
  }
  link = link.split(/\s|%0A|%0D/i)[0];
  return link.length ? link.slice(0, MAX_SHARED_LINK + 1) : undefined;
}

/** Validate a shared link the same way the store-link box does, plus a length limit. */
export function validateSharedLink(raw: string): { url: string } | { error: string } {
  if (raw.length > MAX_SHARED_LINK) return { error: "That link is too long to check. Paste the store page's address instead." };
  try {
    return { url: normaliseLink(raw).toString() };
  } catch (e) {
    if (e instanceof CheckInputError) return { error: e.message };
    throw e;
  }
}

/** Shared-input error codes /api/share can redirect with; /check turns them into these fixed sentences. */
export const SHARE_ERRORS = {
  missing: "That share had no link or screenshot. Share the store page's link, or a screenshot.",
  "too-big": "That image is over 15 MB. Crop it or take a smaller screenshot.",
  type: "Use a PNG, JPEG, GIF or WebP screenshot.",
  heif: "That photo is in HEIC format, which LookLook can't read. Take a screenshot of it and share the screenshot.",
  busy: "Sharing is busy right now. Try again in a few minutes.",
  expired: "That shared screenshot has expired or was already checked. Share it again.",
} as const;
export type ShareErrorCode = keyof typeof SHARE_ERRORS;

/**
 * Read /check's query: `url`, else the first link in `text` or `title`, else a
 * shared upload token, else a share error code. Nothing shared: undefined.
 */
export function sharedInput(params: Record<string, Param>): SharedInput | undefined {
  const url = first(params.url);
  const text = first(params.text);
  const title = first(params.title);
  const token = first(params.shared);
  const code = first(params.share_error);
  if (url) {
    const v = validateSharedLink(url);
    return "url" in v ? { kind: "url", url: v.url } : { kind: "error", message: v.error };
  }
  if (text || title) {
    const found = firstLink((text ?? "").slice(0, MAX_SHARED_TEXT)) ?? firstLink((title ?? "").slice(0, MAX_SHARED_TEXT));
    if (!found) return { kind: "error", message: "That share didn't include a link. Share the store page's link, or a screenshot of the post." };
    const v = validateSharedLink(found);
    return "url" in v ? { kind: "url", url: v.url } : { kind: "error", message: v.error };
  }
  if (token) return /^[A-Za-z0-9_.-]{20,200}$/.test(token) ? { kind: "upload", token } : { kind: "error", message: SHARE_ERRORS.expired };
  if (code) return { kind: "error", message: code in SHARE_ERRORS ? SHARE_ERRORS[code as ShareErrorCode] : SHARE_ERRORS.missing };
  return undefined;
}

/** A refused upload, with the HTTP status and the redirect code for browser shares. */
export class ShareError extends Error {
  constructor(
    readonly status: number,
    readonly code: ShareErrorCode,
  ) {
    super(SHARE_ERRORS[code]);
    this.name = "ShareError";
  }
}

const sharedDir = () => join(dataDir(), "shared");
const UPLOAD_ID = /^[a-f0-9]{32}$/;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function mac(id: string, exp: number, secret: string): string {
  return b64url(createHmac("sha256", secret).update(`share:${id}:${exp}`).digest());
}

function secretOrThrow(): string {
  const s = sessionSecret();
  if (!s) throw new ShareError(503, "busy");
  return s;
}

/** The upload id inside a token, only when the token is ours and not expired. */
export function verifyShareToken(token: string, now = Date.now(), secret = secretOrThrow()): string {
  const [id, expRaw, given] = token.split(".");
  const exp = Number.parseInt(expRaw ?? "", 36);
  if (!id || !UPLOAD_ID.test(id) || !Number.isFinite(exp) || !given) throw new ShareError(410, "expired");
  const expected = Buffer.from(mac(id, exp, secret));
  const got = Buffer.from(given);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new ShareError(410, "expired");
  if (now > exp) throw new ShareError(410, "expired");
  return id;
}

/** Delete uploads older than the token lifetime (their tokens can no longer be opened). */
function sweep(now: number): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(sharedDir());
  } catch {
    return [];
  }
  const live: string[] = [];
  for (const name of names) {
    const path = join(sharedDir(), name);
    try {
      if (now - statSync(path).mtimeMs > SHARE_TTL_MS) unlinkSync(path);
      else live.push(name);
    } catch {
      /* already gone */
    }
  }
  return live;
}

/**
 * Keep a shared screenshot for SHARE_TTL_MS and return its one-time token.
 * Same size and type limits as /api/check; a large phone screenshot is kept
 * at the reader's size (see fitForReading). At most SHARES_PENDING_MAX
 * unopened uploads are kept at once.
 */
export async function saveSharedImage(input: Uint8Array, now = Date.now()): Promise<{ token: string; expiresAt: string; mediaType: ImageMediaType }> {
  if (input.byteLength === 0) throw new ShareError(400, "missing");
  let fitted;
  try {
    fitted = await fitForReading(input);
  } catch (e) {
    if (e instanceof ImageFitError) throw new ShareError(e.code === "too-big" ? 413 : 415, e.code);
    throw e;
  }
  const { bytes, mediaType } = fitted;
  const secret = secretOrThrow();
  mkdirSync(sharedDir(), { recursive: true });
  if (sweep(now).length >= envInt("SHARES_PENDING_MAX", 40)) throw new ShareError(429, "busy");
  const id = randomBytes(16).toString("hex");
  const exp = now + SHARE_TTL_MS;
  writeFileSync(join(sharedDir(), id), bytes, { mode: 0o600 });
  return { token: `${id}.${exp.toString(36)}.${mac(id, exp, secret)}`, expiresAt: new Date(exp).toISOString(), mediaType };
}

/**
 * Take a shared screenshot out of storage, once: the first caller gets the
 * bytes, a second gets 410. `putBack` restores it (for a check refused by a
 * limit, so the same link works again until it expires).
 */
export function claimSharedImage(token: string, now = Date.now()): { bytes: Uint8Array; mediaType: ImageMediaType; putBack: () => void } {
  const id = verifyShareToken(token, now);
  const path = join(sharedDir(), id);
  const claimed = `${path}.claimed-${randomBytes(4).toString("hex")}`;
  try {
    renameSync(path, claimed);
  } catch {
    throw new ShareError(410, "expired");
  }
  const bytes = new Uint8Array(readFileSync(claimed));
  unlinkSync(claimed);
  const mediaType = sniffMediaType(bytes);
  if (!mediaType) throw new ShareError(415, "type");
  return { bytes, mediaType, putBack: () => writeFileSync(path, bytes, { mode: 0o600 }) };
}
