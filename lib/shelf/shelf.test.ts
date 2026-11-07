import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PayPalApiError } from "../paypal";
import {
  CATEGORY_SPECS,
  CATEGORIES,
  JsonShelfStore,
  MemoryShelfStore,
  NEAR_DUPLICATE,
  ShelfValidationError,
  categoryFromSlug,
  identityKey,
  importAppOrders,
  importPayPalActivity,
  parseShelfSku,
  rankShelf,
  sameProduct,
  shelfSku,
  sameType,
  similarity,
  compareAttribute,
  TYPE_WEIGHT,
  type Attributes,
  type Category,
  type ShelfItemInput,
} from "./index";

const vitC: ShelfItemInput = {
  id: "vitc",
  name: "Vitamin C Serum",
  brand: "TruSkin",
  category: "serum",
  attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c", "hyaluronic-acid", "vitamin-e"] },
  opened: true,
  runOutDate: "2027-01-15",
};

describe("category specs", () => {
  it("weights each category's type and details to 1", () => {
    for (const c of CATEGORIES) {
      const spec = CATEGORY_SPECS[c];
      const total = (spec.type?.weight ?? TYPE_WEIGHT) + spec.details.reduce((s, a) => s + a.weight, 0);
      expect(total).toBeCloseTo(1, 9);
    }
  });

  it("maps catalogue slugs, using the path when the leaf is unknown", () => {
    expect(categoryFromSlug("face-serums")).toBe("serum");
    expect(categoryFromSlug("something-new", ["beauty", "lipstick"])).toBe("lipstick");
    expect(categoryFromSlug("candles")).toBeUndefined();
  });
});

