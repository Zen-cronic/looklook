import { describe, expect, it, vi } from "vitest";
import { searchByImage } from "../channel3/api";
import { Channel3Client } from "../channel3/client";
import type { Product } from "../channel3/types";
import { buildCheck, confirmCheck, readImage, type CheckServices } from "../app/checks";
import { cachedImageSearch, imageSearchOn, liveCheckServices } from "../app/services";
import { MemoryShelfStore } from "../shelf";
import { CONFIRM_BELOW, checkScreenshot, imageEvidenceLine, matchWithImage, pickMatch, type ScreenshotFields } from "./index";

const attrs = {
  primaryActive: "vitamin-c",
  actives: ["vitamin-c"],
  texture: "",
  filter: "",
  area: "",
  spfBand: "",
  finish: "",
  form: "",
  use: "",
  coverage: "",
  shadeFamily: "",
  tint: "",
  effect: "",
  formula: "",
  purpose: "",
  style: "",
  noiseCancelling: "",
  type: "",
} as const;

function fields(over: Partial<ScreenshotFields> = {}): ScreenshotFields {
  return {
    isProduct: true,
    brand: "CeraVe",
    productName: "Skin Renewing Vitamin C Serum",
    variant: null,
    size: null,
    price: { amount: 28.99, currency: "USD" },
    source: "creator-post",
    store: "Ulta Beauty",
    category: "serum",
    attributes: { ...attrs, actives: [...attrs.actives] },
    legibility: 0.95,
    ...over,
  };
}

function product(id: string, brand: string, title: string, price = 28.99, slug = "face-serums"): Product {
  return { id, title, brands: [{ id: brand, name: brand }], category: { slug }, offers: [{ domain: "ulta.com", price: { price, currency: "USD" } }] };
}

const serum = product("p-serum", "CeraVe", "Skin Renewing Vitamin C Serum");
const cleanser = product("p-clean", "CeraVe", "Hydrating Facial Cleanser", 17.99, "face-cleansers");
const lotion = product("p-lotion", "CeraVe", "Daily Moisturizing Lotion", 19.99, "face-moisturizers");
const other = product("p-other", "TruSkin", "Vitamin C Serum", 29.99);

function reader(f: ScreenshotFields) {
  return { messages: { create: vi.fn().mockResolvedValue({ model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(f) }], usage: { input_tokens: 1, output_tokens: 1 } }) } };
}

const image = { data: "aW1hZ2U=", mediaType: "image/png" as const };

describe("matchWithImage", () => {
  it("keeps a confident text match whatever else the image returns", () => {
    const f = fields();
    const text = pickMatch(f, [serum]);
    expect(text.needsConfirmation).toBe(false);
    const withOthers = matchWithImage(f, text, [other, cleanser], [serum]);
    expect(withOthers.best?.product.id).toBe("p-serum");
    expect(withOthers.needsConfirmation).toBe(false);
    expect(withOthers.alternatives).toEqual(text.alternatives);
    expect(withOthers.byImage).toBe("none");
    expect(matchWithImage(f, text, [other, serum], [serum]).byImage).toBe("agrees");
  });

  it("leaves the text match exactly as it was when image search didn't run", () => {
    const f = fields();
    const text = pickMatch(f, [serum]);
    expect(matchWithImage(f, text, undefined, [serum])).toBe(text);
  });

  it("lets the image find the product when the name search came back unsure", () => {
    const f = fields();
    const text = pickMatch(f, [cleanser, lotion]);
    expect(text.needsConfirmation).toBe(true);
    const m = matchWithImage(f, text, [serum, other], [cleanser, lotion]);
    expect(m.best?.product.id).toBe("p-serum");
    expect(m.best!.confidence).toBeGreaterThanOrEqual(CONFIRM_BELOW);
    expect(m.needsConfirmation).toBe(false);
    expect(m.byImage).toBe("found");
  });

  it("still asks when the picture's product scores below the confirm bar", () => {
    // The name is cut off: only the brand and one word were legible.
    const f = fields({ productName: "Skin", price: null });
    const text = pickMatch(f, [cleanser]);
    expect(text.needsConfirmation).toBe(true);
    const m = matchWithImage(f, text, [serum], [cleanser]);
    expect(m.best?.product.id).toBe("p-serum");
    expect(m.best!.confidence).toBeLessThan(CONFIRM_BELOW);
    expect(m.needsConfirmation).toBe(true);
    expect(m.why).toContain("low-confidence");
  });

  it("agrees only when the product is among the first image hits", () => {
    const f = fields();
    const text = pickMatch(f, [serum]);
    expect(matchWithImage(f, text, [other, cleanser, lotion, serum], [serum]).byImage).toBe("none");
  });

  it("counts a same-title listing under another id as agreement", () => {
    const f = fields();
    const text = pickMatch(f, [serum]);
    expect(matchWithImage(f, text, [{ ...serum, id: "p-serum-2" }], [serum]).byImage).toBe("agrees");
  });
});

