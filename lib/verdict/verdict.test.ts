import { describe, expect, it, vi } from "vitest";
import type { PriceBand } from "../channel3/band";
import { MemoryShelfStore, type ShelfItemInput } from "../shelf";
import { decide, templateReason, writeReason, type ProductFacts, type VerdictInput } from "./index";

const TODAY = "2026-11-07";

const shelfItems: ShelfItemInput[] = [
  { id: "vitc", brand: "TruSkin", name: "Vitamin C Serum", category: "serum", attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c"] }, opened: true, runOutDate: "2027-01-15" },
  { id: "cream", brand: "CeraVe", name: "Moisturizing Cream", category: "moisturizer", attributes: { texture: "cream", actives: ["ceramides"] }, opened: true, runOutDate: "2026-11-15" },
  { id: "gel", brand: "Neutrogena", name: "Hydro Boost Gel Cream", category: "moisturizer", attributes: { texture: "gel-cream", actives: ["hyaluronic-acid"] }, opened: false, runOutDate: null },
  { id: "spf", brand: "Supergoop!", name: "Unseen Sunscreen", category: "sunscreen", attributes: { filter: "chemical", area: "face", spfBand: "30-49", finish: "sheer" }, opened: true, runOutDate: "2026-12-30" },
  { id: "cleanser", brand: "CeraVe", name: "Hydrating Facial Cleanser", category: "cleanser", attributes: { form: "cream" }, opened: true, runOutDate: "2026-11-09" },
  { id: "lip", brand: "MAC", name: "Matte Lipstick", category: "lipstick", attributes: { shadeFamily: "nude", finish: "matte" }, opened: true, runOutDate: null },
];
const shelf = new MemoryShelfStore(shelfItems).list();

const flatBand = (p: number): PriceBand => ({ typical: p, low: p, high: p, latest: p, days: 90, usable: true, asOf: TODAY });

function product(over: Partial<ProductFacts>): ProductFacts {
  return { brand: "Brand", name: "Thing", category: "serum", attributes: {}, priceShown: 20, identityConfidence: 0.95, ...over };
}

function run(over: Partial<VerdictInput> & { product: ProductFacts }) {
  return decide({ store: "ulta", shelf, budgets: { skincare: 75, makeup: 45 }, priceBand: flatBand(over.product.priceShown ?? 20), today: TODAY, ...over });
}

describe("decide: identity", () => {
  it("asks when confidence is low or the category is unknown", () => {
    expect(run({ product: product({ identityConfidence: 0.5 }) })).toMatchObject({ verdict: "ask", rule: "identity-unconfirmed" });
    expect(run({ product: product({ category: undefined }) }).rule).toBe("identity-unconfirmed");
    expect(run({ product: product({ identityConfidence: Number.NaN }) }).verdict).toBe("ask");
  });

  it("accepts a low-confidence read once the user confirms it", () => {
    expect(run({ product: product({ identityConfidence: 0.3, identityConfirmed: true, attributes: { primaryActive: "peptides" } }) }).verdict).toBe("buy");
  });
});

describe("decide: owning it already", () => {
  it("skips the same product when one is unopened", () => {
    const d = run({ product: product({ brand: "Neutrogena", name: "Hydro Boost Gel Cream 1.7 oz", category: "moisturizer" }) });
    expect(d).toMatchObject({ verdict: "skip", rule: "owns-unopened" });
    expect(d.evidence.shelf).toMatchObject({ itemId: "gel", relation: "same-product" });
  });

  it("waits on the same opened product until near its run-out date", () => {
    const d = run({ product: product({ brand: "TruSkin", name: "Vitamin C Serum" }) });
    expect(d).toMatchObject({ verdict: "wait", rule: "not-needed-yet" });
    expect(d.evidence.waitUntil).toBe("2027-01-01");
  });

  it("waits when the same opened product has no run-out date", () => {
    expect(run({ product: product({ brand: "MAC", name: "Matte Lipstick", category: "lipstick", attributes: { shadeFamily: "nude", finish: "matte" } }) }).rule).toBe("run-out-unknown");
  });

  it("skips a near-duplicate and records the shelf item and the store policy", () => {
    const d = run({ product: product({ attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c", "ferulic-acid"] } }), store: "cvs" });
    expect(d).toMatchObject({ verdict: "skip", rule: "owns-similar", flags: ["non-returnable-opened"] });
    expect(d.evidence.shelf).toMatchObject({ itemId: "vitc", relation: "near-duplicate" });
    expect(d.evidence.policy).toMatchObject({ retailerId: "cvs", returnableOpened: "no" });
    expect(d.evidence.policy?.sourceUrl).toMatch(/^https:\/\/www\.cvs\.com\//);
  });

  it("skips a partial overlap only where opened returns aren't accepted", () => {
    const overlap = product({ category: "sunscreen", attributes: { filter: "mineral", area: "face", spfBand: "50+", finish: "sheer" } });
    expect(run({ product: overlap, store: "cvs" })).toMatchObject({ verdict: "skip", rule: "overlap-non-returnable" });
    expect(run({ product: overlap, store: "dermstore.com" }).rule).toBe("overlap-non-returnable");
    const atUlta = run({ product: overlap, store: "ulta" });
    expect(atUlta.verdict).toBe("buy");
    expect(atUlta.evidence.shelf?.relation).toBe("overlap");
  });

  it("does not skip a lookalike of something that is running out", () => {
    const d = run({ product: product({ category: "moisturizer", attributes: { texture: "cream", actives: ["ceramides"] } }) });
    expect(d).toMatchObject({ verdict: "buy", rule: "replacing-run-out" });
    expect(d.evidence.replaces).toMatchObject({ itemId: "cream", daysLeft: 8 });
  });
});

describe("decide: money and timing", () => {
  it("asks for a price when none was shown", () => {
    expect(run({ product: product({ priceShown: null, attributes: { primaryActive: "peptides" } }) })).toMatchObject({ verdict: "ask", rule: "price-unknown" });
  });

  it("waits when over the remaining budget", () => {
    const d = run({ product: product({ priceShown: 99, attributes: { primaryActive: "retinol" } }) });
    expect(d).toMatchObject({ verdict: "wait", rule: "over-budget" });
    expect(d.evidence.budget).toEqual({ group: "skincare", remaining: 75, price: 99 });
  });

  it("has no limit for a group without a budget", () => {
    expect(run({ product: product({ category: "blender", priceShown: 500, attributes: { type: "full-size" } }), priceBand: flatBand(500) }).verdict).toBe("buy");
  });

  it("waits without usable price history unless the need is urgent", () => {
    const fresh = product({ attributes: { primaryActive: "retinol" } });
    expect(run({ product: fresh, priceBand: null })).toMatchObject({ verdict: "wait", rule: "no-price-history" });
    expect(run({ product: fresh, priceBand: { ...flatBand(20), usable: false } }).rule).toBe("no-price-history");
    const cleanser = product({ category: "cleanser", attributes: { form: "foam" } });
    expect(run({ product: cleanser, priceBand: null })).toMatchObject({ verdict: "buy", rule: "replacing-run-out" });
  });

  it("waits for its usual low, with a target price", () => {
    const band: PriceBand = { typical: 40, low: 30, high: 40, latest: 40, days: 90, usable: true, asOf: TODAY };
    const d = run({ product: product({ priceShown: 40, attributes: { primaryActive: "retinol" } }), priceBand: band });
    expect(d).toMatchObject({ verdict: "wait", rule: "above-usual-price" });
    expect(d.evidence.price).toMatchObject({ shown: 40, low: 30, target: 31.5 });
    expect(run({ product: product({ priceShown: 31.5, attributes: { primaryActive: "retinol" } }), priceBand: band }).verdict).toBe("buy");
  });

  it("waits when well above typical even on a flat history", () => {
    expect(run({ product: product({ priceShown: 30, attributes: { primaryActive: "retinol" } }), priceBand: flatBand(20) }).rule).toBe("above-usual-price");
  });

  it("buys when nothing blocks it", () => {
    const d = run({ product: product({ attributes: { primaryActive: "retinol" } }) });
    expect(d).toMatchObject({ verdict: "buy", rule: "clear-to-buy" });
    expect(d.evidence.trace.at(-1)).toBe("clear-to-buy");
    expect(d.evidence.trace[0]).toBe("identity-unconfirmed");
  });

  it("is deterministic", () => {
    const input = { product: product({ attributes: { primaryActive: "vitamin-c" } }), store: "walgreens" };
    expect(run(input)).toEqual(run(input));
  });
});

describe("reasons", () => {
  const d = run({ product: product({ attributes: { primaryActive: "vitamin-c" } }), store: "cvs" });
  const p = product({ attributes: { primaryActive: "vitamin-c" } });

  it("builds a template from evidence only", () => {
    expect(templateReason(d, p)).toBe("You already own TruSkin Vitamin C Serum, which does the same job, and CVS Pharmacy may refuse it once opened.");
  });

  it("uses the model's sentence and never sends a verdict choice back", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "You already have a vitamin C serum open, and CVS may not take this back." }] });
    const r = await writeReason(d, p, { client: { messages: { create } } as never });
    expect(r.source).toBe("model");
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.output_config).toEqual({ effort: "low" });
    expect(JSON.parse(params.messages[0].content).verdict).toBe("skip");
  });

  it("falls back to the template on an error or an over-long answer", async () => {
    const failing = { messages: { create: vi.fn().mockRejectedValue(new Error("down")) } } as never;
    expect((await writeReason(d, p, { client: failing })).source).toBe("template");
    const long = { messages: { create: vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "x".repeat(300) }] }) } } as never;
    expect((await writeReason(d, p, { client: long })).source).toBe("template");
  });
});
