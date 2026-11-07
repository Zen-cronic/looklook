import { describe, expect, it, vi } from "vitest";
import type { Product } from "../channel3/types";
import { MemoryShelfStore } from "../shelf";
import {
  CONFIRM_BELOW,
  checkScreenshot,
  parseScreenshotFields,
  pickMatch,
  readScreenshot,
  ReaderOutputError,
  SCREENSHOT_SCHEMA,
  searchQuery,
  sniffMediaType,
  toAttributes,
  toProductFacts,
  type ScreenshotFields,
} from "./index";

const nullAttrs = {
  primaryActive: "",
  actives: [],
  texture: "",
  filter: "",
  area: "",
  spfBand: "",
  finish: "",
  form: "",
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
    size: "1 fl oz",
    price: { amount: 28.99, currency: "USD" },
    source: "creator-post",
    store: "Ulta Beauty",
    category: "serum",
    attributes: { ...nullAttrs, primaryActive: "Vitamin-C", actives: ["vitamin-c", "ceramides"] },
    legibility: 0.95,
    ...over,
  };
}

function product(id: string, brand: string, title: string, price = 28.99, slug = "face-serums"): Product {
  return { id, title, brands: [{ id: brand, name: brand }], category: { slug }, offers: [{ domain: "ulta.com", price: { price, currency: "USD" } }] };
}

function client(text: string, stop = "end_turn") {
  return { messages: { create: vi.fn().mockResolvedValue({ model: "claude-sonnet-5-5", stop_reason: stop, content: [{ type: "text", text }], usage: { input_tokens: 1000, output_tokens: 200 } }) } };
}

describe("schema", () => {
  it("requires every property and forbids extras, as strict structured output needs", () => {
    expect(SCREENSHOT_SCHEMA.additionalProperties).toBe(false);
    expect([...SCREENSHOT_SCHEMA.required].sort()).toEqual(Object.keys(SCREENSHOT_SCHEMA.properties).sort());
    const attrs = SCREENSHOT_SCHEMA.properties.attributes;
    expect([...attrs.required].sort()).toEqual(Object.keys(attrs.properties).sort());
  });

  it("stays within the structured-output limit on union-typed fields", () => {
    const unions = JSON.stringify(SCREENSHOT_SCHEMA).match(/"anyOf"/g) ?? [];
    expect(unions.length).toBeLessThanOrEqual(16);
  });

  it("validates the reader's JSON", () => {
    expect(parseScreenshotFields(fields()).brand).toBe("CeraVe");
    expect(() => parseScreenshotFields({ ...fields(), legibility: 2 })).toThrow(ReaderOutputError);
    expect(() => parseScreenshotFields({ ...fields(), category: "candle" })).toThrow(ReaderOutputError);
    expect(() => parseScreenshotFields({ ...fields(), price: { amount: "12" } })).toThrow(ReaderOutputError);
  });

  it("turns reader attributes into shelf attributes", () => {
    expect(toAttributes(fields().attributes)).toEqual({ primaryActive: "vitamin-c", actives: ["vitamin-c", "ceramides"] });
  });
});

describe("readScreenshot", () => {
  const image = { data: "aGVsbG8=", mediaType: "image/png" as const };

  it("sends the image with a strict schema at low effort and parses the answer", async () => {
    const c = client(JSON.stringify(fields()));
    const r = await readScreenshot(image, { client: c as never });
    expect(r.fields.productName).toBe("Skin Renewing Vitamin C Serum");
    const params = c.messages.create.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } });
  });

  it("throws on a refusal, a truncated answer or non-JSON", async () => {
    await expect(readScreenshot(image, { client: client("{}", "refusal") as never })).rejects.toThrow(ReaderOutputError);
    await expect(readScreenshot(image, { client: client('{"isProd', "max_tokens") as never })).rejects.toThrow(/max_tokens/);
    await expect(readScreenshot(image, { client: client("not json") as never })).rejects.toThrow(/not JSON/);
  });

  it("sniffs image types from bytes", () => {
    expect(sniffMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMediaType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeUndefined();
  });
});

