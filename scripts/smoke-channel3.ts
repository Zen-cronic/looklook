/**
 * Live check of the Channel3 module: search, product detail, price history and
 * a subscription create / list / cancel. About six calls. Runs only with
 * CHANNEL3_SMOKE=1. Prints ids, counts and statuses, never the key.
 */
import { loadEnv } from "./lib/env";
import { Channel3Client, cancelSubscription, cleanHistory, createSubscription, dedupeProducts, getPriceHistory, getProduct, listSubscriptions, searchProducts } from "../lib/channel3";

loadEnv();

if (process.env.CHANNEL3_SMOKE !== "1") {
  console.log("Skipped: set CHANNEL3_SMOKE=1 to run the Channel3 smoke test.");
  process.exit(0);
}

async function main() {
  const client = new Channel3Client({ maxCalls: 8 });
  const products = await searchProducts(client, "La Roche-Posay Anthelios Melt-in Milk sunscreen SPF 60", 10);
  const groups = dedupeProducts(products);
  console.log(`search: ${products.length} listings, ${groups.length} after dedupe`);
  const pick = groups.find((g) => g.product.variants == null) ?? groups[0];
  const detail = await getProduct(client, pick.product.id);
  console.log(`detail ${detail.id}: ${detail.offers?.length ?? 0} offers`);
  const history = await getPriceHistory(client, detail.id, 90);
  const cleaned = cleanHistory(history.history);
  console.log(`history: ${history.history.length} points, ${cleaned.daily.length} days after cleaning, ${cleaned.dropped.length} dropped, mixed=${cleaned.mixed}`);
  const sub = await createSubscription(client, { productId: detail.id });
  console.log(`subscription ${sub.subscription_id}: ${sub.status}`);
  const listed = await listSubscriptions(client);
  console.log(`listed: ${listed.some((s) => s.subscription_id === sub.subscription_id) ? "found" : "missing"} (${listed.length} total)`);
  const cancelled = await cancelSubscription(client, sub.subscription_id);
  console.log(`cancelled: ${cancelled.status}`);
  console.log(`network calls: ${client.calls}`);
  process.exit(sub.status === "active" && cancelled.status === "cancelled" ? 0 : 1);
}

main().catch((e) => {
  console.error(`FAIL  ${(e as Error).message}`);
  process.exit(1);
});
