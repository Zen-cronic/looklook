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
    expect(sharedInput({ share_error: "too-big" })).toEqual({ kind: "error", message: "That image is over 5 MB. Crop it or take a smaller screenshot." });
    expect(sharedInput({ share_error: "<script>" })).toMatchObject({ kind: "error", message: expect.not.stringContaining("<script>") });
    expect(sharedInput({ shared: "<bad token>" })).toMatchObject({ kind: "error" });
  });
});

describe("screenshots shared to /api/share", () => {
  it("keeps a PNG under a token that opens once, with the same size and type limits as checks", async () => {
    const { saveSharedImage, claimSharedImage, MAX_SHARED_IMAGE_BYTES } = await import("./share");
    expect(MAX_SHARED_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    const bytes = png();
    const saved = saveSharedImage(bytes);
    expect(saved.mediaType).toBe("image/png");
    const first = claimSharedImage(saved.token);
    expect([...first.bytes]).toEqual([...bytes]);
    expect(() => claimSharedImage(saved.token)).toThrow(/expired or was already checked/);
    expect(() => saveSharedImage(new Uint8Array(MAX_SHARED_IMAGE_BYTES + 1).fill(0x89))).toThrow(/over 5 MB/);
    expect(() => saveSharedImage(new TextEncoder().encode("%PDF-1.7 not an image"))).toThrow(/PNG, JPEG, GIF or WebP/);
    expect(() => saveSharedImage(new Uint8Array(0))).toThrow(/no link or screenshot/);
  });

  it("refuses a token after ten minutes, a changed token and one signed with another secret", async () => {
    const { saveSharedImage, claimSharedImage, verifyShareToken, SHARE_TTL_MS } = await import("./share");
    expect(SHARE_TTL_MS).toBe(10 * 60 * 1000);
    const now = Date.parse("2026-11-08T20:00:00Z");
    const saved = saveSharedImage(png(), now);
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
    const a = saveSharedImage(png());
    saveSharedImage(png());
    expect(() => saveSharedImage(png())).toThrow(/busy/);
    claimSharedImage(a.token);
    expect(saveSharedImage(png()).token).toBeTruthy();
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
    const a = saveSharedImage(png());
    const b = saveSharedImage(png());
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
    const res = await POST(open(saveSharedImage(png()).token));
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
