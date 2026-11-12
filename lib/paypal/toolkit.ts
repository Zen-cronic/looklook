import { HttpError } from "../app/http";
import { findRun, lineStatus } from "../app/week";
import type { SessionState } from "../app/types";
import { neutralDeep } from "../filming/view";
import { credentialsFromEnv, type PayPalCredentials } from "./config";

/**
 * PayPal's Agent Toolkit, read-only. The Studio week assistant can read what
 * PayPal recorded for an item this session paid: the order (get_order) and
 * any refund on it (get_refund). Nothing here creates, pays or refunds, and
 * the toolkit is built with only those two actions turned on, for the
 * sandbox. Server only: the route at /api/week/[id]/paypal is the one caller.
 */

if (typeof window !== "undefined") throw new Error("lib/paypal/toolkit is server-only.");

/** The only toolkit tools LookLook exposes. Both read. */
export const READ_ONLY_TOOLS = ["get_order", "get_refund"] as const;
export type ReadOnlyTool = (typeof READ_ONLY_TOOLS)[number];

/** The toolkit's action keys for those two tools (checked against the package: orders.get is get_order, payments.getRefunds is get_refund). */
export const TOOLKIT_ACTIONS = { orders: { get: true }, payments: { getRefunds: true } } as const;

/** The toolkit's configuration: the two read actions, against the PayPal sandbox only. */
export function toolkitConfiguration() {
  return { actions: { orders: { ...TOOLKIT_ACTIONS.orders }, payments: { ...TOOLKIT_ACTIONS.payments } }, context: { sandbox: true as const } };
}

/** Kill switch: PAYPAL_AGENT_TOOLKIT=0 turns lookups off. */
export function lookupsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PAYPAL_AGENT_TOOLKIT !== "0";
}

/** The part of an AI SDK tool we use: its own parameter schema and its execute. */
export interface ToolLike {
  parameters: { parse(input: unknown): unknown };
  execute?: (args: never, options: never) => PromiseLike<unknown>;
}
export type ReadOnlyTools = Record<ReadOnlyTool, ToolLike>;

/** Build the toolkit and take its tools, refusing to go on if it offers anything but the two read tools. */
export async function buildReadOnlyTools(credentials: PayPalCredentials = credentialsFromEnv()): Promise<ReadOnlyTools> {
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
  const toolkit = new PayPalAgentToolkit({ clientId: credentials.clientId, clientSecret: credentials.clientSecret, configuration: toolkitConfiguration() });
  const tools = toolkit.getTools() as unknown as Record<string, ToolLike>;
  assertReadOnly(tools);
  return tools as ReadOnlyTools;
}

/** Throws unless the tool set is exactly READ_ONLY_TOOLS. */
export function assertReadOnly(tools: Record<string, unknown>): void {
  const names = Object.keys(tools).sort();
  if (names.join(",") !== [...READ_ONLY_TOOLS].sort().join(",")) throw new Error(`The PayPal toolkit offered ${names.join(", ") || "no tools"}, expected only ${READ_ONLY_TOOLS.join(", ")}.`);
}

// The toolkit keeps its OAuth token for the life of the instance, so a new one is built every half hour.
const REBUILD_MS = 30 * 60 * 1000;
let cached: { tools: Promise<ReadOnlyTools>; at: number } | undefined;

/** The read-only tools, built once and reused for a while. */
export function readOnlyTools(now = Date.now()): Promise<ReadOnlyTools> {
  if (!cached || now - cached.at > REBUILD_MS) {
    const tools = buildReadOnlyTools();
    tools.catch(() => (cached = undefined));
    cached = { tools, at: now };
  }
  return cached.tools;
}

export interface Money {
  currency: string;
  value: string;
}
export interface PaymentRecord {
  orderId: string;
  status: string;
  amount: Money | null;
  capture: { id: string; status: string; amount: Money | null } | null;
  refunds: Array<{ id: string; status: string; amount: Money | null }>;
}

export class LookupError extends Error {}

type Raw = Record<string, unknown> & { id?: unknown };

