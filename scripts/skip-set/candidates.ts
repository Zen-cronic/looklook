/**
 * Lists catalogue candidates for the skip test set, one line per product
 * (id, brand, title, headline price, domains). Used once to pick real products;
 * responses are cached under data/cache/ (gitignored) and never committed.
 *
 *   npx tsx scripts/skip-set/candidates.ts "vitamin c serum" "mineral sunscreen"
 */
import { loadEnv } from "../lib/env";
import { Channel3Client, FileCache, brandOf, searchProducts } from "../../lib/channel3";

loadEnv();

async function main() {
  const queries = process.argv.slice(2);
  const client = new Channel3Client({ cache: new FileCache(), maxCalls: 20 });
  for (const q of queries) {
    const products = await searchProducts(client, q, 12);
    console.log(`\n## ${q}`);
    for (const p of products) {
      const offer = p.offers?.[0];
      const domains = [...new Set((p.offers ?? []).map((o) => o.domain))].slice(0, 4).join(",");
      console.log(`${p.id}\t${brandOf(p)}\t${p.title.slice(0, 70)}\t${offer?.price.price ?? "?"}\t${p.category?.slug ?? "?"}\t${domains}`);
    }
  }
  console.log(`\ncalls ${client.calls}, cache hits ${client.cacheHits}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
