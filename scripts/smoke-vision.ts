/**
 * Live check of screenshot -> verdict on one image: Claude reads it, the
 * catalogue is searched once, the engine decides against a small sample shelf,
 * and Claude words the reason. Prints fields, match and decision; never prints keys.
 *
 *   VISION_SMOKE=1 npm run smoke:vision -- path/to/screenshot.png
 *
 * Calls: 2 to Claude (read + reason), 1 catalogue search, at most 1 history lookup.
 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "./lib/env";
import { Channel3Client, FileCache, getPriceHistory, priceBand, searchProducts } from "../lib/channel3";
import { MemoryShelfStore } from "../lib/shelf";
import { checkScreenshot, sniffMediaType } from "../lib/vision";

loadEnv();

async function main() {
  if (process.env.VISION_SMOKE !== "1") {
    console.log("Set VISION_SMOKE=1 to run (uses the Claude and catalogue APIs).");
    return;
  }
  const path = process.argv[2];
  if (!path) throw new Error("Pass an image path");
  const bytes = readFileSync(path);
  const mediaType = sniffMediaType(bytes);
  if (!mediaType) throw new Error("Not a PNG, JPEG, GIF or WebP image");

  const shelf = new MemoryShelfStore([
    { id: "vitc", brand: "TruSkin", name: "Vitamin C Serum", category: "serum", attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c", "hyaluronic-acid", "vitamin-e"] }, opened: true, runOutDate: "2027-01-15" },
    { id: "spf", brand: "Supergoop!", name: "Unseen Sunscreen SPF 40", category: "sunscreen", attributes: { filter: "chemical", area: "face", spfBand: "30-49", finish: "sheer" }, opened: true, runOutDate: "2026-12-05" },
  ]).list();

  const catalogue = new Channel3Client({ cache: new FileCache(), maxCalls: 2 });
  const started = Date.now();
  const r = await checkScreenshot(
    { image: { data: bytes.toString("base64"), mediaType }, shelf, budgets: { skincare: 75 }, today: new Date().toISOString().slice(0, 10), modelReason: true },
    {
      anthropic: new Anthropic(),
      search: (q) => searchProducts(catalogue, q, 10),
      priceBand: async (id) => priceBand((await getPriceHistory(catalogue, id, 90)).history ?? []) ?? null,
    },
  );
  console.log("fields:", JSON.stringify(r.fields));
  console.log(`match: ${r.match.best ? `${r.match.best.product.id} "${r.match.best.product.title}" confidence ${r.match.best.confidence}` : "none"}; confirm: ${r.match.needsConfirmation} ${r.match.why.join(",")}; category ${r.match.category}`);
  console.log(`decision: ${r.decision.verdict} (${r.decision.rule}); trace ${r.decision.evidence.trace.join(" > ")}; policy ${r.decision.evidence.policy?.retailerName} ${r.decision.evidence.policy?.sourceUrl ?? "-"}`);
  console.log(`reason (${r.reason.source}): ${r.reason.text}`);
  console.log(`catalogue calls ${catalogue.calls}, cache hits ${catalogue.cacheHits}; ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error(`FAIL ${(e as Error).name}: ${(e as Error).message}`);
  process.exit(1);
});