describe("similarity", () => {
  const sim = (category: Category, a: Attributes, b: Attributes) => similarity({ category, attributes: a }, { category, attributes: b });

  it("scores different categories 0", () => {
    expect(similarity({ category: "serum", attributes: {} }, { category: "moisturizer", attributes: {} }).score).toBe(0);
  });

  it("scores the same main active as a near-duplicate", () => {
    const r = similarity({ category: "serum", attributes: { primaryActive: "Vitamin C", actives: ["vitamin c", "ferulic-acid", "vitamin-e"] } }, { category: "serum", attributes: vitC.attributes });
    expect(r.score).toBeGreaterThanOrEqual(NEAR_DUPLICATE);
    expect(r.matched).toEqual(["primaryActive"]);
    expect(r.sameType).toBe(true);
  });

  it("scores a different main active low, with no floor for sharing the category", () => {
    const r = similarity({ category: "serum", attributes: { primaryActive: "retinol", actives: ["retinol"] } }, { category: "serum", attributes: vitC.attributes });
    expect(r.score).toBe(0);
    expect(r.sameType).toBe(false);
  });

  it("counts the share of the new item's actives you already own", () => {
    // A cream with ceramides and hyaluronic acid against a gel cream with hyaluronic acid only: half covered.
    expect(sim("moisturizer", { texture: "cream", actives: ["ceramides", "hyaluronic-acid"] }, { texture: "gel-cream", actives: ["hyaluronic-acid"] }).score).toBe(0.75);
    // The other way round, everything in the gel cream is already in the cream.
    expect(sim("moisturizer", { texture: "gel-cream", actives: ["hyaluronic-acid"] }, { texture: "cream", actives: ["ceramides", "hyaluronic-acid"] }).score).toBe(0.85);
  });

  it("gives neighbouring finishes, coverages and forms half credit", () => {
    // Concealer: natural vs radiant, full vs medium, shade unknown.
    expect(sim("concealer", { finish: "natural", coverage: "full" }, { finish: "radiant", coverage: "medium" }).score).toBe(0.75);
    // Matte vs radiant is two steps apart.
    expect(sim("concealer", { finish: "matte", coverage: "full" }, { finish: "radiant", coverage: "medium" }).score).toBe(0.65);
    // Gel vs cream cleanser: one step on the form scale.
    expect(sim("cleanser", { form: "gel" }, { form: "cream", actives: ["ceramides"] }).score).toBe(0.75);
    // Foam vs cream: two steps.
    expect(sim("cleanser", { form: "foam" }, { form: "cream" }).score).toBe(0.6);
    // Setting spray: matte vs natural.
    expect(sim("setting-spray", { finish: "matte" }, { finish: "natural" }).score).toBe(0.75);
    // Aliases fold onto the scale: dewy is radiant.
    expect(compareAttribute({ key: "finish", weight: 1, kind: "equal", scale: ["matte", "natural", "radiant"], aliases: { dewy: "radiant" } }, "dewy", "radiant")).toBe(1);
  });

  it("scores lip oils by tint and shade, and lipsticks by shade first", () => {
    expect(sim("lip-oil", { tint: "tinted", shadeFamily: "pink" }, { tint: "tinted", shadeFamily: "pink" }).score).toBe(1);
    expect(sim("lip-oil", { tint: "clear", shadeFamily: "clear" }, { tint: "tinted", shadeFamily: "pink" }).score).toBe(0.625);
    expect(sim("lipstick", { shadeFamily: "red", finish: "matte" }, { shadeFamily: "nude", finish: "matte" }).score).toBe(0.4);
    expect(sim("lipstick", { shadeFamily: "nude", finish: "matte" }, { shadeFamily: "nude", finish: "matte" }).score).toBe(0.9);
  });

  it("never calls two items near-duplicates on the type alone", () => {
    // Two full-size blenders: same type, capacity and power unknown.
    const blenders = sim("blender", { type: "full-size" }, { type: "full-size" });
    expect(blenders.score).toBe(0.75);
    expect(blenders.score).toBeLessThan(NEAR_DUPLICATE);
    // Two matte, medium, liquid foundations: the shade is not known, so not a perfect match.
    expect(sim("foundation", { finish: "matte", coverage: "medium", form: "liquid" }, { finish: "matte", coverage: "medium", form: "liquid" }).score).toBe(0.95);
    // Nothing known at all within a one-at-a-time category.
    expect(sim("cleanser", {}, {}).score).toBe(0.75);
  });

  it("keeps earbuds apart from over-ear headphones but on-ear close", () => {
    const overEar = { style: "over-ear", noiseCancelling: "yes" };
    expect(sim("headphones", { style: "earbuds", noiseCancelling: "yes" }, overEar).score).toBe(0.4);
    expect(sim("headphones", { style: "on-ear", noiseCancelling: "yes" }, overEar).score).toBe(0.65);
    expect(sim("headphones", { style: "over-ear", noiseCancelling: "yes" }, overEar).score).toBe(0.9);
  });

  it("is deterministic and symmetric for single-value attributes", () => {
    const a = { category: "sunscreen" as const, attributes: { filter: "chemical", area: "face", spfBand: "50+", finish: "matte" } };
    const b = { category: "sunscreen" as const, attributes: { filter: "chemical", area: "face", spfBand: "30-49", finish: "sheer" } };
    expect(similarity(a, b)).toEqual(similarity(b, a));
    expect(similarity(a, b).score).toBe(0.875);
  });

  it("gives an unknown detail half credit and lists it", () => {
    const r = similarity({ category: "lipstick", attributes: { finish: "matte" } }, { category: "lipstick", attributes: { finish: "matte", shadeFamily: "nude" } });
    expect(r.missing).toEqual(["shadeFamily", "form"]);
    expect(r.score).toBe(0.65);
    expect(r.sameType).toBe(false);
  });

  it("knows the same type for replacements", () => {
    const ha = { category: "serum" as const, attributes: { primaryActive: "hyaluronic-acid" } };
    expect(sameType(ha, { category: "serum", attributes: { primaryActive: "sodium hyaluronate" } })).toBe(true);
    expect(sameType(ha, { category: "serum", attributes: { primaryActive: "hyaluronic-acid", actives: ["panthenol"] } })).toBe(true);
    expect(sameType(ha, { category: "serum", attributes: { primaryActive: "vitamin-c" } })).toBe(false);
    expect(sameType({ category: "cleanser", attributes: { form: "gel" } }, { category: "cleanser", attributes: { form: "cream" } })).toBe(true);
  });

  it("ranks the shelf best first", () => {
    const shelf = new MemoryShelfStore([vitC, { ...vitC, id: "ret", attributes: { primaryActive: "retinol" } }, { ...vitC, id: "cream", category: "moisturizer" }]).list();
    const ranked = rankShelf({ category: "serum", attributes: { primaryActive: "vitamin-c" } }, shelf);
    expect(ranked.map((m) => m.item.id)).toEqual(["vitc", "ret"]);
  });
});

describe("identity", () => {
  it("ignores sizes, pump words, spelling and a repeated brand", () => {
    expect(identityKey("CeraVe", "CeraVe Moisturising Cream with Pump 454g")).toBe(identityKey("CeraVe", "Moisturizing Cream"));
    expect(sameProduct({ brand: "CeraVe", name: "Moisturizing Cream 16 oz" }, { brand: "CeraVe", name: "Intensive Moisturizing Cream" })).toBe(false);
  });
});

