import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "./session-cookie";

const SECRET = "test-secret-for-shares";
const env = { ...process.env };
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "share-data-"));
  process.env.APP_DATA_DIR = dir;
  process.env.SESSION_SECRET = SECRET;
});
afterAll(() => {
  process.env = env;
});
afterEach(() => {
  vi.resetModules();
  vi.doUnmock("next/headers");
  vi.doUnmock("./services");
  vi.doUnmock("./checks");
  delete process.env.CHECKS_PER_HOUR;
  delete process.env.CHECKS_PER_SESSION_PER_HOUR;
  delete process.env.SHARES_PENDING_MAX;
});

const png = (extra = 64) => {
  const b = new Uint8Array(8 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b[8] = Math.floor(Math.random() * 256);
  b[9] = Math.floor(Math.random() * 256);
  return b;
};

let cookieValue: string | undefined;
let headerValues: Record<string, string> = {};
function withRequest(cookie: string | undefined, headers: Record<string, string> = {}) {
  cookieValue = cookie;
  headerValues = headers;
  vi.doMock("next/headers", () => ({
    cookies: async () => ({ get: () => (cookieValue === undefined ? undefined : { value: cookieValue }) }),
    headers: async () => new Headers(headerValues),
  }));
}

const share = (body: FormData, headers: Record<string, string> = {}) => new Request("http://localhost/api/share", { method: "POST", body, headers });
const imageForm = (bytes: Uint8Array<ArrayBuffer>, field = "image", type = "image/png") => {
  const f = new FormData();
  f.set(field, new File([bytes], "shot.png", { type }));
  return f;
};

describe("links shared to /check", () => {
  it("checks a shared url, or the first link in shared text, like the store-link box", async () => {
    const { sharedInput, firstLink } = await import("./share");
    expect(sharedInput({})).toBeUndefined();
    expect(sharedInput({ url: "https://www.ulta.com/p/serum-123" })).toEqual({ kind: "url", url: "https://www.ulta.com/p/serum-123" });
    expect(sharedInput({ url: ["http://cvs.com/a", "https://b.example/"] })).toEqual({ kind: "url", url: "http://cvs.com/a" });
    expect(sharedInput({ text: "Look at this one! https://www.sephora.com/product/x-P1?skuId=2. Worth it?" })).toEqual({ kind: "url", url: "https://www.sephora.com/product/x-P1?skuId=2" });
    expect(sharedInput({ title: "Serum", text: "no link here", url: undefined })).toMatchObject({ kind: "error" });
    expect(sharedInput({ title: "Shared from Safari https://www.target.com/p/-/A-1" })).toEqual({ kind: "url", url: "https://www.target.com/p/-/A-1" });
    expect(firstLink("(https://www.ulta.com/p/a).")).toBe("https://www.ulta.com/p/a");
    // url wins over text, as Android sends both.
    expect(sharedInput({ url: "https://www.ulta.com/p/a", text: "https://other.example/b" })).toEqual({ kind: "url", url: "https://www.ulta.com/p/a" });
  });

  it("refuses links that aren't web links, and overlong ones, with the box's messages", async () => {
    const { sharedInput, MAX_SHARED_LINK } = await import("./share");
    expect(MAX_SHARED_LINK).toBe(2048);
    expect(sharedInput({ url: "javascript:alert(1)" })).toEqual({ kind: "error", message: "Only web links (https://) can be checked." });
    expect(sharedInput({ url: "ftp://files.example/x" })).toEqual({ kind: "error", message: "Only web links (https://) can be checked." });
    expect(sharedInput({ url: "not a link" })).toEqual({ kind: "error", message: "That doesn't look like a link. Paste the full store address, starting with https://" });
    const long = `https://www.ulta.com/p/${"a".repeat(MAX_SHARED_LINK)}`;
    expect(sharedInput({ url: long })).toMatchObject({ kind: "error", message: expect.stringMatching(/too long/) });
    expect(sharedInput({ text: `see ${long}` })).toMatchObject({ kind: "error", message: expect.stringMatching(/too long/) });
    // Error codes from /api/share become fixed sentences; nothing from the query is echoed.
    expect(sharedInput({ share_error: "too-big" })).toEqual({ kind: "error", message: "That image is over 15 MB. Crop it or take a smaller screenshot." });
    expect(sharedInput({ share_error: "<script>" })).toMatchObject({ kind: "error", message: expect.not.stringContaining("<script>") });
    expect(sharedInput({ shared: "<bad token>" })).toMatchObject({ kind: "error" });
  });
});

describe("screenshots shared to /api/share", () => {
  it("keeps a PNG under a token that opens once, with the same size and type limits as checks", async () => {
    const { saveSharedImage, claimSharedImage, MAX_SHARED_IMAGE_BYTES } = await import("./share");
    expect(MAX_SHARED_IMAGE_BYTES).toBe(15 * 1024 * 1024);
    const bytes = png();
    const saved = await saveSharedImage(bytes);
    expect(saved.mediaType).toBe("image/png");
    const first = claimSharedImage(saved.token);
    expect([...first.bytes]).toEqual([...bytes]);
    expect(() => claimSharedImage(saved.token)).toThrow(/expired or was already checked/);
    await expect(saveSharedImage(new Uint8Array(MAX_SHARED_IMAGE_BYTES + 1).fill(0x89))).rejects.toThrow(/over 15 MB/);
    await expect(saveSharedImage(new TextEncoder().encode("%PDF-1.7 not an image"))).rejects.toThrow(/PNG, JPEG, GIF or WebP/);
    await expect(saveSharedImage(new Uint8Array(0))).rejects.toThrow(/no link or screenshot/);
  });

  it("refuses a token after ten minutes, a changed token and one signed with another secret", async () => {
    const { saveSharedImage, claimSharedImage, verifyShareToken, SHARE_TTL_MS } = await import("./share");
    expect(SHARE_TTL_MS).toBe(10 * 60 * 1000);
    const now = Date.parse("2026-11-08T20:00:00Z");
    const saved = await saveSharedImage(png(), now);
    expect(saved.expiresAt).toBe(new Date(now + SHARE_TTL_MS).toISOString());
    expect(() => claimSharedImage(saved.token, now + SHARE_TTL_MS + 1)).toThrow(/expired/);
    const [id, exp, mac] = saved.token.split(".");
    const later = (Number.parseInt(exp, 36) + 60 * 60 * 1000).toString(36);
    expect(() => verifyShareToken(`${id}.${later}.${mac}`, now)).toThrow(/expired/);
    expect(() => verifyShareToken(`${"0".repeat(32)}.${exp}.${mac}`, now)).toThrow(/expired/);
    expect(() => verifyShareToken(saved.token, now, "another-secret")).toThrow(/expired/);
    // Inside the window the same token still opens.
    expect(verifyShareToken(saved.token, now + SHARE_TTL_MS - 1)).toBe(id);
  });

  it("keeps at most SHARES_PENDING_MAX unopened screenshots", async () => {
    process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "share-cap-"));
    process.env.SHARES_PENDING_MAX = "2";
    const { saveSharedImage, claimSharedImage } = await import("./share");
    const a = await saveSharedImage(png());
    await saveSharedImage(png());
    await expect(saveSharedImage(png())).rejects.toThrow(/busy/);
    claimSharedImage(a.token);
    expect((await saveSharedImage(png())).token).toBeTruthy();
    expect(readdirSync(join(process.env.APP_DATA_DIR, "shared"))).toHaveLength(2);
    process.env.APP_DATA_DIR = dir;
  });

  it("answers a Shortcut with the page to open, and a browser form post with a redirect", async () => {
    withRequest(undefined, { host: "looklook.example", "x-forwarded-proto": "https" });
    const { POST } = await import("../../app/api/share/route");
    const res = await POST(share(imageForm(png())));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verdictUrl: string; expiresAt: string };
    expect(body.verdictUrl).toMatch(/^https:\/\/looklook\.example\/check\?shared=[A-Za-z0-9_.%-]+$/);
    // Android's share sheet posts the file as "file" and navigates.
    const nav = await POST(share(imageForm(png(), "file"), { "sec-fetch-mode": "navigate" }));
    expect(nav.status).toBe(303);
    expect(nav.headers.get("location")).toMatch(/^https:\/\/looklook\.example\/check\?shared=/);
    const link = new FormData();
    link.set("title", "Serum");
    link.set("text", "Look https://www.ulta.com/p/serum-1");
    const linkNav = await POST(share(link, { "sec-fetch-mode": "navigate" }));
    expect(linkNav.headers.get("location")).toBe("https://looklook.example/check?text=Look+https%3A%2F%2Fwww.ulta.com%2Fp%2Fserum-1");
    const bad = await POST(share(imageForm(new TextEncoder().encode("plain text, not an image")), { "sec-fetch-mode": "navigate" }));
    expect(bad.headers.get("location")).toBe("https://looklook.example/check?share_error=type");
    const empty = await POST(share(new FormData()));
    expect(empty.status).toBe(400);
  });

  it("limits uploads per phone and across all phones, and never calls a model", async () => {
    process.env.CHECKS_PER_SESSION_PER_HOUR = "2";
    process.env.CHECKS_PER_HOUR = "3";
    withRequest(undefined);
    const { POST } = await import("../../app/api/share/route");
    const from = (ip: string) => POST(share(imageForm(png()), { "x-forwarded-for": `${ip}, 10.0.0.1` }));
    const statuses = [];
    for (const ip of ["1.1.1.1", "1.1.1.1", "1.1.1.1", "2.2.2.2", "3.3.3.3"]) statuses.push((await from(ip)).status);
    expect(statuses).toEqual([200, 200, 429, 200, 429]);
    const last = (await (await from("4.4.4.4")).json()) as { error: string };
    expect(last.error).toMatch(/try again/i);
    // The route file has no model or catalogue client in it.
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("app/api/share/route.ts", "utf8")).not.toMatch(/anthropic|channel3|readImage|services/i);
  });
});

