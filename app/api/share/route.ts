import { baseUrl } from "@/lib/app/http";
import { MAX_SHARED_IMAGE_BYTES, MAX_SHARED_LINK, MAX_SHARED_TEXT, ShareError, saveSharedImage, type ShareErrorCode } from "@/lib/app/share";
import { CallBudget } from "@/lib/studio/llm";
import { envInt, GlobalBudget } from "@/lib/studio/guard";

const HOUR = 60 * 60 * 1000;
// Same allowances as checks. Keeping an upload costs no model call: the check
// itself runs later in the opening browser's session, under /api/check's limits.
const perClient = new CallBudget(envInt("CHECKS_PER_SESSION_PER_HOUR", 30), HOUR);
const allClients = new GlobalBudget(envInt("CHECKS_PER_HOUR", 300), HOUR);

/** A browser navigation (Android's share sheet posts a form) gets a redirect; a Shortcut gets JSON. */
function wantsPage(request: Request): boolean {
  if (request.headers.get("sec-fetch-mode") === "navigate") return true;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

/**
 * Share a screenshot (multipart "image", or Android's "file") or a link
 * ("url", "text", "title") from a phone. A screenshot is kept for ten
 * minutes under a one-time token; the answer is the page to open:
 * `{ verdictUrl }` as JSON, or a 303 to it for a browser form post.
 */
export async function POST(request: Request) {
  const page = wantsPage(request);
  const base = await baseUrl();
  const fail = (status: number, code: ShareErrorCode, message?: string) =>
    page ? Response.redirect(`${base}/check?share_error=${code}`, 303) : Response.json({ error: message ?? new ShareError(status, code).message }, { status });
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_SHARED_IMAGE_BYTES + 64 * 1024) return fail(413, "too-big");
    const form = await request.formData().catch(() => null);
    if (!form) return fail(400, "missing");
    const file = [form.get("image"), form.get("file")].find((v): v is File => v instanceof File && v.size > 0);
    if (file) {
      if (file.size > MAX_SHARED_IMAGE_BYTES) return fail(413, "too-big");
      if (!perClient.take(clientKey(request)) || !allClients.take()) return fail(429, "busy");
      const saved = saveSharedImage(new Uint8Array(await file.arrayBuffer()));
      const verdictUrl = `${base}/check?shared=${encodeURIComponent(saved.token)}`;
      return page ? Response.redirect(verdictUrl, 303) : Response.json({ verdictUrl, expiresAt: saved.expiresAt });
    }
    // A link share needs no storage: hand it to /check, which validates it like the store-link box.
    const pick = (name: string, max: number) => {
      const v = form.get(name);
      return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
    };
    const url = pick("url", MAX_SHARED_LINK + 1);
    const text = pick("text", MAX_SHARED_TEXT);
    const title = pick("title", MAX_SHARED_TEXT);
    if (!url && !text && !title) return fail(400, "missing");
    const q = new URLSearchParams();
    if (url) q.set("url", url);
    if (text) q.set("text", text);
    if (title && !url && !text) q.set("title", title);
    const verdictUrl = `${base}/check?${q}`;
    return page ? Response.redirect(verdictUrl, 303) : Response.json({ verdictUrl });
  } catch (e) {
    if (e instanceof ShareError) return fail(e.status, e.code);
    console.error("share failed:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    return page ? Response.redirect(`${base}/check?share_error=busy`, 303) : Response.json({ error: "That didn't work. Try again." }, { status: 500 });
  }
}
