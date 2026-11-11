import { baseUrl } from "@/lib/app/http";
import { MAX_SHARED_IMAGE_BYTES, MAX_SHARED_LINK, MAX_SHARED_TEXT, ShareError, saveSharedImage, type ShareErrorCode } from "@/lib/app/share";
import { CallBudget } from "@/lib/studio/llm";
import { envInt, GlobalBudget } from "@/lib/studio/guard";

const HOUR = 60 * 60 * 1000;
// Same allowances as checks. Keeping an upload costs no model call: the check
// itself runs later in the opening browser's session, under /api/check's limits.
const perClient = new CallBudget(envInt("CHECKS_PER_SESSION_PER_HOUR", 30), HOUR);
const allClients = new GlobalBudget(envInt("CHECKS_PER_HOUR", 300), HOUR);

/**
 * How to answer: a browser navigation (Android's share sheet posts a form)
 * gets a redirect; the iPhone Shortcut asks with `?reply=url` and gets the
 * page to open as plain text, even when the share is refused (the page then
 * says why); anything else gets JSON.
 */
type Reply = "page" | "url" | "json";
function replyFor(request: Request): Reply {
  if (new URL(request.url).searchParams.get("reply") === "url") return "url";
  if (request.headers.get("sec-fetch-mode") === "navigate") return "page";
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json") ? "page" : "json";
}

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

/** The shared image: a form field "image" (Shortcut) or "file" (Android), or the whole request body. */
async function readShare(request: Request): Promise<{ file?: Uint8Array; form?: FormData }> {
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data") || type.startsWith("application/x-www-form-urlencoded")) {
    const form = await request.formData().catch(() => null);
    if (!form) return {};
    const file = [form.get("image"), form.get("file")].find((v): v is File => v instanceof File && v.size > 0);
    return { form, file: file ? new Uint8Array(await file.arrayBuffer()) : undefined };
  }
  const body = new Uint8Array(await request.arrayBuffer());
  return body.byteLength ? { file: body } : {};
}

/**
 * Share a screenshot (multipart "image", Android's "file", or the raw image
 * as the request body) or a link ("url", "text", "title") from a phone. A
 * screenshot is kept for ten minutes under a one-time token; the answer is
 * the page to open: `{ verdictUrl }` as JSON, a 303 to it for a browser form
 * post, or the address alone as text for `?reply=url`.
 */
export async function POST(request: Request) {
  const reply = replyFor(request);
  const base = await baseUrl();
  const open = (verdictUrl: string, extra: Record<string, unknown> = {}) =>
    reply === "page" ? Response.redirect(verdictUrl, 303) : reply === "url" ? text(verdictUrl) : Response.json({ verdictUrl, ...extra });
  const fail = (status: number, code: ShareErrorCode, message?: string) => {
    const page = `${base}/check?share_error=${code}`;
    if (reply === "page") return Response.redirect(page, 303);
    if (reply === "url") return text(page);
    return Response.json({ error: message ?? new ShareError(status, code).message }, { status });
  };
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_SHARED_IMAGE_BYTES + 64 * 1024) return fail(413, "too-big");
    const { file, form } = await readShare(request);
    if (file) {
      if (file.byteLength > MAX_SHARED_IMAGE_BYTES) return fail(413, "too-big");
      if (!perClient.take(clientKey(request)) || !allClients.take()) return fail(429, "busy");
      const saved = await saveSharedImage(file);
      return open(`${base}/check?shared=${encodeURIComponent(saved.token)}`, { expiresAt: saved.expiresAt });
    }
    if (!form) return fail(400, "missing");
    // A link share needs no storage: hand it to /check, which validates it like the store-link box.
    const pick = (name: string, max: number) => {
      const v = form.get(name);
      return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
    };
    const url = pick("url", MAX_SHARED_LINK + 1);
    const text_ = pick("text", MAX_SHARED_TEXT);
    const title = pick("title", MAX_SHARED_TEXT);
    if (!url && !text_ && !title) return fail(400, "missing");
    const q = new URLSearchParams();
    if (url) q.set("url", url);
    if (text_) q.set("text", text_);
    if (title && !url && !text_) q.set("title", title);
    return open(`${base}/check?${q}`);
  } catch (e) {
    if (e instanceof ShareError) return fail(e.status, e.code);
    console.error("share failed:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    if (reply === "json") return Response.json({ error: "That didn't work. Try again." }, { status: 500 });
    return fail(500, "busy");
  }
}

function text(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
