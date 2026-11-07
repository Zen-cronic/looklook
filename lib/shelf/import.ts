import { PayPalApiError, type PayPalClient } from "../paypal";
import { isCategory, type Attributes, type Category } from "./categories";
import { identityKey } from "./similarity";
import { validateShelfItem } from "./store";
import type { ShelfItem } from "./types";

/**
 * Filling the shelf from purchases made through this app.
 *
 * Two sources:
 * 1. The app's own order records (always available).
 * 2. PayPal activity on this merchant account (Transaction Search). That needs
 *    the reporting permission on the PayPal app; it is behind
 *    SHELF_IMPORT_PAYPAL=1 and degrades to "unavailable" on a 403. It only
 *    ever shows purchases made at this merchant.
 *
 * Line items carry a SKU of the form `sl:<category>:<product id>` so an
 * imported line can be placed on the shelf without guessing its category.
 */

export const SKU_PREFIX = "sl";

export function shelfSku(category: Category, productId: string): string {
  return `${SKU_PREFIX}:${category}:${productId}`;
}

export function parseShelfSku(sku: string | undefined): { category: Category; productId: string } | undefined {
  const m = /^sl:([a-z-]+):(.+)$/.exec(sku ?? "");
  if (!m || !isCategory(m[1])) return undefined;
  return { category: m[1], productId: m[2] };
}

export interface AppOrderLine {
  sku: string;
  name: string;
  brand: string;
  attributes?: Attributes;
  size?: string;
}

export interface AppOrder {
  orderId: string;
  /** Capture date (YYYY-MM-DD). Only completed captures should be passed in. */
  capturedOn: string;
  lines: AppOrderLine[];
}

export interface ImportResult {
  added: ShelfItem[];
  /** Lines we could not place (unknown category); shown to the user to sort by hand. */
  needsReview: Array<{ name: string; sku?: string; reason: string }>;
  /** Lines already on the shelf (same product, unopened). */
  skipped: number;
}

function dedupe(existing: ShelfItem[], candidates: ShelfItem[]): { added: ShelfItem[]; skipped: number } {
  const owned = new Set(existing.filter((i) => !i.opened).map((i) => identityKey(i.brand, i.name)));
  const added: ShelfItem[] = [];
  let skipped = 0;
  for (const c of candidates) {
    const key = identityKey(c.brand, c.name);
    if (owned.has(key)) {
      skipped += 1;
      continue;
    }
    owned.add(key);
    added.push(c);
  }
  return { added, skipped };
}

/** New shelf rows from the app's own completed orders: unopened, run-out date unknown until the user sets it. */
export function importAppOrders(orders: AppOrder[], existing: ShelfItem[] = []): ImportResult {
  const candidates: ShelfItem[] = [];
  const needsReview: ImportResult["needsReview"] = [];
  for (const order of orders) {
    for (const line of order.lines) {
      const parsed = parseShelfSku(line.sku);
      if (!parsed) {
        needsReview.push({ name: line.name, sku: line.sku, reason: "unknown-category" });
        continue;
      }
      candidates.push(
        validateShelfItem({
          id: `${order.orderId}:${line.sku}`,
          name: line.name,
          brand: line.brand,
          category: parsed.category,
          attributes: line.attributes ?? {},
          opened: false,
          runOutDate: null,
          size: line.size,
          source: "app-order",
          addedOn: order.capturedOn,
        }),
      );
    }
  }
  return { ...dedupe(existing, candidates), needsReview };
}

interface TransactionDetail {
  transaction_info?: { transaction_id?: string; transaction_status?: string; transaction_initiation_date?: string };
  cart_info?: { item_details?: Array<{ item_name?: string; item_code?: string }> };
}

export type PayPalImport =
  | { status: "disabled" }
  | { status: "unavailable"; reason: "not-authorized" | "error"; detail: string }
  | ({ status: "ok"; transactions: number; withItemLines: number } & ImportResult);

function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Shelf rows from this merchant's PayPal activity (last `days`, at most 31).
 * Item lines without our SKU go to needsReview. Never throws for a missing
 * permission: it returns "unavailable" so the shelf falls back to manual add.
 */
export async function importPayPalActivity(
  client: Pick<PayPalClient, "request">,
  options: { enabled?: boolean; days?: number; now?: Date; existing?: ShelfItem[] } = {},
): Promise<PayPalImport> {
  const enabled = options.enabled ?? process.env.SHELF_IMPORT_PAYPAL === "1";
  if (!enabled) return { status: "disabled" };
  const end = options.now ?? new Date();
  const days = Math.min(Math.max(options.days ?? 31, 1), 31);
  const start = new Date(end.getTime() - days * 86_400_000 + 60_000);
  const details: TransactionDetail[] = [];
  try {
    for (let page = 1; ; page++) {
      const res = await client.request<{ transaction_details?: TransactionDetail[]; total_pages?: number }>({
        method: "GET",
        path: "/v1/reporting/transactions",
        query: { start_date: isoNoMillis(start), end_date: isoNoMillis(end), fields: "transaction_info,cart_info", page_size: 100, page },
      });
      details.push(...(res.body.transaction_details ?? []));
      if (!res.body.total_pages || page >= res.body.total_pages) break;
    }
  } catch (e) {
    if (e instanceof PayPalApiError && (e.status === 403 || e.status === 401)) {
      return { status: "unavailable", reason: "not-authorized", detail: "Transaction Search is not enabled for this PayPal app." };
    }
    return { status: "unavailable", reason: "error", detail: (e as Error).message.slice(0, 200) };
  }
  const orders: AppOrder[] = [];
  let withItemLines = 0;
  for (const t of details) {
    const items = t.cart_info?.item_details ?? [];
    if (items.length) withItemLines += 1;
    if (t.transaction_info?.transaction_status && t.transaction_info.transaction_status !== "S") continue;
    orders.push({
      orderId: t.transaction_info?.transaction_id ?? "unknown",
      capturedOn: (t.transaction_info?.transaction_initiation_date ?? end.toISOString()).slice(0, 10),
      lines: items.map((i) => ({ sku: i.item_code ?? "", name: i.item_name ?? "Unnamed item", brand: "" })),
    });
  }
  const result = importAppOrders(orders, options.existing);
  return {
    status: "ok",
    transactions: details.length,
    withItemLines,
    ...result,
    added: result.added.map((i) => ({ ...i, source: "paypal-activity" as const })),
  };
}
