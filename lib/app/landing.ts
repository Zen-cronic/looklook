/**
 * The sample data the landing page shows, decided by the same engine as a
 * shopper's own checks: the seeded sunscreen skip, the shelf item it matched,
 * the evidence behind it, and a staple asking for a rebuy. Built from the
 * sample shelf on its seed date, so the landing is the same for everyone and
 * needs no session.
 */
import { brandLine, neutralText, productImage, productName, storeLabel } from "../filming/neutral";
import { relationText, returnsLine } from "./explain";
import { formatDollars } from "./money";
import { defaultCapCents, dueStaples } from "./payments";
import { sampleWeekState } from "./sample-week";
import { SEED_BASE_DATE, seedState } from "./seed";

export const LANDING_SKIP_ID = "sample-spf-cvs";

const ATTRIBUTE_WORDS: Record<string, string> = { spfBand: "SPF range", primaryActive: "main active", shadeFamily: "shade family" };

export function landingSample(film = false) {
  const x = realLandingSample();
  return film ? filmLanding(x) : x;
}

function realLandingSample() {
  const state = seedState("landing", SEED_BASE_DATE, new Date(`${SEED_BASE_DATE}T12:00:00Z`));
  const check = state.checks.find((c) => c.id === LANDING_SKIP_ID);
  if (!check || check.decision.verdict !== "skip" || !check.decision.evidence.shelf) throw new Error("The landing sample must be a skip on a shelf item.");
  const d = check.decision;
  const shelf = d.evidence.shelf!;
  const item = state.shelf.find((i) => i.id === shelf.itemId)!;
  const policy = d.evidence.policy;
  const storeName = policy && !policy.fallback ? policy.retailerName : (check.store ?? "");
  const staple = dueStaples(state, SEED_BASE_DATE)[0];
  if (!staple) throw new Error("The landing sample needs a staple due for a rebuy.");
  const at = new Date(`${SEED_BASE_DATE}T12:00:00Z`);
  const buy = sampleWeekState("landing", SEED_BASE_DATE, undefined, at).checks.find((c) => c.decision.verdict === "buy" && c.facts.priceShown !== null);
  if (!buy) throw new Error("The landing sample needs a buy verdict.");
  const price = check.facts.priceShown!;
  const typical = d.evidence.price?.typical;
  return {
    check,
    verdict: d.verdict,
    reason: check.reason.text,
    brand: check.facts.brand,
    name: check.facts.name,
    imageUrl: check.product?.imageUrl ?? null,
    storeName,
    priceLabel: formatDollars(price),
    shelf: {
      brand: shelf.brand,
      name: shelf.name,
      opened: item.opened,
      relation: relationText(shelf.relation),
      matchPercent: Math.round(shelf.score * 100),
      same: shelf.matched.map((k) => ATTRIBUTE_WORDS[k] ?? k.replace(/([A-Z])/g, " $1").toLowerCase()),
    },
    returns: returnsLine(d, storeName)?.text ?? null,
    priceLine: typical !== undefined ? `${formatDollars(price)} now, usually ${formatDollars(typical)}.` : `${formatDollars(price)} now.`,
    buy: { brand: buy.facts.brand, name: buy.facts.name, priceLabel: formatDollars(buy.facts.priceShown!) },
    buyId: buy.product?.id,
    buyCategory: buy.facts.category,
    stapleId: staple.item.id,
    stapleCategory: staple.item.category,
    staple: {
      brand: staple.item.brand,
      name: staple.item.name,
      daysLeft: staple.daysLeft,
      amountLabel: formatDollars(staple.amountCents / 100),
      capLabel: formatDollars(defaultCapCents(staple.amountCents) / 100),
      store: staple.item.store ?? null,
    },
  };
}

export type LandingSample = ReturnType<typeof realLandingSample>;

/** The same sample with generic product and store names and an unbranded image (filming mode). */
function filmLanding(x: LandingSample): LandingSample {
  const c = x.check;
  const owned = productName({ brand: x.shelf.brand, name: x.shelf.name, id: c.decision.evidence.shelf?.itemId });
  const storeName = storeLabel(x.storeName);
  return {
    ...x,
    reason: neutralText(x.reason),
    brand: brandLine(c.facts.category),
    name: productName({ brand: c.facts.brand, name: c.facts.name, id: c.product?.id, category: c.facts.category }),
    imageUrl: productImage(x.imageUrl, c.facts.category) ?? null,
    storeName,
    shelf: { ...x.shelf, brand: brandLine(c.facts.category), name: owned },
    returns: x.returns ? neutralText(x.returns) : null,
    buy: { ...x.buy, brand: brandLine(x.buyCategory), name: productName({ brand: x.buy.brand, name: x.buy.name, id: x.buyId, category: x.buyCategory }) },
    staple: { ...x.staple, brand: brandLine(x.stapleCategory), name: productName({ brand: x.staple.brand, name: x.staple.name, id: x.stapleId, category: x.stapleCategory }), store: x.staple.store ? storeLabel(x.staple.store) : null },
  };
}
