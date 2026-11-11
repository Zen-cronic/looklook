/** The words the week and receipt pages use for price protection (a price guard in code; built from the view, so filming mode's names carry through). */
import { formatDay } from "./dates";
import type { GuardView } from "./guard";
import { formatCents } from "./money";

const NO_GUARD: Record<NonNullable<GuardView["noGuard"]>, (store: string) => string> = {
  "no-rules": (store) => `we don't have ${store}'s return rules on record`,
  "not-opened": (store) => `${store} doesn't take it back once opened`,
  sometimes: (store) => `${store} takes it back opened only at its discretion`,
  "no-days": (store) => `${store}'s return policy gives no number of days`,
};

export function guardHead(g: GuardView): string {
  if (g.status === "on") return `${g.title}: price protection until ${formatDay(g.until)}. ${g.store} takes it back opened until then, so if the price drops there, you get the difference back.`;
  if (g.status === "starting") return `${g.title}: starting price protection at ${g.store}…`;
  if (g.status === "ended") return `${g.title}: price protection has ended.`;
  if (g.noGuard) return `${g.title}: no price protection, because ${NO_GUARD[g.noGuard](g.store)}.`;
  return `${g.title}: no price protection. ${g.note ?? ""}`.trim();
}

/** The one-line version for the finished week's card: says what is protected, until when and where. */
export function guardLine(g: GuardView): string {
  if (g.status === "on") return `Price protection on ${g.title} until ${formatDay(g.until)} at ${g.store}. If the price drops there, you get the difference back.`;
  if (g.status === "starting") return `Starting price protection on ${g.title} at ${g.store}…`;
  if (g.status === "ended") return `Price protection on ${g.title} has ended.`;
  return guardHead(g);
}

export function guardRefundLine(g: GuardView, x: GuardView["refunds"][number]): string {
  const pending = x.status !== "COMPLETED" ? ` (refund ${x.status.toLowerCase()})` : "";
  return `Price dropped to ${formatCents(x.priceCents)} at ${g.store}. ${formatCents(x.amountCents)} back to your card${g.budget ? ` and to your ${g.budget} budget` : ""}${pending}.`;
}

export function guardTestLabel(g: GuardView): string {
  return `Try a price drop to ${formatCents(g.testCents ?? 0)}`;
}
