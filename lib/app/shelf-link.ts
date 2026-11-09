import { relationText } from "./explain";
import type { CheckRecord } from "./types";
import type { ShelfItem } from "../shelf/types";

const ATTRIBUTE_WORDS: Record<string, string> = { spfBand: "SPF range", primaryActive: "main active", shadeFamily: "shade family", noiseCancelling: "noise cancelling" };

/** "SPF range" for spfBand. */
export function attributeWord(key: string): string {
  return ATTRIBUTE_WORDS[key] ?? key.replace(/([A-Z])/g, " $1").toLowerCase();
}

/** The shelf item a check matched, as the "already on your shelf" card shows it; null when nothing matched. */
export function shelfLink(check: CheckRecord, shelf: ShelfItem[]) {
  const e = check.decision.evidence.shelf;
  if (!e) return null;
  const item = shelf.find((i) => i.id === e.itemId);
  const same = e.matched.map(attributeWord);
  return {
    id: e.itemId,
    brand: e.brand,
    name: e.name,
    label: e.relation === "same-product" ? "same product" : `${relationText(e.relation)}, match ${Math.round(e.score * 100)}%`,
    note: `${(item?.opened ?? e.opened) ? "Opened." : "Unopened."}${same.length ? ` Same ${same.join(", ").replace(/, ([^,]+)$/, " and $1")}.` : ""}`,
  };
}
