import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fitForReading, ImageFitError, MAX_UPLOAD_BYTES } from "../vision/fit";
import type { ScreenshotImage } from "../vision/read";

/**
 * The picture behind a shared link that isn't a store page: a post, an
 * article or an image opened in the browser. A link to an image is that image;
 * a web page gives its preview picture (`og:image`, `twitter:image`), the one
 * a chat app shows when the link is pasted. Only public web addresses are
 * fetched, with a short timeout and size caps, and redirects are checked the
 * same way.
 */

const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
export const PAGE_TIMEOUT_MS = 8000;

export type Resolve = (host: string) => Promise<string[]>;
export interface PageImageDeps {
  fetch?: typeof fetch;
  resolve?: Resolve;
}

const defaultResolve: Resolve = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** Loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

async function assertPublic(url: URL, resolve: Resolve): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not a web link");
  if (url.username || url.password) throw new Error("credentials in link");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("not a public address");
}

/** GET a public URL, following up to three redirects, each one checked; the body is capped at `max` bytes. */
async function getPublic(raw: string, accept: string, max: number, deps: PageImageDeps): Promise<{ type: string; bytes: Uint8Array; url: URL }> {
  const doFetch = deps.fetch ?? fetch;
  const resolve = deps.resolve ?? defaultResolve;
  let url = new URL(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url, resolve);
    const res = await doFetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: { accept, "user-agent": "Mozilla/5.0 (compatible; LookLook link preview)" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > max) throw new Error("too large");
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new Error("too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return { type: (res.headers.get("content-type") ?? "").toLowerCase(), bytes, url };
  }
  throw new Error("too many redirects");
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;|&#47;/gi, "/");

/** The page's preview picture: og:image (or its secure_url), twitter:image, or <link rel="image_src">. */
export function previewImageOf(html: string): string | undefined {
  const head = html.slice(0, MAX_PAGE_BYTES);
  const tags = head.match(/<(meta|link)\b[^>]*>/gi) ?? [];
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2).find((v) => v !== undefined);
  const wanted = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];
  for (const key of wanted) {
    for (const tag of tags) {
      const name = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
      const content = attr(tag, "content");
      if (name === key && content?.trim()) return decodeEntities(content.trim());
    }
  }
  for (const tag of tags) {
    if ((attr(tag, "rel") ?? "").toLowerCase() === "image_src" && attr(tag, "href")) return decodeEntities(attr(tag, "href")!.trim());
  }
  return undefined;
}

/**
 * The image to read for a shared link: the link itself when it is an image,
 * otherwise the page's preview picture. Undefined when there is none, the
 * address isn't public, or the image can't be used.
 */
export async function pageImage(link: string, deps: PageImageDeps = {}): Promise<ScreenshotImage | undefined> {
  try {
    const page = await getPublic(link, "text/html,application/xhtml+xml,image/*;q=0.9", MAX_UPLOAD_BYTES, deps);
    let bytes = page.bytes;
    if (!page.type.startsWith("image/")) {
      if (!page.type.includes("html")) return undefined;
      const src = previewImageOf(new TextDecoder().decode(page.bytes.slice(0, MAX_PAGE_BYTES)));
      if (!src) return undefined;
      const image = await getPublic(new URL(src, page.url).toString(), "image/*", MAX_UPLOAD_BYTES, deps);
      bytes = image.bytes;
    }
    const fitted = await fitForReading(bytes);
    return { data: Buffer.from(fitted.bytes).toString("base64"), mediaType: fitted.mediaType };
  } catch (e) {
    if (!(e instanceof ImageFitError)) console.warn("page image:", e instanceof Error ? e.message : e);
    return undefined;
  }
}
