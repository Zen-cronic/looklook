import shelfFile from "@/eval/skip-set/shelf.json";
import { validateShelfItem } from "../shelf/store";
import type { ShelfItemInput } from "../shelf/types";
import { addDays, daysBetween } from "./dates";
import type { SessionState } from "./types";

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
  return {
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
}
