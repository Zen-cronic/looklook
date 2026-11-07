import cases from "@/eval/skip-set/cases.json";
import bandsFile from "@/eval/skip-set/price-bands.json";
import shelfFile from "@/eval/skip-set/shelf.json";
import type { PriceBand } from "../channel3/band";
import type { SkipCase } from "../eval/skip-set";
import type { Attributes } from "../shelf/categories";
import { validateShelfItem } from "../shelf/store";
import type { ShelfItemInput } from "../shelf/types";
import { decide } from "../verdict/engine";
import { templateReason } from "../verdict/reason";
import type { ReaderAttributes, ScreenshotFields } from "../vision/schema";
import { remainingBudgets } from "./budgets";
import { addDays, daysBetween } from "./dates";
import { SAMPLES } from "./samples";
import type { CheckRecord, SessionState } from "./types";

/** The date the sample shelf's run-out dates were written for. */
export const SEED_BASE_DATE = "2026-11-07";

/**
 * What the sample shopper last paid for the staples they restock, from
 * catalogue listings seen on the seed date, and how long one unit lasts.
 */
const STAPLES: Record<string, { price: number; store: string; productId?: string; cycleDays: number }> = {
  "sh-cleanser": { price: 16.97, store: "walmart.com", productId: "m29GwjG", cycleDays: 60 },
  "sh-ha": { price: 9.9, store: "ulta.com", productId: "STrUbGm", cycleDays: 45 },
  "sh-cream": { price: 13.29, store: "boscovs.com", productId: "j4VjFHh", cycleDays: 75 },
  "sh-mascara": { price: 13.99, store: "walgreens.com", productId: "su2Of21", cycleDays: 90 },
};

/** A short PayPal customer id (PayPal rejects long ones; 19 characters is known to work). */
export function customerIdFor(sessionId: string): string {
  return `sl${sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
}

/**
 * A new shopper starts with the sample shelf and budgets used by the skip
 * test set. Run-out dates move with the calendar, so "runs out in 7 days"
 * stays true whenever the app is opened.
 */
export function seedState(sessionId: string, today: string, now = new Date()): SessionState {
  const shift = daysBetween(SEED_BASE_DATE, today);
  const items = (shelfFile.items as ShelfItemInput[]).map((raw) =>
    validateShelfItem({
      ...raw,
      runOutDate: raw.runOutDate ? addDays(raw.runOutDate, shift) : null,
      source: "manual",
      addedOn: addDays("2026-11-01", shift),
      ...(STAPLES[raw.id as string] ?? {}),
    }),
  );
  const state: SessionState = {
    version: 1,
    id: sessionId,
    createdAt: now.toISOString(),
    customerId: customerIdFor(sessionId),
    dayOffset: 0,
    shelf: items,
    budgets: { currency: "USD", limits: { ...shelfFile.budgets.remaining }, spent: {} },
    checks: [],
    watch: [],
    intents: [],
    methods: [],
    receipts: [],
    declines: [],
    notices: [],
    demo: { declineNextRebuy: false },
  };
  state.checks = SEEDED_CHECKS.map((s, i) => {
    const sample = SAMPLES.find((x) => x.id === s.sample)!;
    return checkFromCase({ ...s, id: `sample-${s.sample}`, imageUrl: `/samples/${sample.file}` }, state, today, new Date(now.getTime() - (SEEDED_CHECKS.length - i) * 60_000));
  });
  return state;
}

/**
 * Sample posts already checked for a new shopper, oldest first, so the most
 * recent (shown first) is a skip: the CVS sunscreen. Each comes from the skip
 * test set's case for the same product and is decided by the same engine.
 */
const SEEDED_CHECKS: Array<{ caseId: string; sample: string; price: number; storeLabel: string }> = [
  { caseId: "c13", sample: "retinol-brand", price: 72, storeLabel: "olehenriksen.com" },
  { caseId: "c03", sample: "vitc-ulta", price: 28.99, storeLabel: "Ulta" },
  { caseId: "c24", sample: "spf-cvs", price: 29.99, storeLabel: "CVS" },
];

const EMPTY_READER_ATTRIBUTES: ReaderAttributes = {
  primaryActive: "",
  actives: [],
  texture: "",
  filter: "",
  area: "",
  spfBand: "",
  finish: "",
  form: "",
  use: "",
  coverage: "",
  shadeFamily: "",
  tint: "",
  effect: "",
  formula: "",
  purpose: "",
  style: "",
  noiseCancelling: "",
  type: "",
};

function readerAttributes(a: Attributes): ReaderAttributes {
  const out: ReaderAttributes = { ...EMPTY_READER_ATTRIBUTES };
  for (const [k, v] of Object.entries(a)) {
    if (!(k in out) || v === undefined) continue;
    (out as unknown as Record<string, unknown>)[k] = k === "actives" ? (Array.isArray(v) ? v : [v]) : Array.isArray(v) ? v[0] : v;
  }
  return out;
}

export interface CaseCheckSeed {
  /** Check id. */
  id: string;
  /** Skip test set case the product, store and attributes come from. */
  caseId: string;
  /** Sample id recorded on the check (a bundled post, or a sample-week entry). */
  sample: string;
  price: number;
  storeLabel: string;
  imageUrl?: string;
  /** Weekly medians for the price trend, when the sample has them. */
  weekly?: number[];
}

/**
 * A check of one skip-set product, decided by the same engine against this
 * shopper's shelf and budgets, as if the shopper had sent the post at `at`.
 */
export function checkFromCase(seed: CaseCheckSeed, state: SessionState, today: string, at: Date): CheckRecord {
  const c = (cases.cases as unknown as SkipCase[]).find((x) => x.id === seed.caseId);
  if (!c) throw new Error(`unknown case ${seed.caseId}`);
  const frozen = c.catalogId ? (((bandsFile.bands as Record<string, PriceBand | null>)[c.catalogId] ?? null) as PriceBand | null) : null;
  const band = frozen && seed.weekly ? { ...frozen, weekly: seed.weekly } : frozen;
  const facts = { brand: c.brand, name: c.name, category: c.category, attributes: c.attributes, priceShown: seed.price, identityConfidence: 0.95 };
  const fields: ScreenshotFields = {
    isProduct: true,
    brand: c.brand,
    productName: c.name,
    variant: null,
    size: null,
    price: { amount: seed.price, currency: "USD" },
    source: "creator-post",
    store: seed.storeLabel,
    category: c.category,
    attributes: readerAttributes(c.attributes),
    legibility: 0.95,
  };
  const decision = decide({ product: facts, store: c.store, shelf: state.shelf, budgets: remainingBudgets(state.budgets, today), priceBand: band, today });
  return {
    id: seed.id,
    createdAt: at.toISOString(),
    decidedOn: today,
    input: { kind: "screenshot", imageHash: "", sample: seed.sample },
    fields,
    candidates: [],
    product: { id: c.catalogId ?? seed.sample, title: c.name, brand: c.brand, ...(seed.imageUrl ? { imageUrl: seed.imageUrl } : {}), category: c.category },
    needsConfirmation: false,
    confirmWhy: [],
    facts,
    store: c.store,
    band,
    decision,
    reason: { text: templateReason(decision, facts), source: "template" },
  };
}