async function call(tools: ReadOnlyTools, name: ReadOnlyTool, args: Record<string, string>): Promise<Raw> {
  const tool = tools[name];
  if (!tool?.execute) throw new LookupError(`The PayPal toolkit has no ${name}.`);
  // The toolkit's own schema checks the id before anything is sent.
  let params: unknown;
  try {
    params = tool.parameters.parse(args);
  } catch {
    throw new LookupError(`PayPal's ${name} doesn't accept that id.`);
  }
  const raw = await tool.execute(params as never, { toolCallId: `looklook-${name}`, messages: [] } as never);
  let data: Raw;
  try {
    data = (typeof raw === "string" ? JSON.parse(raw) : raw) as Raw;
  } catch {
    throw new LookupError("PayPal's answer wasn't readable.");
  }
  if (!data || typeof data !== "object" || typeof data.id !== "string") {
    const err = (data as { error?: { message?: unknown }; message?: unknown } | null) ?? {};
    const message = typeof err.error?.message === "string" ? err.error.message : typeof err.message === "string" ? err.message : "no record";
    throw new LookupError(`PayPal didn't return the record (${message}).`);
  }
  return data;
}

const money = (m: unknown): Money | null => {
  const x = m as { currency_code?: unknown; value?: unknown } | undefined;
  return x && typeof x.currency_code === "string" && typeof x.value === "string" ? { currency: x.currency_code, value: x.value } : null;
};
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** What PayPal recorded for one order: get_order, then get_refund for each refund the order lists. */
export async function lookUpPayment(orderId: string, tools: ReadOnlyTools): Promise<PaymentRecord> {
  const order = await call(tools, "get_order", { id: orderId });
  const unit = ((order.purchase_units as unknown[]) ?? [])[0] as { amount?: unknown; payments?: { captures?: Raw[]; refunds?: Raw[] } } | undefined;
  const cap = unit?.payments?.captures?.[0];
  const refunds: PaymentRecord["refunds"] = [];
  for (const r of unit?.payments?.refunds ?? []) {
    if (typeof r.id !== "string") continue;
    const full = await call(tools, "get_refund", { refund_id: r.id });
    refunds.push({ id: str(full.id), status: str(full.status), amount: money(full.amount) });
  }
  return {
    orderId: str(order.id),
    status: str(order.status),
    amount: money(unit?.amount),
    capture: cap ? { id: str(cap.id), status: str(cap.status), amount: money(cap.amount) } : null,
    refunds,
  };
}

const showMoney = (m: Money | null) => (!m ? "an amount PayPal didn't list" : m.currency === "USD" ? `$${m.value}` : `${m.value} ${m.currency}`);

/** One plain sentence (two with refunds) the assistant and the shopper read. */
export function describeRecord(title: string, r: PaymentRecord): string {
  const paid = r.capture ? `${showMoney(r.capture.amount ?? r.amount)} taken, capture ${r.capture.status}` : `${showMoney(r.amount)}, nothing taken yet`;
  const refunds = r.refunds.length ? ` ${r.refunds.map((x) => `Refund ${x.id} ${x.status}, ${showMoney(x.amount)}.`).join(" ")}` : " No refund.";
  return `PayPal's record for ${title}: order ${r.orderId} is ${r.status}, ${paid}.${refunds}`;
}

/**
 * The PayPal order for a paid item in this session's week. Another session's week or item, or an unpaid one, is a 404 and nothing is sent to PayPal.
 * With `film`, the title is the filming-mode name, so the sentence the Studio assistant reads names no brand.
 */
export function paidOrderFor(state: SessionState, runId: string, key: string, opts: { film?: boolean } = {}): { orderId: string; title: string } {
  const run = findRun(state, runId);
  const line = run.sent.find((l) => l.approvalKey === key);
  const status = line ? lineStatus(state, run, line) : undefined;
  if (!line || status?.status !== "paid" || !status.orderId) throw new HttpError(404, "That item isn't paid in this week's order.");
  return { orderId: status.orderId, title: opts.film ? neutralDeep(line).title : line.title };
}
