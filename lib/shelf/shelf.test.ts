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
  OVERLAP,
  ShelfValidationError,
  categoryFromSlug,
  identityKey,
  importAppOrders,
  importPayPalActivity,
  parseShelfSku,
  rankShelf,
  sameProduct,
  shelfSku,
  similarity,
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
  it("weights each category's attributes to 1", () => {
    for (const c of CATEGORIES) {
      const total = CATEGORY_SPECS[c].attributes.reduce((s, a) => s + a.weight, 0);
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
  it("scores different categories 0", () => {
    expect(similarity({ category: "serum", attributes: {} }, { category: "moisturizer", attributes: {} }).score).toBe(0);
  });

  it("scores the same main active as a near-duplicate", () => {
    const r = similarity({ category: "serum", attributes: { primaryActive: "Vitamin C", actives: ["vitamin c", "ferulic-acid", "vitamin-e"] } }, { category: "serum", attributes: vitC.attributes });
    expect(r.score).toBeGreaterThanOrEqual(NEAR_DUPLICATE);
    expect(r.matched).toEqual(["primaryActive"]);
  });

  it("keeps a different main active below the overlap line", () => {
    const r = similarity({ category: "serum", attributes: { primaryActive: "retinol", actives: ["retinol"] } }, { category: "serum", attributes: vitC.attributes });
    expect(r.score).toBeLessThan(OVERLAP);
  });

  it("is symmetric and deterministic", () => {
    const a = { category: "sunscreen" as const, attributes: { filter: "chemical", area: "face", spfBand: "50+", finish: "matte" } };
    const b = { category: "sunscreen" as const, attributes: { filter: "chemical", area: "face", spfBand: "30-49", finish: "sheer" } };
    expect(similarity(a, b)).toEqual(similarity(b, a));
    expect(similarity(a, b).score).toBe(0.79);
  });

  it("treats a missing attribute as no match", () => {
    const r = similarity({ category: "lipstick", attributes: { finish: "matte" } }, { category: "lipstick", attributes: { finish: "matte", shadeFamily: "nude" } });
    expect(r.missing).toEqual(["shadeFamily"]);
    expect(r.score).toBe(0.58);
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
