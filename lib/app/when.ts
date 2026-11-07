import { formatDate, formatDay, formatTime, realToday } from "./dates";
import type { CheckRecord, Receipt, SessionState } from "./types";

/**
 * How dates read when the simulated clock is on. Something that happened (a
 * restock, a payment) shows the real US Eastern time it happened. A date
 * counted from the shopper's today (a run-out date, a budget restart) carries
 * the words "simulated date" while the date control is ahead of today.
 */

export const SIMULATED = "simulated date";

/** "Nov 7, 9:41 PM ET": the real time of an event. */
export function eventTime(iso: string): string {
  return `${formatTime(iso)} ET`;
}

/** A date counted from the app's today, labelled when that today is simulated. */
export function countedDate(date: string, dayOffset: number): string {
  return dayOffset > 0 ? `${formatDate(date)} (${SIMULATED})` : formatDate(date);
}

/** The latest completed payment that restocked this shelf item. */
export function restockReceipt(state: Pick<SessionState, "receipts" | "watch">, itemId: string): Receipt | undefined {
  return [...state.receipts].reverse().find((r) => {
    if (!r.shelfNote.startsWith("Restocked")) return false;
    if (r.source.kind === "staple") return r.source.shelfItemId === itemId;
    if (r.source.kind === "watch") {
      const watchId = r.source.watchId;
      return state.watch.find((w) => w.id === watchId)?.shelfItemId === itemId;
    }
    return false;
  });
}

/**
 * When a shelf item was last restocked: the real time of the payment, or,
 * with no payment on record, the stored day labelled when it isn't today.
 */
export function restockedLabel(state: Pick<SessionState, "receipts" | "watch">, item: { id: string; lastRestockedOn?: string }, now = new Date()): string {
  const receipt = restockReceipt(state, item.id);
  if (receipt) return eventTime(receipt.createdAt);
  if (!item.lastRestockedOn) return "";
  return item.lastRestockedOn === realToday(now) ? formatDate(item.lastRestockedOn) : `${formatDate(item.lastRestockedOn)} (${SIMULATED})`;
}

/** The receipt-line suffix for a payment made while the simulated date was on. */
export function simulatedSuffix(on: string, createdAt: string): string {
  return on !== realToday(new Date(createdAt)) ? `, ${SIMULATED} ${formatDay(on)}` : "";
}

const LOWER_FIRST = /^(The|You|Your|It|Its|This|That|Nothing|We|A|An|Not|Already|Over|Within|Above|Below|Fits)\b/;

/** A bought check's reason, worded as what was true when it was decided. */
export function atTheTime(reason: string): string {
  const text = reason.trim();
  if (!text) return text;
  const first = LOWER_FIRST.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
  return `At the time: ${first}`;
}

/** The bought receipt of a check, if it was bought. */
export function boughtReceipt(state: Pick<SessionState, "receipts">, check: Pick<CheckRecord, "purchasedReceiptId">): Receipt | undefined {
  return check.purchasedReceiptId ? state.receipts.find((r) => r.id === check.purchasedReceiptId) : undefined;
}
