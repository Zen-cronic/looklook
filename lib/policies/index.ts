import table from "@/data/return-policies.json";
import { policyGroupOf, type Category, type PolicyGroup } from "../shelf/categories";

/** Whether a store takes an item back once it has been opened. */
export type OpenedReturn = "yes" | "no" | "conditional" | "unknown";

export interface PolicyRule {
  group: PolicyGroup;
  returnableOpened: OpenedReturn;
  windowDays: number | null;
  conditions: string;
  sourceUrl: string | null;
  checkedOn: string;
}

export interface Retailer {
  id: string;
  name: string;
  domains: string[];
  policyUrl: string | null;
  rules: PolicyRule[];
  notes?: string;
}

export interface PolicyTable {
  checkedOn: string;
  retailers: Retailer[];
}

/** The rule that applies to one item at one store, with where it came from. */
export interface OpenedReturnPolicy extends PolicyRule {
  retailerId: string;
  retailerName: string;
  /** True when the store isn't in the table or has no rule for the item's group. */
  fallback: boolean;
}

export const FALLBACK_RETAILER_ID = "brand-site";

const OPENED: OpenedReturn[] = ["yes", "no", "conditional", "unknown"];
const GROUPS: PolicyGroup[] = ["beauty", "electronics", "general"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class PolicyTableError extends Error {
  constructor(message: string) {
    super(`Return-policy table: ${message}`);
    this.name = "PolicyTableError";
  }
}

/** Validate a parsed table. Every rule needs a known answer type, a date, and a source unless it is unknown. */
export function parsePolicyTable(raw: unknown): PolicyTable {
  const t = raw as Partial<PolicyTable>;
  if (!t || typeof t !== "object" || !Array.isArray(t.retailers)) throw new PolicyTableError("missing retailers");
  if (typeof t.checkedOn !== "string" || !DATE.test(t.checkedOn)) throw new PolicyTableError("missing checkedOn date");
  const ids = new Set<string>();
  for (const r of t.retailers) {
    if (!r.id || ids.has(r.id)) throw new PolicyTableError(`duplicate or empty retailer id ${r.id}`);
    ids.add(r.id);
    if (!Array.isArray(r.domains) || !Array.isArray(r.rules) || r.rules.length === 0) throw new PolicyTableError(`${r.id}: domains and rules are required`);
    for (const rule of r.rules) {
      if (!GROUPS.includes(rule.group)) throw new PolicyTableError(`${r.id}: unknown group ${rule.group}`);
      if (!OPENED.includes(rule.returnableOpened)) throw new PolicyTableError(`${r.id}: bad returnableOpened ${rule.returnableOpened}`);
      if (!DATE.test(rule.checkedOn)) throw new PolicyTableError(`${r.id}/${rule.group}: bad checkedOn`);
      if (rule.returnableOpened !== "unknown" && !rule.sourceUrl) throw new PolicyTableError(`${r.id}/${rule.group}: a known answer needs a source URL`);
      if (rule.windowDays !== null && !(Number.isInteger(rule.windowDays) && rule.windowDays > 0)) throw new PolicyTableError(`${r.id}/${rule.group}: bad windowDays`);
    }
  }
  if (!ids.has(FALLBACK_RETAILER_ID)) throw new PolicyTableError(`the ${FALLBACK_RETAILER_ID} fallback is required`);
  return t as PolicyTable;
}

let cached: PolicyTable | undefined;

export function policyTable(): PolicyTable {
  cached ??= parsePolicyTable(table);
  return cached;
}

function hostOf(value: string): string {
  const v = value.trim().toLowerCase();
  try {
    return new URL(v.includes("://") ? v : `https://${v}`).hostname.replace(/^www\./, "");
  } catch {
    return v;
  }
}

/** Find a retailer by id, name, domain or URL. Unknown stores get the brand-site fallback. */
export function findRetailer(store: string | undefined, t: PolicyTable = policyTable()): Retailer {
  const fallback = t.retailers.find((r) => r.id === FALLBACK_RETAILER_ID)!;
  if (!store) return fallback;
  const key = store.trim().toLowerCase();
  const byId = t.retailers.find((r) => r.id === key || r.name.toLowerCase() === key);
  if (byId) return byId;
  const host = hostOf(store);
  return t.retailers.find((r) => r.domains.some((d) => host === d || host.endsWith(`.${d}`))) ?? fallback;
}

/** The opened-item return rule for this category at this store. */
export function openedReturnPolicy(store: string | undefined, category: Category, t: PolicyTable = policyTable()): OpenedReturnPolicy {
  const retailer = findRetailer(store, t);
  const group = policyGroupOf(category);
  const rule = retailer.rules.find((r) => r.group === group) ?? retailer.rules.find((r) => r.group === "general");
  const fallback = retailer.id === FALLBACK_RETAILER_ID || !rule || rule.group !== group;
  if (!rule) {
    return { retailerId: retailer.id, retailerName: retailer.name, group, returnableOpened: "unknown", windowDays: null, conditions: "No rule recorded.", sourceUrl: null, checkedOn: t.checkedOn, fallback: true };
  }
  return { ...rule, retailerId: retailer.id, retailerName: retailer.name, fallback };
}
