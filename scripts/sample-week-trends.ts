/**
 * Weekly price medians for the sample week's price waits, from their cached
 * 90-day catalogue histories. Only the derived weekly medians and the band
 * dates are written (data/sample-week/trends.json); raw histories stay in
 * data/cache/ (gitignored).
 *
 *   npm run sample-week:trends               cache only
 *   npm run sample-week:trends -- --fetch    fetch histories not cached yet
 */
import { writeFileSync } from "node:fs";
import { loadEnv } from "./lib/env";
import { Channel3Client, FileCache, getPriceHistory, priceBand } from "../lib/channel3";

loadEnv();

const OUT = "data/sample-week/trends.json";
/** Catalogue ids of the sample week's price waits (lib/app/sample-week.ts). */
const SAMPLE_WEEK_PRICE_IDS = ["TNq1quB", "LxnNLye"];

async function main() {
  const client = new Channel3Client({ cache: new FileCache(), network: process.argv.includes("--fetch"), maxCalls: 5 });
  const trends: Record<string, { weekly: number[]; asOf: string; days: number }> = {};
  for (const id of SAMPLE_WEEK_PRICE_IDS) {
    const h = await getPriceHistory(client, id, 90);
    const band = priceBand(h.history ?? []);
    if (!band?.weekly) throw new Error(`no usable history for ${id}`);
    trends[id] = { weekly: band.weekly, asOf: band.asOf, days: band.days };
  }
  writeFileSync(OUT, JSON.stringify({ source: "90-day catalogue price history, cleaned; weekly medians only", trends }, null, 2) + "\n");
  console.log(`${Object.keys(trends).length} trends; calls ${client.calls}, cache hits ${client.cacheHits}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
