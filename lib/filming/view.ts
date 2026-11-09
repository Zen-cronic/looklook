/**
 * Filming mode applied to records about to be shown: a copy of the session
 * (or any record) with names, stores, handles, images and card networks made
 * generic. Ids, links, amounts, dates and decisions are untouched, and the
 * copy is never saved.
 */
import type { CheckRecord, SessionState } from "../app/types";
import { templateReason } from "../verdict/reason";
import { brandLine, namesABrand, neutralText, productImage, productName, shortId, storeLabel } from "./neutral";

export interface ViewOptions {
  /** Also shorten PayPal ids (orders, captures, request ids) to their last three characters. */
  shortIds?: boolean;
}

/** Keys whose values are ids, links or codes: never rewritten. */
const KEEP = /^(id|sample|sourceRef|kind|type|status|verdict|rule|relation|group|category|currency|cycle|imageHash|approvalKey|vaultId|customerId|source|domain|offerDomain|on|decidedOn|runOutDate|lastRestockedOn|addedOn|waitUntil|buyBy|issue|verification|state)$|(Id|Ids|Url|url|href|At)$/;

/** PayPal ids that a recording shows only the end of. */
const PAYPAL_IDS = /^(orderId|captureId|requestId|debugId|eventId|firstOrderId|vaultId)$/;

type Obj = Record<string, unknown>;

function neutralString(value: string, key: string, parent: Obj, opts: ViewOptions): string {
  if (opts.shortIds && PAYPAL_IDS.test(key)) return shortId(value);
  if (key === "imageUrl") return productImage(value, parent.category as string | undefined) ?? value;
  if (KEEP.test(key)) return value;
  if (key === "brand") {
    // A brand above a name shows the product's group; inside "brand name" text it is dropped.
    return typeof parent.category === "string" && !("productName" in parent) ? brandLine(parent.category) : "";
  }
  if ((key === "name" || key === "title" || key === "productName") && typeof parent.brand === "string") {
    return productName({ brand: parent.brand, name: value, id: (parent.catalogId ?? parent.productId ?? parent.itemId ?? parent.id) as string | undefined, category: parent.category as string | undefined, attributes: parent.attributes as Obj | undefined });
  }
  if (key === "store" || key === "retailerName" || key === "storeName") return storeLabel(value);
  return neutralText(value, opts);
}

/** A neutral copy of any JSON-like value. */
export function neutralDeep<T>(value: T, opts: ViewOptions = {}, key = "", parent: Obj = {}): T {
  if (typeof value === "string") return neutralString(value, key, parent, opts) as T;
  if (Array.isArray(value)) return value.map((v) => neutralDeep(v, opts, key, parent)) as T;
  if (value && typeof value === "object") {
    const src = value as Obj;
    const out: Obj = {};
    for (const [k, v] of Object.entries(src)) out[k] = neutralDeep(v, opts, k, src);
    return out as T;
  }
  return value;
}

/**
 * The reason line for a check, rewritten term by term. If a reason a model
 * wrote freely still names something brand-like after that, the same facts
 * are worded by the template instead.
 */
export function neutralReason(raw: CheckRecord, view: CheckRecord): string {
  const text = neutralText(raw.reason.text);
  return namesABrand(text) ? templateReason(view.decision, view.facts) : text;
}

/** The session as filming mode shows it. */
export function filmState(state: SessionState, opts: ViewOptions = {}): SessionState {
  const view = neutralDeep(state, opts);
  view.checks = view.checks.map((c, i) => ({ ...c, reason: { ...c.reason, text: neutralReason(state.checks[i], c) } }));
  return view;
}