describe("checkScreenshot with image search", () => {
  const shelf = new MemoryShelfStore([]).list();

  it("starts the image search before the read finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const anthropic = reader(fields());
    const create = anthropic.messages.create;
    anthropic.messages.create = vi.fn(async (...args: unknown[]) => {
      await gate;
      return create(...args);
    });
    const searchImage = vi.fn().mockResolvedValue([serum]);
    const run = checkScreenshot({ image, shelf, today: "2026-11-12" }, { anthropic: anthropic as never, search: vi.fn().mockResolvedValue([serum]), priceBand: vi.fn().mockResolvedValue(null), searchImage });
    await Promise.resolve();
    expect(searchImage).toHaveBeenCalledWith(image);
    release();
    const r = await run;
    expect(r.match.byImage).toBe("agrees");
  });

  it("gives today's result when the image search fails", async () => {
    const deps = { search: vi.fn().mockResolvedValue([cleanser, lotion]), priceBand: vi.fn().mockResolvedValue(null) };
    const plain = await checkScreenshot({ image, shelf, today: "2026-11-12" }, { anthropic: reader(fields()) as never, ...deps });
    for (const searchImage of [vi.fn().mockRejectedValue(new Error("Channel3 402")), vi.fn(() => { throw new Error("sync"); })]) {
      const r = await checkScreenshot({ image, shelf, today: "2026-11-12" }, { anthropic: reader(fields()) as never, ...deps, searchImage: searchImage as never });
      const { byImage, ...match } = r.match;
      expect(byImage).toBe("none");
      expect(match).toEqual(plain.match);
      expect(r.decision.verdict).toBe(plain.decision.verdict);
    }
  });
});

describe("Channel3 image search request", () => {
  function fakeFetch(products: Product[] = [serum]) {
    return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ products, next_page_token: null }), { status: 200 }));
  }

  it("posts plain base64 with auto segmentation to /v1/image-search", async () => {
    const fetch = fakeFetch();
    const c3 = new Channel3Client({ apiKey: "k", fetch });
    const out = await searchByImage(c3, "data:image/png;base64,QUJD", { limit: 50 });
    expect(out.map((p) => p.id)).toEqual(["p-serum"]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.trychannel3.com/v1/image-search");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ base64_image: "QUJD", limit: 30, segment: "AUTO" });
  });

  it("calls Channel3 once for a repeated image", async () => {
    const fetch = fakeFetch();
    const c3 = new Channel3Client({ apiKey: "k", fetch });
    const store = new Map<string, unknown>();
    const cache = { get: <T,>(kind: string, key: string) => store.get(`${kind}/${key}`) as T | undefined, set: (kind: string, key: string, v: unknown) => void store.set(`${kind}/${key}`, v) };
    const search = cachedImageSearch(c3, cache);
    await search(image);
    const again = await search(image);
    expect(again.map((p) => p.id)).toEqual(["p-serum"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect([...store.keys()][0]).toMatch(/^image-search\/[0-9a-f]{64}$/);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ base64_image: image.data, limit: 10, segment: "AUTO" });
  });

  it("turns off with CHANNEL3_IMAGE_SEARCH=0", () => {
    expect(imageSearchOn({})).toBe(true);
    expect(imageSearchOn({ CHANNEL3_IMAGE_SEARCH: "0" })).toBe(false);
    const prev = { a: process.env.ANTHROPIC_API_KEY, f: process.env.CHANNEL3_IMAGE_SEARCH };
    process.env.ANTHROPIC_API_KEY ??= "test-key";
    try {
      process.env.CHANNEL3_IMAGE_SEARCH = "0";
      expect(liveCheckServices().searchImage).toBeUndefined();
      delete process.env.CHANNEL3_IMAGE_SEARCH;
      expect(typeof liveCheckServices().searchImage).toBe("function");
    } finally {
      if (prev.a === undefined) delete process.env.ANTHROPIC_API_KEY;
      if (prev.f === undefined) delete process.env.CHANNEL3_IMAGE_SEARCH;
      else process.env.CHANNEL3_IMAGE_SEARCH = prev.f;
    }
  });
});

