import { describe, expect, it, vi } from "vitest";
import { CacheMissError, CallBudgetExceededError, Channel3Client, cleanHistory, dedupeProducts, normalizeTitle, priceLevels, searchProducts, type Product, type RawPricePoint } from "./index";

function series(prices: number[], start = "2026-08-09"): RawPricePoint[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return prices.map((price, i) => ({ timestamp: new Date(t0 + i * 86_400_000).toISOString().replace(".000", ""), price, currency: "USD" }));
}

const flat = (p: number, n: number) => Array.from({ length: n }, () => p);

describe("cleanHistory", () => {
  it("keeps a real sale step untouched", () => {
    const raw = [...flat(23.99, 40), ...flat(17.99, 16), ...flat(23.99, 34)];
    const c = cleanHistory(series(raw));
    expect(c.daily).toEqual(raw);
    expect(c.mixed).toBe(false);
    expect(c.usable).toBe(true);
    expect(c.dropped).toHaveLength(0);
  });

  it("drops junk points far from the median and fills from the previous day", () => {
    const raw = [...flat(880, 10), 25, ...flat(880, 10), 2000, ...flat(880, 5)];
    const c = cleanHistory(series(raw));
    expect(c.daily.every((p) => p === 880)).toBe(true);
    expect(c.dropped.map((d) => d.reason)).toEqual(["outlier", "outlier"]);
  });

  it("drops one-day blips", () => {
    const raw = [...flat(20, 10), 16.59, ...flat(20, 10)];
    const c = cleanHistory(series(raw));
    expect(c.daily.every((p) => p === 20)).toBe(true);
    expect(c.dropped).toEqual([{ date: "2026-08-19", price: 16.59, reason: "one-day-blip" }]);
  });

  it("marks two sizes alternating in one series as mixed and unusable", () => {
    const raw: number[] = [];
    for (let i = 0; i < 90; i++) raw.push(Math.floor(i / 4) % 2 ? 50 : 38);
    const c = cleanHistory(series(raw));
    expect(c.mixed).toBe(true);
    expect(c.usable).toBe(false);
  });

  it("keeps the dominant level of a mixed series when it holds most days", () => {
    const raw = flat(38, 90);
    for (const i of [5, 6, 20, 21, 35, 36, 50, 51, 65, 66]) raw[i] = 50;
    const c = cleanHistory(series(raw));
    expect(c.mixed).toBe(true);
    expect(c.usable).toBe(true);
    expect(c.daily.every((p) => p === 38)).toBe(true);
    expect(c.dropped.filter((d) => d.reason === "other-series")).toHaveLength(10);
  });

  it("fills missing days and ignores invalid points", () => {
    const raw: RawPricePoint[] = [
      { timestamp: "2026-11-01T00:00:00Z", price: 10 },
      { timestamp: "2026-11-02T00:00:00Z", price: -1 },
      { timestamp: "2026-11-04T00:00:00Z", price: 9 },
    ];
    const c = cleanHistory(raw);
    expect(c.startDate).toBe("2026-11-01");
    expect(c.daily).toEqual([10, 10, 10, 9]);
    expect(c.dropped[0].reason).toBe("invalid");
  });

  it("returns an empty unusable series for no history", () => {
    expect(cleanHistory([]).usable).toBe(false);
  });

  it("groups prices into levels", () => {
    expect(priceLevels([10, 10.5, 13, 13.2, 20])).toEqual([[10, 10.5], [13, 13.2], [20]]);
  });
});

describe("dedupe", () => {
  it("normalises titles, sizes and the brand", () => {
    expect(normalizeTitle("CeraVe Moisturizing Cream, 16 fl. oz.", "CeraVe")).toBe(normalizeTitle("Moisturizing Cream 16oz", "CeraVe"));
    expect(normalizeTitle("Moisturizing Cream 16 oz")).not.toBe(normalizeTitle("Moisturizing Cream 8 oz"));
    expect(normalizeTitle("Crème Hydratante™ 50 mL")).toBe("50ml creme hydratante");
  });

  it("merges listings of the same item and keeps the cheapest offer per seller", () => {
    const brand = [{ id: "b", name: "CeraVe" }];
    const products: Product[] = [
      { id: "a", title: "CeraVe Moisturizing Cream 16 oz", brands: brand, offers: [{ domain: "ulta.com", price: { price: 19.99, currency: "USD" } }] },
      { id: "b", title: "Moisturizing Cream, 16 Fl Oz", brands: brand, offers: [{ domain: "ulta.com", price: { price: 18.99, currency: "USD" } }, { domain: "target.com", price: { price: 17.99, currency: "USD" } }] },
      { id: "c", title: "Moisturizing Lotion 16 oz", brands: brand, offers: [] },
    ];
    const groups = dedupeProducts(products);
    expect(groups).toHaveLength(2);
    const cream = groups.find((g) => g.ids.includes("a"))!;
    expect(cream.ids).toEqual(["a", "b"]);
    expect(cream.product.id).toBe("b");
    expect(cream.offers.map((o) => [o.domain, o.price.price])).toEqual([["target.com", 17.99], ["ulta.com", 18.99]]);
  });
});

describe("client", () => {
  it("serves cached responses without a call and enforces the call budget", async () => {
    const store = new Map<string, unknown>();
    const cache = { get: (k: string) => store.get(k), set: (k: string, v: unknown) => void store.set(k, v) };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ products: [{ id: "x", title: "X" }] }), { status: 200 }));
    const client = new Channel3Client({ apiKey: "k", fetch: fetchFn, cache, maxCalls: 1 });
    await searchProducts(client, "cream");
    await searchProducts(client, "cream");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(client.cacheHits).toBe(1);
    await expect(searchProducts(client, "serum")).rejects.toBeInstanceOf(CallBudgetExceededError);
    const offline = new Channel3Client({ apiKey: "k", fetch: fetchFn, cache, network: false });
    await expect(searchProducts(offline, "mascara")).rejects.toBeInstanceOf(CacheMissError);
  });
});