describe("pickMatch", () => {
  const exact = product("p1", "CeraVe", "Skin Renewing Vitamin C Serum");
  const other = product("p2", "CeraVe", "Skin Renewing Retinol Serum", 30);
  const wrongBrand = product("p3", "Vichy", "LiftActiv Vitamin C Serum", 20);

  it("picks the exact product with high confidence", () => {
    const m = pickMatch(fields(), [other, wrongBrand, exact]);
    expect(m.best?.product.id).toBe("p1");
    expect(m.best!.confidence).toBeGreaterThan(0.9);
    expect(m.needsConfirmation).toBe(false);
    expect(m.category).toBe("serum");
  });

  it("asks to confirm when the best match is weak", () => {
    const m = pickMatch(fields({ productName: "Glow Drops" }), [other, wrongBrand]);
    expect(m.needsConfirmation).toBe(true);
    expect(m.why).toContain("low-confidence");
  });

  it("caps confidence when the screenshot is barely legible", () => {
    const m = pickMatch(fields({ legibility: 0.3 }), [exact]);
    expect(m.best!.confidence).toBe(0.3);
    expect(m.needsConfirmation).toBe(true);
  });

  it("flags a near tie between different products", () => {
    const twin = product("p4", "CeraVe", "Vitamin C Serum, Skin Renewing");
    const m = pickMatch(fields({ price: null }), [exact, twin]);
    expect(m.why).toContain("close-runner-up");
  });

  it("handles no product and no results", () => {
    expect(pickMatch(fields({ isProduct: false }), [exact]).why).toEqual(["no-product"]);
    expect(pickMatch(fields(), []).why).toContain("no-results");
  });

  it("prefers the catalogue category and falls back to the reader's", () => {
    expect(pickMatch(fields({ category: "moisturizer" }), [exact]).category).toBe("serum");
    expect(pickMatch(fields(), [product("p5", "CeraVe", "Skin Renewing Vitamin C Serum", 28.99, "gift-sets")]).category).toBe("serum");
    expect(pickMatch(fields({ category: "other" }), [product("p5", "CeraVe", "Skin Renewing Vitamin C Serum", 28.99, "gift-sets")]).why).toContain("unknown-category");
  });

  it("keeps an unconfirmed match below the engine's identity threshold", () => {
    const m = pickMatch(fields({ productName: "Glow Drops" }), [other]);
    expect(toProductFacts(fields({ productName: "Glow Drops" }), m).identityConfidence).toBeLessThan(CONFIRM_BELOW);
    expect(searchQuery(fields())).toBe("CeraVe Skin Renewing Vitamin C Serum");
    expect(searchQuery(fields({ brand: null, productName: null }))).toBeUndefined();
  });
});

describe("checkScreenshot", () => {
  const shelf = new MemoryShelfStore([
    { id: "vitc", brand: "TruSkin", name: "Vitamin C Serum", category: "serum", attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c", "ceramides"] }, opened: true, runOutDate: "2027-01-15" },
  ]).list();

  it("reads, matches, decides and words the reason in that order", async () => {
    const anthropic = client(JSON.stringify(fields()));
    const search = vi.fn().mockResolvedValue([product("p1", "CeraVe", "Skin Renewing Vitamin C Serum")]);
    const priceBand = vi.fn().mockResolvedValue(null);
    const r = await checkScreenshot({ image: { data: "eA==", mediaType: "image/png" }, shelf, today: "2026-11-07" }, { anthropic: anthropic as never, search, priceBand });
    expect(search).toHaveBeenCalledWith("CeraVe Skin Renewing Vitamin C Serum");
    expect(r.decision).toMatchObject({ verdict: "skip", rule: "owns-similar" });
    expect(r.decision.evidence.policy?.retailerId).toBe("ulta");
    expect(r.reason.source).toBe("template");
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  it("answers ask, without a price lookup, when the match needs confirming", async () => {
    const anthropic = client(JSON.stringify(fields({ legibility: 0.2 })));
    const priceBand = vi.fn();
    const r = await checkScreenshot({ image: { data: "eA==", mediaType: "image/png" }, shelf, today: "2026-11-07" }, { anthropic: anthropic as never, search: vi.fn().mockResolvedValue([product("p1", "CeraVe", "Skin Renewing Vitamin C Serum")]), priceBand });
    expect(r.decision.verdict).toBe("ask");
    expect(priceBand).not.toHaveBeenCalled();
  });
});
