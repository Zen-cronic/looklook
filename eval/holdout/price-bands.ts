/**
 * Derives a price band (typical, low, high, latest) for every product in the
 * held-out set from its 90-day catalogue history, and writes only those derived
 * numbers to eval/holdout/price-bands.json. Raw histories stay in data/cache/
 * (gitignored).
 *
 *   npx tsx eval/holdout/price-bands.ts            cache only
 *   npx tsx eval/holdout/price-bands.ts --fetch    fetch histories not cached yet
 *   npx tsx eval/holdout/price-bands.ts --fetch --print id1 id2   print bands for candidate ids, write nothing
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "../../scripts/lib/env";
import { CacheMissError, Channel3Client, FileCache, getPriceHistory, priceBand, type PriceBand } from "../../lib/channel3";

loadEnv();

const CASES = "eval/holdout/cases.json";
const OUT = "eval/holdout/price-bands.json";

async function main() {
  const args = process.argv.slice(2);
  const fetchMissing = args.includes("--fetch");
  const printOnly = args.includes("--print");
  const client = new Channel3Client({ cache: new FileCache(), network: fetchMissing, maxCalls: 60 });
  let ids: string[];
  if (printOnly) {
    ids = args.filter((a) => !a.startsWith("--"));
  } else {
    if (!existsSync(CASES)) throw new Error(`${CASES} not found`);
    const { cases } = JSON.parse(readFileSync(CASES, "utf8")) as { cases: Array<{ catalogId?: string }> };
    ids = [...new Set(cases.map((c) => c.catalogId).filter((x): x is string => Boolean(x)))];
  }
  const bands: Record<string, PriceBand | null> = {};
  for (const id of ids) {
    try {
      const h = await getPriceHistory(client, id, 90);
      const b = priceBand(h.history ?? []) ?? null;
      if (b) delete b.weekly;
      bands[id] = b;
    } catch (e) {
      if (e instanceof CacheMissError) {
        console.error(`missing history for ${id} (rerun with --fetch)`);
        bands[id] = null;
        continue;
      }
      throw e;
    }
  }
  if (printOnly) {
    for (const [id, b] of Object.entries(bands)) {
      console.log(id, b ? `typical ${b.typical} low ${b.low} high ${b.high} latest ${b.latest} days ${b.days} usable ${b.usable}` : "none");
    }
  } else {
    writeFileSync(OUT, JSON.stringify({ source: "90-day catalogue price history, cleaned; derived statistics only", bands }, null, 2) + "\n");
  }
  const usable = Object.values(bands).filter((b) => b?.usable).length;
  console.log(`${ids.length} products, ${usable} usable bands; calls ${client.calls}, cache hits ${client.cacheHits}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
