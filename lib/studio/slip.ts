import { APP_NAME } from "../brand";
import type { WeekView } from "../app/week";
import type { Row, TableSpec } from "./schema";

/**
 * The Studio week: this week's slip as a Studio table, and the two tools the
 * slip agent has. Shapes only (safe in the browser). The agent can take a
 * line off the slip or put it back; nothing it can call pays. Only the
 * shopper's yes on the slip widget pays, for the slip's hash at that moment.
 */

/** The slip agent's tools: both only change which lines are on the slip. */
export const SLIP_AGENT_TOOLS = ["leave_for_later", "put_back"] as const;

export const SLIP_AGENT_OPENING = `You are ${APP_NAME}'s slip agent.`;

export const SLIP_TABLE: Omit<TableSpec, "id"> & { id: "slip" } = {
  id: "slip",
  name: "This week's slip",
  description: "One row per payment this week's slip lists or listed: on the slip, left for later, held back by the cap or budget, or paid (with its PayPal order).",
  fields: [
    { id: "id", name: "Line", kind: "text" },
    { id: "product", name: "Product", kind: "text" },
    { id: "why", name: "Why", kind: "text", description: "From your posts, or Coming due from the shelf" },
    { id: "amount", name: "Amount", kind: "money" },
    { id: "status", name: "Status", kind: "text", description: "On the slip, Left for later, Over your cap, Over budget, Paid, Declined or another payment state" },
    { id: "orderId", name: "PayPal order", kind: "text" },
  ],
};

const WHY = (why: string) => (why === "buy" ? "From your posts" : "Coming due");
const LEFT: Record<string, string> = { "for-later": "Left for later", "over-cap": "Over your cap", "over-budget": "Over budget" };
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
  for (const l of view.slip.leftOff) rows.set(l.approvalKey, { id: l.approvalKey, product: l.title, why: WHY(l.why), amount: l.amountCents / 100, status: LEFT[l.leftOff] ?? "Not on this yes", orderId: "" });
  for (const l of view.slip.lines) rows.set(l.approvalKey, { id: l.approvalKey, product: l.title, why: WHY(l.why), amount: l.amountCents / 100, status: "On the slip", orderId: "" });
  return [...rows.values()];
}

/** The slip agent's instructions, with the lines it may name (by their keys). Starts with the opening /api/llm accepts. */
export function slipAgentInstructions(view: ViewLike): string {
  const on = view.slip.lines.map((l) => `- ${l.approvalKey}: ${l.title}, ${dollars(l.amountCents)} (on the slip)`);
  const later = view.slip.leftOff.filter((l) => l.leftOff === "for-later").map((l) => `- ${l.approvalKey}: ${l.title}, ${dollars(l.amountCents)} (left for later)`);
  return [
    SLIP_AGENT_OPENING,
    "You help the shopper decide which lines are on this week's payment slip. You can take a line off the slip with leave_for_later, or put a line left for later back with put_back, naming the line by its key below.",
    "You cannot pay, and nothing you do pays: the shopper pays by tapping yes on the slip widget, for the slip as it then stands.",
    "Use a tool once per line the shopper names, then reply in one short sentence saying what changed. Never state the new total: the slip widget shows it.",
    "If the shopper asks for anything else, say in one sentence that you can only take lines off this slip or put them back.",
    "Lines:",
    ...(on.length || later.length ? [...on, ...later] : ["- (nothing on the slip)"]),
  ].join("\n");
}