describe("image search in the app's check pipeline", () => {
  const ctx = { shelf: [], budgets: { currency: "USD", limits: {}, spent: {} }, today: "2026-11-12" };
  const base = (over: Partial<CheckServices> = {}): CheckServices => ({
    anthropic: reader(fields()) as never,
    search: vi.fn().mockResolvedValue([cleanser, lotion]),
    lookup: vi.fn(),
    priceBand: vi.fn().mockResolvedValue(null),
    ...over,
  });

  it("reads without image products when image search is left out", async () => {
    const reading = await readImage(image, base());
    expect("imageProducts" in reading).toBe(false);
    const check = await buildCheck(reading, { kind: "screenshot", imageHash: "h" }, ctx, base());
    expect(check.byImage).toBeUndefined();
    expect(check.needsConfirmation).toBe(true);
  });

  it("matches an unsure screenshot by its picture and records the evidence", async () => {
    const services = base({ searchImage: vi.fn().mockResolvedValue([serum]) });
    const reading = await readImage(image, services);
    expect(reading.imageProducts?.map((p) => p.id)).toEqual(["p-serum"]);
    const check = await buildCheck(reading, { kind: "screenshot", imageHash: "h" }, ctx, services);
    expect(check.product?.id).toBe("p-serum");
    expect(check.needsConfirmation).toBe(false);
    expect(check.byImage).toBe("found");
  });

  it("drops the image evidence when the shopper confirms a different product", async () => {
    const services = base({ anthropic: reader(fields({ productName: "Skin", price: null })) as never, search: vi.fn().mockResolvedValue([cleanser]), searchImage: vi.fn().mockResolvedValue([serum]) });
    const check = await buildCheck(await readImage(image, services), { kind: "screenshot", imageHash: "h" }, ctx, services);
    expect(check.needsConfirmation).toBe(true);
    expect(check.byImage).toBe("found");
    expect(check.candidates[0].product.id).toBe("p-serum");
    const kept = await confirmCheck(check, check.candidates[0].product, ctx, services);
    expect(kept.byImage).toBe("found");
    const other = check.candidates.find((c) => c.product.id !== "p-serum")!;
    const changed = await confirmCheck(check, other.product, ctx, services);
    expect(changed.byImage).toBeUndefined();
  });
});

describe("imageEvidenceLine", () => {
  it("shows only for an uploaded screenshot, while filming too", () => {
    expect(imageEvidenceLine("agrees", { uploaded: true, film: false })).toBe("Channel3 image search found the same product.");
    expect(imageEvidenceLine("found", { uploaded: true, film: false })).toMatch(/Channel3 image search found this product/);
    expect(imageEvidenceLine("found", { uploaded: true, film: false, asking: true })).toBeNull();
    expect(imageEvidenceLine("agrees", { uploaded: true, film: true })).toBe("Channel3 image search found the same product.");
    expect(imageEvidenceLine("agrees", { uploaded: false, film: true })).toBeNull();
    expect(imageEvidenceLine("agrees", { uploaded: false, film: false })).toBeNull();
    expect(imageEvidenceLine("none", { uploaded: true, film: false })).toBeNull();
    expect(imageEvidenceLine(undefined, { uploaded: true, film: false })).toBeNull();
  });
});
