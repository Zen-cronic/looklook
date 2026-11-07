/**
 * Can the shelf be filled from PayPal history? Calls Transaction Search
 * (/v1/reporting/transactions, fields=all, last 31 days) on the sandbox
 * merchant and reports whether item lines (cart_info.item_details) come back.
 *
 *   npm run spike:transaction-search
 *
 * Prints a summary with ids, amounts and item names only. The full response
 * is written to data/cache/ (gitignored) for inspection.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnv } from "./lib/env";
import { PayPalApiError, getPayPalClient } from "../lib/paypal";

loadEnv();

interface TransactionDetail {
  transaction_info?: {
    transaction_id?: string;
    transaction_event_code?: string;
    transaction_status?: string;
    transaction_initiation_date?: string;
    transaction_amount?: { currency_code: string; value: string };
    invoice_id?: string;
    custom_field?: string;
  };
  payer_info?: Record<string, unknown>;
  cart_info?: { item_details?: Array<{ item_name?: string; item_code?: string; item_quantity?: string; item_unit_price?: { value: string } }> };
}

interface SearchPage {
  transaction_details?: TransactionDetail[];
  total_items?: number;
  total_pages?: number;
  page?: number;
  last_refreshed_datetime?: string;
}

function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function main() {
  const client = getPayPalClient();
  const end = new Date();
  const start = new Date(end.getTime() - 31 * 24 * 3600 * 1000 + 60_000);
  const all: TransactionDetail[] = [];
  let page = 1;
  let meta: SearchPage = {};
  for (;;) {
    const res = await client.request<SearchPage>({
      method: "GET",
      path: "/v1/reporting/transactions",
      query: { start_date: isoNoMillis(start), end_date: isoNoMillis(end), fields: "all", page_size: 100, page },
    });
    meta = res.body;
    all.push(...(res.body.transaction_details ?? []));
    if (!res.body.total_pages || page >= res.body.total_pages) break;
    page += 1;
  }

  mkdirSync("data/cache", { recursive: true });
  const out = `data/cache/transaction-search-${isoNoMillis(end).slice(0, 10)}.json`;
  writeFileSync(out, JSON.stringify({ start: isoNoMillis(start), end: isoNoMillis(end), meta: { ...meta, transaction_details: undefined }, transactions: all }, null, 2));

  console.log(`window ${isoNoMillis(start)} .. ${isoNoMillis(end)}; data refreshed to ${meta.last_refreshed_datetime ?? "?"}`);
  console.log(`transactions: ${all.length}`);
  let withItems = 0;
  for (const t of all) {
    const ti = t.transaction_info ?? {};
    const items = t.cart_info?.item_details ?? [];
    if (items.length) withItems += 1;
    const names = items.map((i) => `${i.item_name ?? "?"}${i.item_code ? ` [${i.item_code}]` : ""} x${i.item_quantity ?? "?"}`).join("; ");
    console.log(
      `${ti.transaction_initiation_date ?? "?"}  ${ti.transaction_id ?? "?"}  ${ti.transaction_event_code ?? "?"}  ${ti.transaction_status ?? "?"}  ` +
        `${ti.transaction_amount?.value ?? "?"} ${ti.transaction_amount?.currency_code ?? ""}  items: ${items.length ? names : "none"}  payer fields: ${Object.keys(t.payer_info ?? {}).join(",") || "none"}`,
    );
  }
  console.log(`\nwith item lines: ${withItems} of ${all.length}`);
  console.log(`full response: ${out}`);
}

main().catch((e) => {
  const err = e as PayPalApiError;
  console.error(`FAIL  ${err.name}: ${err.message}${err.debugId ? ` (debug id ${err.debugId})` : ""}`);
  if (err instanceof PayPalApiError && err.status === 403) {
    console.error(
      "The app's token has no reporting scope. In the PayPal developer dashboard, open the sandbox app, " +
        "tick the Transaction search feature, save, then rerun (a new token picks up the scope; it can take a while to apply).",
    );
  }
  process.exit(1);
});
