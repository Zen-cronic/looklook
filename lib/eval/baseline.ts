import { createHash } from "node:crypto";
import { CONFIRMED_MATCH_CONFIDENCE, type ShelfFile, type SkipCase, type SkipSet } from "./skip-set";

/**
 * The plain-model baseline for the held-out skip set: the same model the app
 * uses, asked the skip question in plain words with no LookLook rules,
 * thresholds or examples. Pure helpers only; the runner that calls the model
 * is scripts/eval-baseline.ts.
 *
 * Pre-registered before any scored call:
 * - The prompt is eval/baseline/prompt.md with its three placeholders filled.
 * - The model gets what the engine's input holds about the product as read
 *   from the post (brand, name, category, key attributes, price, store, how
 *   sure the reader is) and the shelf as plain text (every item as written,
 *   with any per-case patch, whether it is opened and when it runs out), plus
 *   the scenario's date. It gets no budgets, price history or return policies:
 *   the question is only whether something owned does the same job.
 * - The answer is the first whole word SKIP or BUY (any case). An answer with
 *   neither counts as not skip and is listed as unclear.
 * - Scored against the expected verdicts in eval/holdout/cases.json the same
 *   way as the engine: right when it says skip exactly when skip was expected.
 */

export type BaselineAnswer = "skip" | "buy" | "unclear";

export function promptHash(template: string): string {
  return createHash("sha256").update(template).digest("hex");
}

const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/-/g, " ").toLowerCase();

function attributeText(attributes: Record<string, unknown> | undefined): string {
  const parts = Object.entries(attributes ?? {})
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${words(k)}: ${Array.isArray(v) ? v.map((x) => words(String(x))).join(", ") : words(String(v))}`);
  return parts.join("; ");
}

export function productText(c: SkipCase): string {
  const confidence = c.identityConfidence ?? CONFIRMED_MATCH_CONFIDENCE;
  const lines = [
    `- Brand: ${c.brand}`,
    `- Product: ${c.name}`,
    `- Category: ${words(String(c.category))}`,
  ];
  const details = attributeText(c.attributes as Record<string, unknown>);
  if (details) lines.push(`- Details: ${details}`);
  lines.push(`- Price: ${c.priceShown === null ? "not shown" : `$${c.priceShown.toFixed(2)}`}`);
  lines.push(`- Store: ${c.store}`);
  lines.push(`- How sure the reader of the post is about which product this is: ${Math.round(confidence * 100)}%`);
  return lines.join("\n");
}

export function shelfText(c: SkipCase, shelf: ShelfFile): string {
  // The same patched items the engine gets, before the app's category check.
  const items = shelf.items.map((raw) => {
    const patch = c.shelfPatch?.find((p) => p.id === raw.id);
    return { ...raw, ...(patch ?? {}) };
  });
  return items
    .map((i) => {
      const bits = [words(String(i.category))];
      const details = attributeText(i.attributes as Record<string, unknown>);
      if (details) bits.push(details);
      if (i.size) bits.push(`size ${i.size}`);
      bits.push(i.opened ? "opened" : "unopened");
      bits.push(i.runOutDate ? `expected to run out ${i.runOutDate}` : "no run-out date");
      return `- ${i.brand} ${i.name} (${bits.join("; ")})`;
    })
    .join("\n");
}

export function fillPrompt(template: string, c: SkipCase, set: Pick<SkipSet, "asOf">, shelf: ShelfFile): string {
  return template
    .replace("{{today}}", set.asOf)
    .replace("{{product}}", productText(c))
    .replace("{{shelf}}", shelfText(c, shelf))
    .trimEnd();
}

export function parseAnswer(text: string): BaselineAnswer {
  const m = text.match(/\b(skip|buy)\b/i);
  return m ? (m[1].toLowerCase() as "skip" | "buy") : "unclear";
}

export interface BaselineLine {
  run: number;
  id: string;
  expected: string;
  answer: BaselineAnswer;
  skipCorrect: boolean;
  text: string;
  model: string;
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
  at: string;
}

export interface BaselineRunScore {
  run: number;
  skipCorrect: number;
  n: number;
  skipsMade: number;
  skipsRight: number;
  wrongSkips: string[];
  missedSkips: string[];
  unclear: string[];
}

export function scoreRun(run: number, lines: Array<Pick<BaselineLine, "id" | "expected" | "answer">>): BaselineRunScore {
  const isSkipExpected = (l: { expected: string }) => l.expected === "skip";
  const said = (l: { answer: BaselineAnswer }) => l.answer === "skip";
  return {
    run,
    skipCorrect: lines.filter((l) => isSkipExpected(l) === said(l)).length,
    n: lines.length,
    skipsMade: lines.filter(said).length,
    skipsRight: lines.filter((l) => said(l) && isSkipExpected(l)).length,
    wrongSkips: lines.filter((l) => said(l) && !isSkipExpected(l)).map((l) => l.id),
    missedSkips: lines.filter((l) => !said(l) && isSkipExpected(l)).map((l) => l.id),
    unclear: lines.filter((l) => l.answer === "unclear").map((l) => l.id),
  };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function parseJsonl(text: string): BaselineLine[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as BaselineLine);
}
