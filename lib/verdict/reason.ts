import type Anthropic from "@anthropic-ai/sdk";
import type { Decision, ProductFacts } from "./types";

const money = (n: number) => `$${n.toFixed(2)}`;

/** "Dec 20" for a YYYY-MM-DD date. */
const day = (date: string | null | undefined) =>
  date ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "";

const inDays = (n: number) => (n <= 0 ? "runs out today" : `runs out in ${n} ${n === 1 ? "day" : "days"}`);

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
      return `${p.retailerName} takes it back opened${p.openedNeeds ? ` ${p.openedNeeds}` : ""}`;
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
      return `You have ${owned} until about ${day(e.shelf?.runOutDate)}. We'll look again on ${day(e.waitUntil)}.`;
    case "owns-similar":
      return `You already own ${owned}, which does the same job${d.flags.includes("non-returnable-opened") ? `, and ${returnPhrase(d)}` : ""}.`;
    case "overlap-non-returnable":
      return `It overlaps with your ${owned}, and ${returnPhrase(d)}.`;
    case "price-unknown":
      return "No price was shown. Add the price and we'll check it.";
    case "over-budget":
      return `${money(e.budget!.price)} is more than the ${money(e.budget!.remaining)} left in your ${e.budget!.group} budget this month.`;
    case "no-price-history":
      return `There isn't enough price history for ${product.brand} ${product.name} to judge this price; we'll watch it${e.buyBy ? ` until ${day(e.buyBy)}` : ""}.`;
    case "above-usual-price":
      return `${money(e.price!.shown)} is above its usual low of ${money(e.price!.low!)}; we'll wait for ${money(e.price!.target!)} or less${e.buyBy ? ` until ${day(e.buyBy)}` : ""}.`;
    case "replacing-run-out":
      return `Your ${e.replaces!.brand} ${e.replaces!.name} ${inDays(e.replaces!.daysLeft)}, and this is a fair price.`;
    case "clear-to-buy":
      return e.shelf && e.shelf.relation === "overlap"
        ? `It only partly overlaps with your ${owned}, ${returnPhrase(d)}, it fits your budget, and the price is fair.`
        : "Nothing like it on your shelf, it fits your budget, and the price is fair.";
  }
}

const REASON_SYSTEM = [
  "You write the one-line reason shown under a shopping verdict.",
  "The verdict is already decided. Never change it, argue with it, or add advice.",
  "Use only the facts in the JSON. No numbers, dates or stores that are not in it.",
  "One sentence, at most 28 words, plain words, no emoji, addressed to the shopper as you.",
  "Return policies: returnableOpened yes means the store takes it back opened within windowDays (and, when openedNeeds is given, only that way, for example with a receipt: say so); no means the store may refuse it once opened; conditional means only on conditions; unknown means we couldn't find the policy. Never state a policy more firmly than that.",
  "No middle dots, no ids, no rule names.",
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
