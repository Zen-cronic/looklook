import type Anthropic from "@anthropic-ai/sdk";
import type { Decision, ProductFacts } from "./types";

const money = (n: number) => `$${n.toFixed(2)}`;

function returnPhrase(d: Decision): string {
  const p = d.evidence.policy;
  if (!p) return "";
  switch (p.returnableOpened) {
    case "no":
      return `${p.retailerName} may refuse it once opened`;
    case "conditional":
      return `${p.retailerName} takes it back opened only on conditions`;
    case "unknown":
      return p.fallback ? "this store's return policy for opened items isn't known" : `${p.retailerName} doesn't say whether opened items come back`;
    default:
      return `${p.retailerName} takes it back opened`;
  }
}

/** A plain one-line reason built only from the decision's evidence. Always available. */
export function templateReason(d: Decision, product: ProductFacts): string {
  const e = d.evidence;
  const owned = e.shelf ? `${e.shelf.brand} ${e.shelf.name}`.trim() : "something similar";
  switch (d.rule) {
    case "identity-unconfirmed":
      return "We can't tell exactly which product this is. Confirm it and we'll check again.";
    case "owns-unopened":
      return `You already have an unopened ${owned}.`;
    case "run-out-unknown":
      return `You already have ${owned} open. Tell us roughly when it runs out and we'll time the rebuy.`;
    case "not-needed-yet":
      return `You have ${owned} until about ${e.shelf?.runOutDate}. We'll look again on ${e.waitUntil}.`;
    case "owns-similar":
      return `You already own ${owned}, which does the same job${d.flags.includes("non-returnable-opened") ? `, and ${returnPhrase(d)}` : ""}.`;
    case "overlap-non-returnable":
      return `It overlaps with your ${owned}, and ${returnPhrase(d)}.`;
    case "price-unknown":
      return "No price was shown. Add the price and we'll check it.";
    case "over-budget":
      return `${money(e.budget!.price)} is more than the ${money(e.budget!.remaining)} left in your ${e.budget!.group} budget.`;
    case "no-price-history":
      return `There's no reliable price history for ${product.brand} ${product.name} yet; we'll watch the price${e.buyBy ? ` until ${e.buyBy}` : ""}.`;
    case "above-usual-price":
      return `${money(e.price!.shown)} is above its usual low of ${money(e.price!.low!)}; we'll wait for ${money(e.price!.target!)} or less${e.buyBy ? ` until ${e.buyBy}` : ""}.`;
    case "replacing-run-out":
      return `Your ${e.replaces!.brand} ${e.replaces!.name} runs out in ${e.replaces!.daysLeft} days, and this is a fair price.`;
    case "clear-to-buy":
      return "Nothing like it on your shelf, it fits your budget, and the price is fair.";
  }
}

const REASON_SYSTEM = [
  "You write the one-line reason shown under a shopping verdict.",
  "The verdict is already decided. Never change it, argue with it, or add advice.",
  "Use only the facts in the JSON. No numbers, dates or stores that are not in it.",
  "One sentence, at most 28 words, plain words, no emoji, addressed to the shopper as you.",
].join(" ");

export interface ReasonOptions {
  client?: Pick<Anthropic, "messages">;
  model?: string;
}

/**
 * The reason line. With a client, Claude rewrites the facts into one friendly
 * sentence; any failure or an over-long answer falls back to the template.
 * The model only words the reason: the verdict is decided before it is called.
 */
export async function writeReason(d: Decision, product: ProductFacts, options: ReasonOptions = {}): Promise<{ text: string; source: "model" | "template" }> {
  const fallback = templateReason(d, product);
  if (!options.client) return { text: fallback, source: "template" };
  try {
    const facts = { verdict: d.verdict, rule: d.rule, product: { brand: product.brand, name: product.name }, evidence: d.evidence, flags: d.flags, draft: fallback };
    const msg = await options.client.messages.create({
      model: options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 200,
      system: REASON_SYSTEM,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    if (!text || text.length > 240 || msg.stop_reason !== "end_turn") return { text: fallback, source: "template" };
    return { text, source: "model" };
  } catch {
    return { text: fallback, source: "template" };
  }
}