describe("shelf store", () => {
  it("validates manual adds", () => {
    const s = new MemoryShelfStore();
    expect(() => s.add({ ...vitC, category: "candle" as never })).toThrow(ShelfValidationError);
    expect(() => s.add({ ...vitC, runOutDate: "soon" })).toThrow(ShelfValidationError);
    expect(() => s.add({ ...vitC, name: " " })).toThrow(ShelfValidationError);
    const item = s.add({ ...vitC, id: undefined, attributes: { primaryActive: " vitamin-c ", bad: 3 as never } });
    expect(item.source).toBe("manual");
    expect(item.attributes).toEqual({ primaryActive: "vitamin-c" });
  });

  it("persists to a JSON file and reloads", () => {
    const file = join(mkdtempSync(join(tmpdir(), "shelf-")), "shelf.json");
    const s = new JsonShelfStore(file);
    s.add(vitC);
    s.update("vitc", { opened: false });
    expect(JSON.parse(readFileSync(file, "utf8")).items).toHaveLength(1);
    const again = new JsonShelfStore(file);
    expect(again.get("vitc")?.opened).toBe(false);
    expect(again.remove("vitc")).toBe(true);
    expect(new JsonShelfStore(file).list()).toEqual([]);
  });
});

describe("importers", () => {
  it("round-trips the shelf SKU", () => {
    expect(parseShelfSku(shelfSku("serum", "abc:1"))).toEqual({ category: "serum", productId: "abc:1" });
    expect(parseShelfSku("SKU-1")).toBeUndefined();
  });

  it("adds app orders as unopened rows and skips ones already owned", () => {
    const existing = new MemoryShelfStore([{ ...vitC, opened: false }]).list();
    const r = importAppOrders(
      [
        {
          orderId: "O1",
          capturedOn: "2026-11-01",
          lines: [
            { sku: shelfSku("serum", "p1"), name: "Vitamin C Serum", brand: "TruSkin" },
            { sku: shelfSku("moisturizer", "p2"), name: "Moisturizing Cream", brand: "CeraVe" },
            { sku: "OTHER", name: "Gift card", brand: "" },
          ],
        },
      ],
      existing,
    );
    expect(r.skipped).toBe(1);
    expect(r.added.map((i) => [i.name, i.opened, i.source])).toEqual([["Moisturizing Cream", false, "app-order"]]);
    expect(r.needsReview).toEqual([{ name: "Gift card", sku: "OTHER", reason: "unknown-category" }]);
  });

  it("keeps PayPal activity off unless enabled", async () => {
    const request = vi.fn();
    expect(await importPayPalActivity({ request }, { enabled: false })).toEqual({ status: "disabled" });
    expect(request).not.toHaveBeenCalled();
  });

  it("degrades to unavailable on a 403", async () => {
    const request = vi.fn().mockRejectedValue(new PayPalApiError(403, "NOT_AUTHORIZED", "Authorization failed", []));
    const r = await importPayPalActivity({ request }, { enabled: true });
    expect(r).toMatchObject({ status: "unavailable", reason: "not-authorized" });
  });

  it("maps PayPal item lines with our SKU and skips failed transactions", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: {
        total_pages: 1,
        transaction_details: [
          { transaction_info: { transaction_id: "T1", transaction_status: "S", transaction_initiation_date: "2026-11-05T10:00:00Z" }, cart_info: { item_details: [{ item_name: "Gentle Foaming Cleanser", item_code: shelfSku("cleanser", "x") }] } },
          { transaction_info: { transaction_id: "T2", transaction_status: "D" }, cart_info: { item_details: [{ item_name: "Declined", item_code: shelfSku("serum", "y") }] } },
          { transaction_info: { transaction_id: "T3", transaction_status: "S" } },
        ],
      },
    });
    const r = await importPayPalActivity({ request }, { enabled: true, now: new Date("2026-11-07T00:00:00Z") });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.transactions).toBe(3);
    expect(r.withItemLines).toBe(2);
    expect(r.added).toHaveLength(1);
    expect(r.added[0]).toMatchObject({ category: "cleanser", source: "paypal-activity", addedOn: "2026-11-05", opened: false });
  });
});

