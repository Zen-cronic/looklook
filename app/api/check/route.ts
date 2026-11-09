import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CheckInputError, buildCheck, readImage, readLink, sha256 } from "@/lib/app/checks";
import { appToday } from "@/lib/app/dates";
import { HttpError, handle, sessionIdOrThrow } from "@/lib/app/http";
import { SAMPLES } from "@/lib/app/samples";
import { liveCheckServices, missingKeys } from "@/lib/app/services";
import { MAX_SHARED_LINK, ShareError, claimSharedImage } from "@/lib/app/share";
import { loadSession, updateSession } from "@/lib/app/store";
import type { CheckRecord } from "@/lib/app/types";
import { CallBudget } from "@/lib/studio/llm";
import { envInt, GlobalBudget } from "@/lib/studio/guard";
import { sniffMediaType } from "@/lib/vision/read";
import { ReaderOutputError } from "@/lib/vision/schema";

const MAX_BYTES = 5 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;
// Each new screenshot or link costs a vision call and catalogue calls; one already read is free.
const perSession = new CallBudget(envInt("CHECKS_PER_SESSION_PER_HOUR", 30), HOUR);
const allSessions = new GlobalBudget(envInt("CHECKS_PER_HOUR", 300), HOUR);

/** Spend one check from this shopper's and the server's hourly allowance, or answer 429. */
function takeCheck(sid: string): void {
  if (!perSession.take(sid)) throw new HttpError(429, "You've checked a lot of new items in the last hour. Try again a bit later; your earlier checks are still here.");
  if (!allSessions.take()) throw new HttpError(429, "Checking is busy right now. Try again in a few minutes.");
}

/**
 * Check a screenshot (multipart "image"), a bundled sample ("sample"), a
 * store link ("url") or a screenshot shared from a phone ("shared", the
 * one-time token from /api/share). Claude reads it, the catalogue match and
 * the verdict are decided in code, and the check is stored for this shopper.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    const missing = missingKeys();
    if (missing.length) throw new HttpError(503, `Checking is off: ${missing.join(", ")} not set on the server.`);
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Send a screenshot, a sample name or a link.");
    });
    const services = liveCheckServices();
    const image = form.get("image");
    const sample = form.get("sample");
    const url = form.get("url");
    const shared = form.get("shared");
    let reading;
    let input: CheckRecord["input"];
    try {
      if (typeof sample === "string" && sample) {
        const s = SAMPLES.find((x) => x.id === sample);
        if (!s) throw new HttpError(404, "No such sample.");
        const bytes = await readFile(join(process.cwd(), "public", "samples", s.file));
        const data = bytes.toString("base64");
        if (!services.cache?.get("reading", sha256(data))) takeCheck(sid);
        reading = await readImage({ data, mediaType: "image/png" }, services);
        input = { kind: "screenshot", imageHash: sha256(data), sample: s.id };
      } else if (image instanceof File && image.size > 0) {
        if (image.size > MAX_BYTES) throw new HttpError(413, "That image is over 5 MB. Crop it or take a smaller screenshot.");
        const bytes = new Uint8Array(await image.arrayBuffer());
        const mediaType = sniffMediaType(bytes);
        if (!mediaType) throw new HttpError(415, "Use a PNG, JPEG, GIF or WebP screenshot.");
        const data = Buffer.from(bytes).toString("base64");
        if (!services.cache?.get("reading", sha256(data))) takeCheck(sid);
        reading = await readImage({ data, mediaType }, services);
        input = { kind: "screenshot", imageHash: sha256(data) };
      } else if (typeof shared === "string" && shared) {
        const upload = claimSharedImage(shared);
        const data = Buffer.from(upload.bytes).toString("base64");
        try {
          if (!services.cache?.get("reading", sha256(data))) takeCheck(sid);
        } catch (e) {
          // Refused by a limit: keep the screenshot so the same link works once the limit allows.
          upload.putBack();
          throw e;
        }
        reading = await readImage({ data, mediaType: upload.mediaType }, services);
        input = { kind: "screenshot", imageHash: sha256(data) };
      } else if (typeof url === "string" && url.trim()) {
        if (url.trim().length > MAX_SHARED_LINK) throw new HttpError(422, "That link is too long to check. Paste the store page's address instead.");
        takeCheck(sid);
        reading = await readLink(url, services);
        input = { kind: "link", url: url.trim() };
      } else {
        throw new HttpError(400, "Add a screenshot or paste a store link.");
      }
    } catch (e) {
      if (e instanceof CheckInputError) throw new HttpError(422, e.message);
      if (e instanceof ShareError) throw new HttpError(e.status, e.message);
      if (e instanceof ReaderOutputError) throw new HttpError(422, "We couldn't read that image. Try a sharper screenshot that shows the product name.");
      throw e;
    }
    const state = loadSession(sid);
    const today = appToday(state.dayOffset);
    const check = await buildCheck(reading, input, { shelf: state.shelf, budgets: state.budgets, today }, services);
    await updateSession(sid, (s) => {
      s.checks.push(check);
      if (s.checks.length > 40) s.checks = s.checks.slice(-40);
    });
    return Response.json({ id: check.id, verdict: check.decision.verdict, needsConfirmation: check.needsConfirmation });
  });
}