describe("opening a shared screenshot runs a normal check", () => {
  function mockReader() {
    const reads: string[] = [];
    vi.doMock("./services", () => ({ missingKeys: () => [], liveCheckServices: () => ({ cache: { get: () => undefined } }) }));
    vi.doMock("./checks", async (orig) => ({
      ...(await orig<typeof import("./checks")>()),
      readImage: async (img: { mediaType: string }) => {
        reads.push(img.mediaType);
        throw new (await orig<typeof import("./checks")>()).CheckInputError("stop here");
      },
    }));
    return reads;
  }
  const open = (token: string) => {
    const f = new FormData();
    f.set("shared", token);
    return new Request("http://localhost/api/check", { method: "POST", body: f });
  };

  it("reads the screenshot in the opening browser's session, once, under the check limits", async () => {
    process.env.CHECKS_PER_SESSION_PER_HOUR = "1";
    const reads = mockReader();
    const { saveSharedImage } = await import("./share");
    withRequest(await signSession("sharesession0001", SECRET));
    const { POST } = await import("../../app/api/check/route");
    const a = await saveSharedImage(png());
    const b = await saveSharedImage(png());
    expect((await POST(open(a.token))).status).toBe(422);
    expect(reads).toEqual(["image/png"]);
    // Used once: opening the same link again finds nothing.
    const again = await POST(open(a.token));
    expect(again.status).toBe(410);
    // Over the session's limit: 429, and the screenshot is kept so the link works later.
    const limited = await POST(open(b.token));
    expect(limited.status).toBe(429);
    expect(reads).toHaveLength(1);
    vi.resetModules();
    process.env.CHECKS_PER_SESSION_PER_HOUR = "5";
    mockReader();
    withRequest(await signSession("sharesession0001", SECRET));
    const fresh = await import("../../app/api/check/route");
    expect((await fresh.POST(open(b.token))).status).toBe(422);
  });

  it("needs the browser's signed session, like every check", async () => {
    mockReader();
    const { saveSharedImage } = await import("./share");
    withRequest("aaaaaaaaaaaaaaaaaaaaaaaa");
    const { POST } = await import("../../app/api/check/route");
    const res = await POST(open((await saveSharedImage(png())).token));
    expect(res.status).toBe(401);
  });
});

