import { describe, expect, it } from "vitest";
import { priceBand } from "./band";
import type { RawPricePoint } from "./types";

function series(prices: number[], start = "2026-08-09"): RawPricePoint[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return prices.map((price, i) => ({ timestamp: new Date(t0 + i * 86_400_000).toISOString(), price }));
}

describe("priceBand", () => {
  it("summarises a cleaned series", () => {
    const b = priceBand(series([...Array(40).fill(20), ...Array(10).fill(15), ...Array(40).fill(20)]))!;
    expect(b).toMatchObject({ typical: 20, low: 15, high: 20, latest: 20, days: 90, usable: true, asOf: "2026-11-06" });
  });

  it("ignores junk points and marks short series unusable", () => {
    const b = priceBand(series([...Array(10).fill(30), 2, ...Array(10).fill(30)]))!;
    expect(b.low).toBe(30);
    expect(b.usable).toBe(false);
  });

  it("returns undefined for an empty history", () => {
    expect(priceBand([])).toBeUndefined();
  });
});
