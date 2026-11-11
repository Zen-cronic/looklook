import { APP_NAME } from "../brand";
import type { WeekView } from "../app/week";
import type { Row, TableSpec } from "./schema";

/**
 * The Studio week: this week's order (the slip in code) as a Studio table, and
 * the two tools the order assistant has. Shapes only (safe in the browser).
 * The assistant can take an item off the order or put it back; nothing it can
 * call pays. Only the shopper's yes on the order widget pays, for the order's
 * hash at that moment.
 */

/** The order assistant's tools: both only change which items are in the order. */
export const SLIP_AGENT_TOOLS = ["leave_for_later", "put_back"] as const;

export const SLIP_AGENT_OPENING = `You are ${APP_NAME}'s order assistant.`;

export const SLIP_TABLE: Omit<TableSpec, "id"> & { id: "slip" } = {
  id: "slip",
  name: "This week's order",
  description: "One row per item this week's order lists or listed: in the order, left for next week, held back by the cap or budget, or paid (with its PayPal order).",
  fields: [
    { id: "id", name: "Item", kind: "text" },
    { id: "product", name: "Product", kind: "text" },
    { id: "why", name: "Why", kind: "text", description: "From your posts, or Coming due from the shelf" },
    { id: "amount", name: "Amount", kind: "money" },
    { id: "status", name: "Status", kind: "text", description: "In this order, Left for next week, Over your cap, Over budget, Paid, Declined or another payment state" },
    { id: "orderId", name: "PayPal order", kind: "text" },
  ],
};

const WHY = (why: string) => (why === "buy" ? "From your posts" : "Coming due");
const LEFT: Record<string, string> = { "for-later": "Left for next week", "over-cap": "Over your cap", "over-budget": "Over budget" };
const SENT: Record<string, string> = {
  paid: "Paid",
  queued: "Paying",
  declined: "Declined",
  "price-changed": "Price changed",
  "over-cap": "Over your cap",
  "over-budget": "Over budget",
  stale: "Out of date",
  "needs-checkout": "Needs checkout",
  unconfirmed: "Not confirmed",
};

type ViewLike = Pick<WeekView, "slip" | "sent">;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The slip table's rows from the week as it stands: what is on the slip wins over an earlier outcome for the same line. */
export function slipRows(view: ViewLike): Row[] {
  const rows = new Map<string, Row>();
  for (const l of view.sent) rows.set(l.approvalKey, { id: l.approvalKey, product: l.title, why: WHY(l.why), amount: l.amountCents / 100, status: SENT[l.status] ?? l.status, orderId: l.orderId ?? "" });
  for (const l of view.slip.leftOff) rows.set(l.approvalKey, { id: l.approvalKey, product: l.title, why: WHY(l.why), amount: l.amountCents / 100, status: LEFT[l.leftOff] ?? "Not in this order", orderId: "" });
  for (const l of view.slip.lines) rows.set(l.approvalKey, { id: l.approvalKey, product: l.title, why: WHY(l.why), amount: l.amountCents / 100, status: "In this order", orderId: "" });
  return [...rows.values()];
}

/** The slip agent's instructions, with the lines it may name (by their keys). Starts with the opening /api/llm accepts. */
export function slipAgentInstructions(view: ViewLike): string {
  const on = view.slip.lines.map((l) => `- ${l.approvalKey}: ${l.title}, ${dollars(l.amountCents)} (in the order)`);
  const later = view.slip.leftOff.filter((l) => l.leftOff === "for-later").map((l) => `- ${l.approvalKey}: ${l.title}, ${dollars(l.amountCents)} (left for next week)`);
  return [
    SLIP_AGENT_OPENING,
    "You help the shopper decide which items are in this week's order. You can move an item to Left for next week with leave_for_later, or put an item from Left for next week back in the order with put_back, naming the item by its key below.",
    "You cannot pay, and nothing you do pays. The shopper pays with the pay button under the order, for the order as it then stands.",
    "Use a tool once per item the shopper names, then reply in one short sentence saying what changed, naming the product. Never state the new total, the order on screen shows it.",
    "Words: call it this week's order and each entry an item, or use the product's name. Say Left for next week for an item taken off. Write plain everyday words, no ids or keys, no semicolons, no middle dots, at most 40 words.",
    "If the shopper asks for anything else, say in one sentence that you can only take items off this week's order or put them back.",
    "Items:",
    ...(on.length || later.length ? [...on, ...later] : ["- (nothing in the order)"]),
  ].join("\n");
}
