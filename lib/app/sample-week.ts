import trendsFile from "@/data/sample-week/trends.json";
import { checkFromCase, seedState, type CaseCheckSeed } from "./seed";
import { SAMPLES } from "./samples";
import type { SessionState } from "./types";

/**
 * The sample week: the fictional shopper's shelf and budgets, with a week of
 * checks already decided by the same engine. It gives the Decisions
 * workspace something to group: a price wait (with its target and the 90-day
 * trend), two next-month budget waits, two skips, a buy, and the staple that
 * is due for a rebuy on the sample shelf. Every product, store and price
 * comes from the skip test set; the shopper and the week are made up. The
 * week is skincare, makeup and hair only, so it keeps just those budgets.
 */

const trends = (trendsFile as { trends: Record<string, { weekly: number[] }> }).trends;

const image = (sample: string) => `/samples/${SAMPLES.find((s) => s.id === sample)!.file}`;

type Entry = Omit<CaseCheckSeed, "id" | "sample"> & { key: string; daysAgo: number };

/** Oldest first; the newest check (the sunscreen skip) shows first, as on a fresh session. */
const ENTRIES: Entry[] = [
  { key: "retinol-pro", caseId: "c09", price: 99, storeLabel: "Ulta", daysAgo: 5 },
  { key: "shampoo", caseId: "c53", price: 42, storeLabel: "Sephora", daysAgo: 4 },
  { key: "peptide", caseId: "c11", price: 32, storeLabel: "Sephora", imageUrl: image("peptide-sephora"), daysAgo: 3 },
  { key: "retinol", caseId: "c13", price: 72, storeLabel: "olehenriksen.com", imageUrl: image("retinol-brand"), weekly: trends.TNq1quB?.weekly, daysAgo: 2 },
  { key: "vitc", caseId: "c03", price: 28.99, storeLabel: "Ulta", imageUrl: image("vitc-ulta"), daysAgo: 1 },
  { key: "spf", caseId: "c24", price: 29.99, storeLabel: "CVS", imageUrl: image("spf-cvs"), daysAgo: 0 },
];

export const SAMPLE_WEEK_PREFIX = "week-";

/** Budgets the sample shopper doesn't keep: the week is beauty only. */
const OFF_THEME_BUDGETS = ["kitchen", "electronics"] as const;

export function isSampleWeekCheck(sample: string | undefined): boolean {
  return Boolean(sample?.startsWith(SAMPLE_WEEK_PREFIX));
}

/**
 * A fresh sample-week state for this browser. Saved payment methods are kept
 * (they live at PayPal until removed); everything else starts over.
 */
export function sampleWeekState(sessionId: string, today: string, previous?: SessionState, now = new Date()): SessionState {
  const state = seedState(sessionId, today, now);
  if (previous) {
    state.customerId = previous.customerId;
    state.methods = previous.methods.filter((m) => m.status === "active");
  }
  for (const g of OFF_THEME_BUDGETS) delete state.budgets.limits[g];
  state.checks = ENTRIES.map((e, i) => {
    const at = new Date(now.getTime() - e.daysAgo * 86_400_000 - (ENTRIES.length - i) * 60_000);
    return checkFromCase({ ...e, id: `${SAMPLE_WEEK_PREFIX}${e.key}`, sample: `${SAMPLE_WEEK_PREFIX}${e.key}` }, state, today, at);
  });
  state.sample = { kind: "week", loadedAt: now.toISOString() };
  return state;
}
