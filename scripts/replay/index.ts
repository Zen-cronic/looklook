/**
 * Replay of the app's wait rule against the price-alert baseline.
 *
 *   npm run replay -- --select   build and freeze the product list (searches + history lookups)
 *   npm run replay -- --fetch    run, fetching any history not yet cached
 *   npm run replay               run from the local cache only
 *
 * Raw catalogue responses stay in data/cache/ (gitignored). Only the product
 * list and derived results are written to data/replay/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "../lib/env";
import { Channel3Client, FileCache, brandOf, cleanHistory, dedupeProducts, getPriceHistory, searchProducts, type CleanedSeries } from "../../lib/channel3";
import { DEFAULT_CONFIG, runReplay, type ReplayProduct, type ReplayReport, type Totals } from "../../lib/replay/replay";
import { CATALOG } from "./catalog";

loadEnv();

const argv = process.argv.slice(2);
const args = new Set(argv);
const maxCallsArg = argv.find((a) => a.startsWith("--max-calls="));
const MAX_CALLS = maxCallsArg ? Number(maxCallsArg.split("=")[1]) : 140;
const LIST_FILE = "data/replay/products.json";
const RESULT_FILE = "data/replay/result.json";
const NEED_DAYS = DEFAULT_CONFIG.trainDays + DEFAULT_CONFIG.testDays;

interface ListedProduct {
  id: string;
  title: string;
  brand: string;
  category: string;
  query: string;
}

interface ScreenedProduct extends ListedProduct {
  reason: "no-history" | "short-history" | "mixed-series";
  days: number;
}

interface ProductList {
  createdAt: string;
  rule: string;
  products: ListedProduct[];
  screenedOut: ScreenedProduct[];
}

function usableReason(c: CleanedSeries): ScreenedProduct["reason"] | undefined {
  if (c.daily.length === 0) return "no-history";
  if (c.daily.length < NEED_DAYS) return "short-history";
  if (!c.usable) return "mixed-series";
  return undefined;
}

async function select(client: Channel3Client): Promise<ProductList> {
  const products: ListedProduct[] = [];
  const screenedOut: ScreenedProduct[] = [];
  const seen = new Set<string>();
  for (const seed of CATALOG) {
    let historyCalls = 0;
    let found = 0;
    const candidates: ListedProduct[] = [];
    for (const query of seed.queries) {
      const results = await searchProducts(client, query, 30);
      const usdOnly = results.filter((p) => (p.offers ?? []).some((o) => o.price.currency === "USD" && o.price.price > 0));
      for (const g of dedupeProducts(usdOnly)) {
        if (seen.has(g.key)) continue;
        seen.add(g.key);
        candidates.push({ id: g.product.id, title: g.product.title, brand: brandOf(g.product), category: seed.category, query });
      }
    }
    // Interleave queries so one query can't fill the category.
    const byQuery = seed.queries.map((q) => candidates.filter((c) => c.query === q));
    const ordered: ListedProduct[] = [];
    for (let i = 0; byQuery.some((l) => i < l.length); i++) {
      for (const l of byQuery) if (i < l.length) ordered.push(l[i]);
    }
    for (const c of ordered) {
      if (found >= seed.target || historyCalls >= seed.maxHistoryCalls) break;
      historyCalls += 1;
      const h = await getPriceHistory(client, c.id, 90);
      const cleaned = cleanHistory(h.history ?? []);
      const reason = usableReason(cleaned);
      if (reason) {
        screenedOut.push({ ...c, reason, days: cleaned.daily.length });
      } else {
        products.push(c);
        found += 1;
      }
    }
    console.log(`${seed.category}: ${candidates.length} candidates, ${historyCalls} histories checked, ${found} usable`);
  }
  return {
    createdAt: new Date().toISOString(),
    rule: `Search results in order, merged by normalised title, USD offers only; kept when the cleaned history covers ${NEED_DAYS} days and is not a mixed series.`,
    products,
    screenedOut,
  };
}

async function load(client: Channel3Client, list: ProductList): Promise<ReplayProduct[]> {
  const out: ReplayProduct[] = [];
  for (const p of list.products) {
    const h = await getPriceHistory(client, p.id, 90);
    const cleaned = cleanHistory(h.history ?? []);
    if (usableReason(cleaned)) throw new Error(`${p.id} no longer has a usable history`);
    out.push({ id: p.id, title: p.title, category: p.category, daily: cleaned.daily });
  }
  return out;
}

const usd = (n: number) => "$" + n.toFixed(2);
const pct = (n: number) => (n * 100).toFixed(1) + "%";

function line(name: string, t: Totals): string {
  return [
    name.padEnd(20),
    String(t.products).padStart(3) + " products",
    "baseline " + usd(t.baselineSpend).padStart(9),
    "rule " + usd(t.ruleSpend).padStart(9),
    "saved " + usd(t.saved).padStart(8) + " (" + pct(t.savedPct) + ")",
    "won/lost/tied " + [t.won, t.lost, t.tied].join("/"),
  ].join("  ");
}

function round(report: ReplayReport): object {
  return JSON.parse(JSON.stringify(report, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v)));
}

async function main() {
  const fetchAllowed = args.has("--select") || args.has("--fetch");
  const client = new Channel3Client({ cache: new FileCache(), maxCalls: MAX_CALLS, network: fetchAllowed });
  mkdirSync("data/replay", { recursive: true });

  let list: ProductList;
  if (args.has("--select")) {
    list = await select(client);
    writeFileSync(LIST_FILE, JSON.stringify(list, null, 2) + "\n");
    console.log(`froze ${list.products.length} products in ${LIST_FILE} (${list.screenedOut.length} screened out)`);
  } else {
    if (!existsSync(LIST_FILE)) throw new Error(`${LIST_FILE} is missing; run with --select first`);
    list = JSON.parse(readFileSync(LIST_FILE, "utf8"));
  }

  const products = await load(client, list);
  const report = runReplay(products, DEFAULT_CONFIG);
  writeFileSync(RESULT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), productList: LIST_FILE, ...round(report) }, null, 2) + "\n");

  const t = report.totals;
  const lastSight = NEED_DAYS - DEFAULT_CONFIG.horizon;
  console.log("");
  console.log(`HEADLINE: waiting by the rule saved ${usd(t.saved)} (${pct(t.savedPct)}) over ${t.products} purchases versus buying on the first price alert`);
  console.log(
    `rule fixed on days 1-${DEFAULT_CONFIG.trainDays}: tolerance ${report.params.tolerance}, min depth ${report.params.minDepth}; ` +
      `tested on sight days ${DEFAULT_CONFIG.trainDays + 1}-${lastSight}, needed ${DEFAULT_CONFIG.horizon} days later`,
  );
  console.log(`versus buying at first sight: ${usd(t.savedVsAtSight)}; random-wait control vs baseline: ${usd(t.controlSaved)}, vs first sight: ${usd(t.controlVsAtSight)}; hindsight best possible: ${usd(t.hindsightSaved)}`);
  console.log(`products whose price moved in the test window: ${report.products.filter((p) => p.movedInTest).length} of ${t.products}`);
  console.log("");
  console.log(line("all", t));
  for (const [c, ct] of Object.entries(report.byCategory)) console.log(line(c, ct));
  console.log(`\nChannel3 network calls this run: ${client.calls} (cache hits ${client.cacheHits})`);
  console.log(`result: ${RESULT_FILE}`);
}

main().catch((e) => {
  console.error(`FAIL  ${(e as Error).message}`);
  process.exit(1);
});
