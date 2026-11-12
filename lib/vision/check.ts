import type Anthropic from "@anthropic-ai/sdk";
import { withReturnConditions } from "../policies/conditions";
import type { PriceBand } from "../channel3/band";
import type { Product } from "../channel3/types";
import type { BudgetGroup } from "../shelf/categories";
import type { ShelfItem } from "../shelf/types";
import { decide } from "../verdict/engine";
import { writeReason } from "../verdict/reason";
import type { Decision, ProductFacts } from "../verdict/types";
import { matchWithImage, pickMatch, searchQuery, toProductFacts, type MatchResult } from "./match";
import { readScreenshot, type ScreenshotImage } from "./read";
import type { ScreenshotFields } from "./schema";

export interface CheckDeps {
  anthropic: Pick<Anthropic, "messages">;
  /** Catalogue text search. */
  search: (query: string) => Promise<Product[]>;
  /** Cleaned price band for a catalogue product, or null when there's no usable history. */
  priceBand: (productId: string) => Promise<PriceBand | null>;
  /** Catalogue image search; left out, the match is from the name alone. */
  searchImage?: (image: ScreenshotImage) => Promise<Product[]>;
}

export interface CheckInput {
  image: ScreenshotImage;
  shelf: ShelfItem[];
  budgets?: Partial<Record<BudgetGroup, number>>;
  /** Store the user is buying from; defaults to what the screenshot shows. */
  store?: string;
  today: string;
  /** Write the reason with the model (true) or the template (false). */
  modelReason?: boolean;
}

export interface CheckResult {
  fields: ScreenshotFields;
  match: MatchResult;
  facts: ProductFacts;
  decision: Decision;
  reason: { text: string; source: "model" | "template" };
}

/** Start an image search that never throws: no search gives undefined, an error gives []. */
export function searchImageSafely(image: ScreenshotImage, searchImage: CheckDeps["searchImage"]): Promise<Product[] | undefined> {
  if (!searchImage) return Promise.resolve(undefined);
  try {
    return searchImage(image).catch(() => []);
  } catch {
    return Promise.resolve([]);
  }
}

/**
 * Screenshot to verdict: Claude reads the image, the catalogue match is scored
 * in code, the engine decides from structured fields, and only then is the
 * reason worded. A low-confidence match comes back as ask with alternatives.
 */
export async function checkScreenshot(input: CheckInput, deps: CheckDeps): Promise<CheckResult> {
  // The image search runs alongside the read, so it adds no wait; any error counts as no hits.
  const byImage = searchImageSafely(input.image, deps.searchImage);
  const { fields } = await readScreenshot(input.image, { client: deps.anthropic });
  const query = searchQuery(fields);
  const products = fields.isProduct && query ? await deps.search(query) : [];
  const match = matchWithImage(fields, pickMatch(fields, products), await byImage, products);
  const facts = toProductFacts(fields, match);
  const band = match.best && !match.needsConfirmation ? await deps.priceBand(match.best.product.id) : null;
  const decision = withReturnConditions(decide({ product: facts, store: input.store ?? fields.store ?? undefined, shelf: input.shelf, budgets: input.budgets, priceBand: band, today: input.today }));
  const reason = await writeReason(decision, facts, input.modelReason ? { client: deps.anthropic } : {});
  return { fields, match, facts, decision, reason };
}
