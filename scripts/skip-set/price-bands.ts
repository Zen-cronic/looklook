/**
 * Derives a price band (typical, low, high, latest) for every product in the
 * skip test set from its 90-day catalogue history, and writes only those
 * derived numbers to eval/skip-set/price-bands.json. Raw histories stay in
 * data/cache/ (gitignored).
 *
 *   npm run eval:skip:bands             cache only
 *   npm run eval:skip:bands -- --fetch  fetch histories not cached yet
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "../lib/env";
import { CacheMissError, Channel3Client, FileCache, getPriceHistory, priceBand, type PriceBand } from "../../lib/channel3";

loadEnv();

const CASES = "eval/skip-set/cases.json";
const OUT = "eval/skip-set/price-bands.json";

async function main() {
  const fetchMissing = process.argv.includes("--fetch");
  const { cases } = JSON.parse(readFileSync(CASES, "utf8")) as { cases: Array<{ id: string; catalogId?: string }> };
  const client = new Channel3Client({ cache: new FileCache(), network: fetchMissing, maxCalls: 60 });
  const bands: Record<string, PriceBand | null> = {};
  const ids = [...new Set(cases.map((c) => c.catalogId).filter((x): x is string => Boolean(x)))];
  for (const id of ids) {
    try {
      const h = await getPriceHistory(client, id, 90);
      bands[id] = priceBand(h.history ?? []) ?? null;
    } catch (e) {
      if (e instanceof CacheMissError) {
        console.error(`missing history for ${id} (rerun with --fetch)`);
        bands[id] = null;
        continue;
      }
      throw e;
    }
  }
  writeFileSync(OUT, JSON.stringify({ source: "90-day catalogue price history, cleaned; derived statistics only", bands }, null, 2) + "\n");
  const usable = Object.values(bands).filter((b) => b?.usable).length;
  console.log(`${ids.length} products, ${usable} usable bands; calls ${client.calls}, cache hits ${client.cacheHits}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
