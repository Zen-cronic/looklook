import { HttpError } from "./http";
import type { PurchaseSource } from "./types";

/** Read a purchase source from a request body. */
export function parseSource(raw: unknown): PurchaseSource {
  const s = raw as Partial<PurchaseSource> & Record<string, unknown>;
  if (s?.kind === "check" && typeof s.checkId === "string") return { kind: "check", checkId: s.checkId };
  if (s?.kind === "watch" && typeof s.watchId === "string") return { kind: "watch", watchId: s.watchId };
  if (s?.kind === "staple" && typeof s.shelfItemId === "string" && typeof s.cycle === "string") return { kind: "staple", shelfItemId: s.shelfItemId, cycle: s.cycle };
  throw new HttpError(400, "Unknown purchase.");
}