describe("web app manifest", () => {
  it("puts LookLook in Android's share sheet, posting links and screenshots to /api/share, with installable icons", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { default: manifest } = await import("../../app/manifest");
    const m = manifest();
    expect(m.name).toBe("LookLook");
    expect(m.start_url).toBe("/check");
    expect(m.display).toBe("standalone");
    // Theme colour is the page token, the same one the layout gives the browser.
    const paper = readFileSync("app/globals.css", "utf8").match(/--paper:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(m.theme_color).toBe(paper);
    expect(readFileSync("app/layout.tsx", "utf8")).toContain(`themeColor: "${paper}"`);
    expect(m.share_target).toEqual({
      action: "/api/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "file", accept: expect.arrayContaining(["image/png", "image/jpeg"]) }] },
    });
    // Each PNG icon is the size it claims (width and height from the PNG header).
    const pngs = (m.icons ?? []).filter((i) => i.type === "image/png");
    expect(pngs.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(pngs.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of m.icons ?? []) {
      const path = `public${icon.src}`;
      expect(existsSync(path), path).toBe(true);
      if (icon.type !== "image/png") continue;
      const b = readFileSync(path);
      expect(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`, path).toBe(icon.sizes);
    }
    // The manifest, icons and /api/share are served without issuing a session.
    const matcher = (await import("../../proxy")).config.matcher[0];
    for (const p of ["manifest.webmanifest", "icons/", "api/share"]) expect(matcher).toContain(p);
  });
});

describe("the iPhone Shortcut's requests", () => {
  it("opens a link pasted into /s as it is, its own ? and & included", async () => {
    const { linkFromRawQuery } = await import("./share");
    expect(linkFromRawQuery("?u=https://www.ulta.com/p/serum?sku=1&color=red")).toBe("https://www.ulta.com/p/serum?sku=1&color=red");
    expect(linkFromRawQuery("?u=https%3A%2F%2Fshop.example%2Fp%3Fa%3D1")).toBe("https://shop.example/p?a=1");
    expect(linkFromRawQuery("?u=https://a.example/x%20y")).toBe("https://a.example/x%20y");
    // Two links pasted in (a text share with two): the first one.
    expect(linkFromRawQuery("?u=https://a.example/one%0Ahttps://b.example/two")).toBe("https://a.example/one");
    expect(linkFromRawQuery("?x=1&u=https://a.example/")).toBe("https://a.example/");
    expect(linkFromRawQuery("?u=")).toBeUndefined();
    expect(linkFromRawQuery("")).toBeUndefined();

    withRequest(undefined, { host: "looklook.example", "x-forwarded-proto": "https" });
    const { GET } = await import("../../app/s/route");
    const res = await GET(new Request("https://looklook.example/s?u=https://www.ulta.com/p/serum?sku=1&color=red"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://looklook.example/check?url=https%3A%2F%2Fwww.ulta.com%2Fp%2Fserum%3Fsku%3D1%26color%3Dred");
    const empty = await GET(new Request("https://looklook.example/s"));
    expect(empty.headers.get("location")).toBe("https://looklook.example/check?share_error=missing");
  });

  it("takes the converted image as the whole request body and answers with the page to open as text", async () => {
    withRequest(undefined, { host: "looklook.example", "x-forwarded-proto": "https" });
    const { POST } = await import("../../app/api/share/route");
    const raw = (body: Uint8Array<ArrayBuffer>, type = "image/jpeg") => new Request("http://localhost/api/share?reply=url", { method: "POST", body, headers: { "content-type": type } });
    const ok = await POST(raw(png(), "image/png"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await ok.text()).toMatch(/^https:\/\/looklook\.example\/check\?shared=[A-Za-z0-9_.%-]+$/);
    // Refused: still a page to open, which says why.
    const bad = await POST(raw(new TextEncoder().encode("not an image"), "application/octet-stream"));
    expect(await bad.text()).toBe("https://looklook.example/check?share_error=type");
    const empty = await POST(raw(new Uint8Array(0)));
    expect(await empty.text()).toBe("https://looklook.example/check?share_error=missing");
    // A multipart form with ?reply=url gets the same plain answer.
    const form = await POST(new Request("http://localhost/api/share?reply=url", { method: "POST", body: imageForm(png()) }));
    expect(await form.text()).toMatch(/\/check\?shared=/);
  });
});

describe("phone-sized images", () => {
  /** A real PNG of random pixels: it doesn't compress, so it is as large as a busy phone screenshot. */
  async function noisePng(width: number, height: number) {
    const sharp = (await import("sharp")).default;
    const pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761) >>> 24;
    return new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer());
  }

  it("scales a large screenshot to the reader's size and keeps small ones byte for byte", async () => {
    const { fitForReading, READ_AS_IS_BYTES, READ_EDGE } = await import("../vision/fit");
    const sharp = (await import("sharp")).default;
    const big = await noisePng(1290, 2796);
    expect(big.byteLength).toBeGreaterThan(READ_AS_IS_BYTES);
    const fitted = await fitForReading(big);
    expect(fitted.resized).toBe(true);
    expect(fitted.mediaType).toBe("image/jpeg");
    // Base64 of the result stays under the reader's 5 MB.
    expect(Buffer.from(fitted.bytes).toString("base64").length).toBeLessThan(5 * 1024 * 1024);
    const meta = await sharp(fitted.bytes).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(READ_EDGE);
    expect(meta.height! / meta.width!).toBeCloseTo(2796 / 1290, 1);
    // A JPEG that is small already is not touched.
    const jpeg = new Uint8Array(await sharp(big).resize(600).jpeg().toBuffer());
    const same = await fitForReading(jpeg);
    expect(same.resized).toBe(false);
    expect(same.bytes).toBe(jpeg);
    // A tall scrolling capture over the edge limit is scaled even when the file is small.
    const tall = new Uint8Array(await sharp({ create: { width: 400, height: 9000, channels: 3, background: "#ffffff" } }).png().toBuffer());
    expect((await fitForReading(tall)).resized).toBe(true);
  });

  it("keeps a large shared screenshot at the reader's size, and refuses HEIC with a way out", async () => {
    const { saveSharedImage, claimSharedImage } = await import("./share");
    const saved = await saveSharedImage(await noisePng(1290, 2796));
    expect(saved.mediaType).toBe("image/jpeg");
    expect(claimSharedImage(saved.token).bytes.byteLength).toBeLessThan(3.5 * 1024 * 1024);
    const heic = new Uint8Array(64);
    heic.set([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")]);
    await expect(saveSharedImage(heic)).rejects.toThrow(/HEIC format.*Take a screenshot/);
  });

  it("checks a large screenshot from the upload box after scaling it", async () => {
    const reads: { mediaType: string; size: number }[] = [];
    vi.doMock("./services", () => ({ missingKeys: () => [], liveCheckServices: () => ({ cache: { get: () => undefined } }) }));
    vi.doMock("./checks", async (orig) => ({
      ...(await orig<typeof import("./checks")>()),
      readImage: async (img: { mediaType: string; data: string }) => {
        reads.push({ mediaType: img.mediaType, size: img.data.length });
        throw new (await orig<typeof import("./checks")>()).CheckInputError("stop here");
      },
    }));
    withRequest(await signSession("sharesession0002", SECRET));
    const { POST } = await import("../../app/api/check/route");
    const f = new FormData();
    f.set("image", new File([await noisePng(1290, 2796)], "IMG_0001.PNG", { type: "image/png" }));
    expect((await POST(new Request("http://localhost/api/check", { method: "POST", body: f }))).status).toBe(422);
    expect(reads).toHaveLength(1);
    expect(reads[0].mediaType).toBe("image/jpeg");
    expect(reads[0].size).toBeLessThan(5 * 1024 * 1024);
  });
});

describe("a shared link that isn't a store page", () => {
  const html = (head: string) => new Response(`<!doctype html><html><head>${head}</head><body>post</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
  const publicDns = async () => ["93.184.216.34"];

  it("reads the page's preview picture, or the image the link points at", async () => {
    const sharp = (await import("sharp")).default;
    const jpeg = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#e0d0c0" } }).jpeg().toBuffer());
    const { pageImage, previewImageOf } = await import("./page-image");
    expect(previewImageOf(`<meta property="og:image" content="https://cdn.example/a.jpg?w=1&amp;h=2">`)).toBe("https://cdn.example/a.jpg?w=1&h=2");
    expect(previewImageOf(`<meta content='/b.png' name='twitter:image'>`)).toBe("/b.png");
    expect(previewImageOf(`<meta property="og:title" content="x">`)).toBeUndefined();
    const asked: string[] = [];
    const fake = (async (input: URL | RequestInfo) => {
      const url = String(input);
      asked.push(url);
      if (url === "https://posts.example/p/1") return html(`<meta property="og:image" content="/img/1.jpg">`);
      if (url === "https://posts.example/img/1.jpg") return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
      if (url === "https://posts.example/moved") return new Response(null, { status: 302, headers: { location: "/p/1" } });
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    const fromPage = await pageImage("https://posts.example/p/1", { fetch: fake, resolve: publicDns });
    expect(fromPage).toEqual({ mediaType: "image/jpeg", data: Buffer.from(jpeg).toString("base64") });
    expect(await pageImage("https://posts.example/img/1.jpg", { fetch: fake, resolve: publicDns })).toMatchObject({ mediaType: "image/jpeg" });
    expect(await pageImage("https://posts.example/moved", { fetch: fake, resolve: publicDns })).toMatchObject({ mediaType: "image/jpeg" });
    expect(await pageImage("https://posts.example/none", { fetch: fake, resolve: publicDns })).toBeUndefined();
  });

  it("never fetches a private or local address, including through a redirect", async () => {
    const { pageImage, isPrivateAddress, PAGE_TIMEOUT_MS } = await import("./page-image");
    expect(PAGE_TIMEOUT_MS).toBe(8000);
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
    const asked: string[] = [];
    const fake = (async (input: URL | RequestInfo) => {
      asked.push(String(input));
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }) as typeof fetch;
    expect(await pageImage("http://127.0.0.1:4880/api/state", { fetch: fake, resolve: publicDns })).toBeUndefined();
    expect(await pageImage("https://internal.example/", { fetch: fake, resolve: async () => ["10.0.0.5"] })).toBeUndefined();
    expect(await pageImage("https://posts.example/p", { fetch: fake, resolve: publicDns })).toBeUndefined();
    // Only the public page was asked for; the redirect to the metadata address was not followed.
    expect(asked).toEqual(["https://posts.example/p"]);
  });

  it("checks the picture when the catalogue doesn't know the link, and says so when there is none", async () => {
    const { readLink, CheckInputError } = await import("./checks");
    const base = {
      anthropic: {} as never,
      search: async () => [],
      lookup: async () => {
        throw new Error("not found");
      },
      priceBand: async () => null,
    };
    const image = { data: "aGVsbG8=", mediaType: "image/png" as const };
    const cached = { fields: { isProduct: true }, products: [] };
    const store = new Map<string, unknown>([[`reading:${(await import("./checks")).sha256(image.data)}`, cached]]);
    const cache = { get: <T,>(k: string, key: string) => store.get(`${k}:${key}`) as T | undefined, set: (k: string, key: string, v: unknown) => void store.set(`${k}:${key}`, v) };
    const reading = await readLink("https://posts.example/p/1", { ...base, cache, pageImage: async () => image });
    expect(reading).toEqual({ ...cached, picture: true });
    await expect(readLink("https://posts.example/p/2", { ...base, pageImage: async () => undefined })).rejects.toThrow(CheckInputError);
    await expect(readLink("https://posts.example/p/2", base)).rejects.toThrow(/catalogue or a picture on the page/);
  });
});