describe("categories added for common screenshots", () => {
  const sim2 = (category: Category, a: Attributes, b: Attributes) => similarity({ category, attributes: a }, { category, attributes: b });

  it("knows conditioner, hair oil, lip balm, kettle and toaster, with their catalogue slugs", () => {
    for (const c of ["conditioner", "hair-oil", "lip-balm", "kettle", "toaster"] as const) expect(CATEGORIES).toContain(c);
    expect(categoryFromSlug("conditioners")).toBe("conditioner");
    expect(categoryFromSlug("hair-serums")).toBe("hair-oil");
    expect(categoryFromSlug("lip-care")).toBe("lip-balm");
    expect(categoryFromSlug(undefined, ["kitchen", "small-appliances", "electric-kettles"])).toBe("kettle");
    expect(categoryFromSlug("toaster-ovens")).toBe("toaster");
    expect(CATEGORY_SPECS.conditioner.budgetGroup).toBe("haircare");
    expect(CATEGORY_SPECS.kettle.policyGroup).toBe("general");
  });

  it("keeps shampoo and conditioner, and lip balm and lip oil, as different jobs", () => {
    expect(similarity({ category: "conditioner", attributes: { purpose: "hydrating" } }, { category: "shampoo", attributes: { purpose: "hydrating" } }).score).toBe(0);
    expect(similarity({ category: "lip-balm", attributes: { tint: "tinted" } }, { category: "lip-oil", attributes: { tint: "tinted" } }).score).toBe(0);
  });

  it("scores conditioners by purpose and use", () => {
    expect(sim2("conditioner", { purpose: "hydrating", use: "rinse-out" }, { purpose: "hydrating", use: "rinse-out" }).score).toBe(1);
    expect(sim2("conditioner", { purpose: "hydrating" }, { purpose: "hydrating", use: "rinse-out" }).score).toBe(0.875);
    expect(sim2("conditioner", { purpose: "hydrating", use: "leave-in" }, { purpose: "hydrating", use: "rinse-out" }).score).toBe(0.875);
    expect(sim2("conditioner", { purpose: "hydrating", use: "leave-in" }, { purpose: "hydrating", use: "mask" }).score).toBe(0.75);
    expect(sim2("conditioner", { purpose: "volume" }, { purpose: "hydrating" }).score).toBe(0.625);
  });

  it("treats a hair serum as a neighbour of a hair oil", () => {
    expect(sim2("hair-oil", { purpose: "smoothing", form: "serum" }, { purpose: "smoothing", form: "oil" }).score).toBe(0.9);
    expect(sim2("hair-oil", { purpose: "shine", form: "oil" }, { purpose: "smoothing", form: "oil" }).score).toBe(0.7);
  });

  it("scores lip balms by tint and shade", () => {
    expect(sim2("lip-balm", { tint: "tinted", shadeFamily: "pink" }, { tint: "tinted", shadeFamily: "pink" }).score).toBe(1);
    expect(sim2("lip-balm", { tint: "clear" }, { tint: "tinted", shadeFamily: "pink" }).score).toBe(0.75);
  });

  it("separates an electric kettle from a stovetop one, and a pop-up toaster from a toaster oven", () => {
    expect(sim2("kettle", { type: "electric" }, { type: "electric-kettle" }).sameType).toBe(true);
    expect(sim2("kettle", { type: "electric" }, { type: "electric" }).score).toBe(0.75);
    expect(sim2("kettle", { type: "electric" }, { type: "stovetop" }).score).toBe(0.25);
    expect(sim2("toaster", { type: "pop-up" }, { type: "oven" }).sameType).toBe(false);
  });
});

describe("sunscreen: face and body are different jobs", () => {
  const spf = (area: string, more: Attributes = {}) => ({ category: "sunscreen" as const, attributes: { filter: "mineral", spfBand: "50+", finish: "sheer", area, ...more } });

  it("a body sunscreen doesn't do a face sunscreen's job, or the other way round", () => {
    const r = similarity(spf("body"), spf("face"));
    expect(r.sameType).toBe(false);
    expect(r.score).toBe(0.5);
    expect(similarity(spf("face"), spf("body")).score).toBe(0.5);
  });

  it("a face-and-body sunscreen you own covers either", () => {
    expect(similarity(spf("body"), spf("face-body"))).toMatchObject({ score: 1, sameType: true });
    expect(similarity(spf("face"), spf("face-body"))).toMatchObject({ score: 1, sameType: true });
  });

  it("a face-and-body sunscreen is only half covered by a face one", () => {
    const r = similarity(spf("face-body"), spf("face"));
    expect(r.sameType).toBe(false);
    expect(r.score).toBe(0.75);
  });

  it("an unknown area is half credit and never the same type", () => {
    const r = similarity({ category: "sunscreen", attributes: { filter: "mineral", spfBand: "50+", finish: "sheer" } }, spf("face"));
    expect(r.missing).toContain("area");
    expect(r.score).toBe(0.75);
    expect(r.sameType).toBe(false);
  });
});
