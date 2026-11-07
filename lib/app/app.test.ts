import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signChannel3, verifyChannel3Webhook } from "../channel3/webhooks";
import type { CaptureOutcome } from "../paypal/orders";
import { revokePaymentToken } from "../paypal/vault";
import type { Product } from "../channel3/types";
import { recordSpend, remainingBudgets } from "./budgets";
import { buildCheck, confirmCheck, type CheckServices } from "./checks";
import { addDays, appToday, daysBetween } from "./dates";
import { devCorrections, devSetRuns, runSkipEval } from "./eval";
import { returnsLine } from "./explain";
import {
  chargeKind,
  checkoutOrderBody,
  consentLines,
  consentText,
  dueStaples,
  recordDecline,
  recordPaid,
  repeatsLine,
  REBUY_LEAD_DAYS,
  savedMethodRequestId,
  sourceDetails,
  type PaidResult,
} from "./payments";
import { APP_NAME } from "../brand";
import { offerLines, storeOffers } from "./offers";
import { applyPayPalEvent, eventRefs } from "./paypal-events";
import { refreshChecks } from "./refresh";
import { budgetHoldFor, nextMonthStart, waitAction, watchBudgetHold } from "./reminders";
import { customerIdFor, SEED_BASE_DATE, seedState } from "./seed";
import { singleFlight } from "./single-flight";
import type { CheckRecord, PurchaseIntent, SavedMethod, SessionState } from "./types";
import { applyPriceEvent, newWatch, simulatedDropEvent } from "./watch";

const TODAY = "2026-11-10";

function fresh(): SessionState {
  return seedState("testsession0001", TODAY, new Date("2026-11-10T15:00:00Z"));
}

const method: SavedMethod = {
  id: "pm_1",
  type: "card",
  vaultId: "vault123",
  label: "Visa ending 1111",
  capCents: 5000,
  currency: "USD",
  consentText: "",
  consentedAt: "",
  firstOrderId: "O1",
  status: "active",
};

function paid(orderId: string, amountCents = 1697, requestId = "rebuy:x"): PaidResult {
  const outcome: CaptureOutcome = { orderId, orderStatus: "COMPLETED", captureId: `C-${orderId}`, captureStatus: "COMPLETED", amountCents, currency: "USD" };
  return { outcome, requestId, kind: "saved-method", methodLabel: method.label, methodId: method.id };
}

describe("seed and dates", () => {
  it("moves the sample shelf's run-out dates with the calendar", () => {
    const s = fresh();
    const shift = daysBetween(SEED_BASE_DATE, TODAY);
    const ha = s.shelf.find((i) => i.id === "sh-ha")!;
    expect(ha.runOutDate).toBe(addDays("2026-11-14", shift));
    expect(ha.price).toBe(9.9);
    expect(s.budgets.limits.skincare).toBe(75);
  });

  it("starts a new shopper with the sample checks, a skip first", () => {
    const s = fresh();
    const recent = [...s.checks].reverse();
    expect(recent.map((c) => [c.input.kind === "screenshot" ? c.input.sample : "", c.decision.verdict])).toEqual([
      ["spf-cvs", "skip"],
      ["vitc-ulta", "skip"],
      ["retinol-brand", "wait"],
    ]);
    expect(recent[0].decision.evidence.policy?.retailerId).toBe("cvs");
  });

  it("keeps the PayPal customer id short", () => {
    expect(customerIdFor("a".repeat(64)).length).toBeLessThanOrEqual(22);
  });

  it("adds the simulated offset to the real date", () => {
    const now = new Date("2026-11-10T15:00:00Z");
    expect(appToday(7, now)).toBe("2026-11-17");
  });
});

describe("budgets", () => {
  it("tracks spend per month and group", () => {
    const s = fresh();
    recordSpend(s.budgets, TODAY, "skincare", 20.5);
    expect(remainingBudgets(s.budgets, TODAY).skincare).toBe(54.5);
    expect(remainingBudgets(s.budgets, "2026-12-01").skincare).toBe(75);
  });
});

describe("rebuys", () => {
  it("lists staples within the lead time, soonest first", () => {
    const s = fresh();
    const due = dueStaples(s, addDays(TODAY, 7));
    expect(due.length).toBeGreaterThan(1);
    expect(due.every((d) => d.daysLeft <= REBUY_LEAD_DAYS)).toBe(true);
    expect(due[0].daysLeft).toBeLessThanOrEqual(due[1].daysLeft);
  });

  it("builds one short request id per shopper, item and cycle, and method", () => {
    const a = savedMethodRequestId("sessionaaaaaaaaaaaaaaaaa", "staple:sh-ha:2026-11-14", "78a0603885761893t", false);
    expect(a).toBe(savedMethodRequestId("sessionaaaaaaaaaaaaaaaaa", "staple:sh-ha:2026-11-14", "78a0603885761893t", false));
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).not.toBe(savedMethodRequestId("sessionbbbbbbbbbbbbbbbbb", "staple:sh-ha:2026-11-14", "78a0603885761893t", false));
    expect(a).not.toBe(savedMethodRequestId("sessionaaaaaaaaaaaaaaaaa", "staple:sh-ha:2026-11-14", "othervault", false));
    expect(a).not.toBe(savedMethodRequestId("sessionaaaaaaaaaaaaaaaaa", "staple:sh-ha:2026-11-14", "78a0603885761893t", true));
  });

  it("applies a payment once; a repeat only counts the attempt", () => {
    const s = fresh();
    const source = { kind: "staple" as const, shelfItemId: "sh-cleanser", cycle: s.shelf.find((i) => i.id === "sh-cleanser")!.runOutDate! };
    const details = sourceDetails(s, source);
    const first = recordPaid(s, source, details, paid("O1"), TODAY);
    const runOut = s.shelf.find((i) => i.id === "sh-cleanser")!.runOutDate;
    const spent = remainingBudgets(s.budgets, TODAY).skincare;
    const again = recordPaid(s, source, details, paid("O1"), TODAY);
    expect(again.repeat).toBe(true);
    expect(again.receipt.id).toBe(first.receipt.id);
    expect(again.receipt.attempts).toBe(2);
    expect(again.receipt.sameOrderEveryTime).toBe(true);
    expect(s.receipts).toHaveLength(1);
    expect(s.shelf.find((i) => i.id === "sh-cleanser")!.runOutDate).toBe(runOut);
    expect(remainingBudgets(s.budgets, TODAY).skincare).toBe(spent);
    expect(runOut! > TODAY).toBe(true);
    expect(s.notices.at(-1)!.ids).toContainEqual({ label: "PayPal order", value: "O1" });
    expect(s.notices.at(-1)!.text).not.toContain("O1");
    const different = recordPaid(s, source, details, paid("O2"), TODAY);
    expect(different.receipt.sameOrderEveryTime).toBe(false);
  });

  it("gives a price drop on a staple the same key as its run-out rebuy", () => {
    const s = fresh();
    const staple = s.shelf.find((i) => i.id === "sh-ha")!;
    s.watch.push({ id: "wt_1", product: { id: "P", title: "HA serum", brand: "The Ordinary" }, startPrice: 9.9, targetPrice: 9, currentPrice: 8.9, shelfItemId: "sh-ha", subscription: { status: "active", id: "sub1" }, createdAt: "" });
    expect(sourceDetails(s, { kind: "watch", watchId: "wt_1" }).key).toBe(sourceDetails(s, { kind: "staple", shelfItemId: "sh-ha", cycle: staple.runOutDate! }).key);
  });

  it("records one open decline per item and method", () => {
    const s = fresh();
    s.methods.push({ ...method });
    const source = { kind: "staple" as const, shelfItemId: "sh-ha", cycle: "x" };
    const details = sourceDetails(s, source);
    const a = recordDecline(s, source, details, method, { issue: "INSTRUMENT_DECLINED", simulated: true });
    const b = recordDecline(s, source, details, method, { issue: "INSTRUMENT_DECLINED", simulated: true });
    expect(b.id).toBe(a.id);
    expect(s.declines).toHaveLength(1);
    expect(s.methods[0].declinedAt).toBeDefined();
  });
});

describe("checkout orders", () => {
  const intent: PurchaseIntent = { id: "pi_1", createdAt: "", source: { kind: "check", checkId: "c" }, title: "Serum", brand: "B", category: "serum", amountCents: 3200, currency: "USD" };
  const opts = { customerId: "slcustomer", returnUrl: "https://x/r", cancelUrl: "https://x/c" };

  it("asks PayPal to save the wallet only when the shopper agreed", () => {
    const saved = checkoutOrderBody(intent, { ...opts, funding: "paypal", save: true }, "P1") as { payment_source: { paypal: { attributes?: { vault: { store_in_vault: string; usage_type: string } } } } };
    expect(saved.payment_source.paypal.attributes?.vault.store_in_vault).toBe("ON_SUCCESS");
    expect(saved.payment_source.paypal.attributes?.vault.usage_type).toBe("MERCHANT");
    const once = checkoutOrderBody(intent, { ...opts, funding: "paypal", save: false }) as { payment_source: { paypal: { attributes?: unknown } } };
    expect(once.payment_source.paypal.attributes).toBeUndefined();
  });

  it("saves a card under the shopper's customer id, with 3-D Secure when required", () => {
    const body = checkoutOrderBody(intent, { ...opts, funding: "card", save: true }, "P1") as { purchase_units: Array<{ items: Array<{ sku: string }> }>; payment_source: { card: { attributes: Record<string, { id?: string; method?: string; store_in_vault?: string }> } } };
    expect(body.payment_source.card.attributes.vault.store_in_vault).toBe("ON_SUCCESS");
    expect(body.payment_source.card.attributes.customer.id).toBe("slcustomer");
    expect(body.payment_source.card.attributes.verification.method).toBe("SCA_WHEN_REQUIRED");
    expect(body.purchase_units[0].items[0].sku).toBe("sl:serum:P1");
  });

  it("states the cap in the agreement", () => {
    expect(consentLines(5000).join(" ")).toContain("$50.00");
  });
});

describe("price watch", () => {
  function waitCheck(): CheckRecord {
    return {
      id: "c1",
      createdAt: "",
      decidedOn: TODAY,
      input: { kind: "link", url: "https://x" },
      fields: {} as CheckRecord["fields"],
      candidates: [],
      product: { id: "P9", title: "Retinol Serum", brand: "Ole Henriksen", offerPrice: 72 },
      needsConfirmation: false,
      confirmWhy: [],
      facts: { brand: "Ole Henriksen", name: "Retinol Serum", category: "serum", attributes: {}, priceShown: 72, identityConfidence: 1 },
      band: null,
      decision: { verdict: "wait", rule: "above-usual-price", flags: [], evidence: { trace: [], price: { shown: 72, usable: true, target: 60 } } },
      reason: { text: "", source: "template" },
    };
  }

  it("asks for a yes when a price event reaches the target, once per event", () => {
    const s = fresh();
    const w = newWatch(waitCheck(), { status: "active", id: "sub9" });
    expect(w.targetPrice).toBe(60);
    s.watch.push(w);
    const high = simulatedDropEvent(w, 65);
    expect(applyPriceEvent(s, high)[0]).toContain("still above");
    expect(w.droppedAt).toBeUndefined();
    const low = simulatedDropEvent(w, 59);
    expect(applyPriceEvent(s, low)[0]).toContain("Asking for a yes");
    expect(applyPriceEvent(s, low)).toHaveLength(0);
    expect(w.droppedAt).toBeDefined();
    expect(applyPriceEvent(s, { ...low, id: "other", data: { ...low.data, subscription_id: "nope", subject: { product_id: "nope" } } })).toHaveLength(0);
  });
});

describe("Channel3 webhook signatures", () => {
  const secret = `whsec_${Buffer.from("test-secret-0123456789").toString("base64")}`;
  const body = JSON.stringify({ id: "evt_1", type: "offer.price.changed", data: { subscription_id: "s" } });
  const now = 1_800_000_000;
  const headers = (sig: string, ts = now, id = "msg_1") => new Headers({ "svix-id": id, "svix-timestamp": String(ts), "svix-signature": sig });

  it("accepts a valid signature among several", () => {
    const sig = signChannel3(secret, "msg_1", now, body);
    const r = verifyChannel3Webhook(headers(`v1,bogus v1,${sig}`), body, secret, now);
    expect(r.verified).toBe(true);
  });

  it("rejects a changed body, an old timestamp and missing headers", () => {
    const sig = signChannel3(secret, "msg_1", now, body);
    expect(verifyChannel3Webhook(headers(`v1,${sig}`), body.replace("evt_1", "evt_2"), secret, now)).toMatchObject({ verified: false, reason: "bad-signature" });
    expect(verifyChannel3Webhook(headers(`v1,${sig}`), body, secret, now + 600)).toMatchObject({ verified: false, reason: "stale-timestamp" });
    expect(verifyChannel3Webhook(new Headers(), body, secret, now)).toMatchObject({ verified: false, reason: "missing-headers" });
  });
});

describe("PayPal events", () => {
  it("routes a capture event to the receipt and records the confirmation", () => {
    const s = fresh();
    const source = { kind: "staple" as const, shelfItemId: "sh-ha", cycle: "x" };
    const { receipt } = recordPaid(s, source, sourceDetails(s, source), paid("O7"), TODAY);
    const e = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "C-O7", status: "COMPLETED", supplementary_data: { related_ids: { order_id: "O7" } } } };
    expect(eventRefs(e)).toEqual(expect.arrayContaining([{ kind: "capture", id: "C-O7" }, { kind: "order", id: "O7" }]));
    expect(applyPayPalEvent(s, e)).toContain("confirmed");
    expect(receipt.webhook?.eventId).toBe("WH-1");
  });

  it("marks a saved method removed when PayPal says the token was deleted", () => {
    const s = fresh();
    s.methods.push({ ...method });
    applyPayPalEvent(s, { id: "WH-2", event_type: "VAULT.PAYMENT-TOKEN.DELETED", resource: { id: "vault123" } });
    expect(s.methods[0].status).toBe("removed");
  });
});

describe("single flight", () => {
  it("runs overlapping calls with the same key once", async () => {
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "order-1";
    });
    const [a, b] = await Promise.all([singleFlight("k", fn), singleFlight("k", fn)]);
    expect(a).toBe("order-1");
    expect(b).toBe("order-1");
    expect(fn).toHaveBeenCalledTimes(1);
    await singleFlight("k", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("revoking a saved method", () => {
  it("deletes again when the token comes back, and confirms only after two empty checks", async () => {
    const answers = [200, 404, 404];
    const calls: string[] = [];
    const client = {
      request: vi.fn(async (req: { method: string }) => {
        calls.push(req.method);
        if (req.method === "DELETE") return { status: 204, body: undefined };
        const status = answers.shift() ?? 404;
        if (status === 404) throw Object.assign(new Error("not found"), { status: 404 });
        return { status, body: { id: "tok" } };
      }),
    };
    const r = await revokePaymentToken(client as never, "tok", { sleep: async () => {} });
    expect(r).toEqual({ confirmed: true, deletes: 2, checks: 3 });
    expect(calls.filter((c) => c === "DELETE")).toHaveLength(2);
  });
});

describe("return-policy line", () => {
  const decision = (returnableOpened: "yes" | "no" | "unknown", verdict: "buy" | "skip" = "buy") =>
    ({ verdict, rule: "clear-to-buy", flags: [], evidence: { trace: [], policy: { retailerId: "ulta", retailerName: "Ulta Beauty", group: "beauty", returnableOpened, windowDays: 30, sourceUrl: "u", checkedOn: "2026-11-06", fallback: false } } }) as never;

  it("reassures where opened beauty can go back, and warns where it may not", () => {
    expect(returnsLine(decision("yes"))).toEqual({ tone: "ok", text: "Ulta Beauty takes opened beauty back within 30 days, so trying it is low risk." });
    expect(returnsLine(decision("yes", "skip"))?.text).not.toContain("low risk");
    expect(returnsLine(decision("no"))?.text).toContain("may refuse");
  });
});

describe("skip number", () => {
  it("recomputes 58 of 65 from the committed test set, with both baselines and the split", () => {
    const r = runSkipEval();
    expect(r.skipCorrect).toBe(58);
    expect(r.n).toBe(65);
    expect(r.wrongSkips).toHaveLength(1);
    expect(r.missedSkips).toHaveLength(6);
    expect(r.missedSkips.map((c) => c.id)).toEqual(expect.arrayContaining(["c06", "c26"]));
    expect(r.baselines.map((b) => [b.id, b.skipCorrect])).toEqual([
      ["always-skip", 39],
      ["same-category", 40],
    ]);
    expect(r.split.onEvidence + r.split.onDefault).toBe(r.skipsRight);
    expect(r.split.dollarsAvoided).toBeCloseTo(r.split.dollarsOnEvidence + r.split.dollarsOnDefault, 2);
    expect(r.provenance.expectations.at < r.provenance.engine.at).toBe(true);
  });

  it("records the store-policy correction: policy first, then expectations, then the re-run", () => {
    const [c] = devCorrections();
    expect(c.before).toBe("60 of 65");
    expect(c.after).toBe(`${runSkipEval().skipCorrect} of 65`);
    expect(c.policy.at < c.expectations.at).toBe(true);
    expect(c.expectations.cases).toEqual(["c02", "c06", "c24", "c26", "c61"]);
    const run = runSkipEval().provenance.changes.find((x) => x.commit === c.expectations.commit);
    expect(run?.result).toBe(c.after);
    expect(devSetRuns().find((x) => x.commit === c.expectations.commit)?.label).toMatch(/correction/);
  });
});

describe("check pipeline", () => {
  const serum: Product = {
    id: "YjIg3Ci",
    title: "Skin Renewing Vitamin C Serum",
    brands: [{ id: "b", name: "CeraVe" }],
    category: { slug: "face-serums" },
    offers: [{ domain: "ulta.com", url: "https://buy.example/x", price: { price: 28.99, currency: "USD" } }],
  };
  const services: CheckServices = {
    anthropic: { messages: { create: vi.fn() } } as never,
    search: vi.fn(),
    lookup: vi.fn(),
    priceBand: vi.fn(async () => ({ typical: 28.99, low: 21.74, high: 28.99, latest: 28.99, days: 90, usable: true, asOf: TODAY })),
  };
  const fields = {
    isProduct: true,
    brand: "CeraVe",
    productName: "Skin Renewing Vitamin C Serum",
    variant: null,
    size: null,
    price: { amount: 28.99, currency: "USD" },
    source: "creator-post" as const,
    store: "Ulta",
    category: "serum" as const,
    attributes: { primaryActive: "vitamin-c", actives: ["vitamin-c"], texture: "", filter: "" as const, area: "" as const, spfBand: "" as const, finish: "", form: "", use: "" as const, coverage: "" as const, shadeFamily: "", tint: "" as const, effect: "", formula: "", purpose: "", style: "" as const, noiseCancelling: "" as const, type: "" },
    legibility: 1,
  };

  it("skips a near-duplicate of a shelf item and cites the store policy", async () => {
    const s = fresh();
    const check = await buildCheck({ fields, products: [serum] }, { kind: "screenshot", imageHash: "h" }, { shelf: s.shelf, budgets: s.budgets, today: TODAY }, services);
    expect(check.decision.verdict).toBe("skip");
    expect(check.decision.evidence.shelf?.itemId).toBe("sh-vitc");
    expect(check.decision.evidence.policy?.retailerId).toBe("ulta");
    expect(check.product?.offerUrl).toBe("https://buy.example/x");
  });

  it("asks first when the match is weak, then decides once confirmed", async () => {
    const s = fresh();
    const blurry = { ...fields, legibility: 0.3 };
    const check = await buildCheck({ fields: blurry, products: [serum] }, { kind: "screenshot", imageHash: "h" }, { shelf: s.shelf, budgets: s.budgets, today: TODAY }, services);
    expect(check.decision.verdict).toBe("ask");
    expect(check.needsConfirmation).toBe(true);
    const confirmed = await confirmCheck(check, check.candidates[0].product, { shelf: s.shelf, budgets: s.budgets, today: TODAY }, services);
    expect(confirmed.facts.identityConfirmed).toBe(true);
    expect(confirmed.decision.verdict).toBe("skip");
  });
});

describe("store on disk", () => {
  let dir: string;
  const previous = process.env.APP_DATA_DIR;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "app-data-"));
    process.env.APP_DATA_DIR = dir;
  });
  afterAll(() => {
    process.env.APP_DATA_DIR = previous;
  });

  it("persists session updates and handles a repeated webhook event once", async () => {
    const store = await import("./store");
    await store.updateSession("sessiontest01", (s) => {
      s.dayOffset = 3;
    });
    expect(store.loadSession("sessiontest01").dayOffset).toBe(3);
    const [a, b] = await Promise.all([
      store.appendEvent({ source: "channel3", simulated: false, eventId: "evt_9", type: "offer.price.changed", verification: "verified" }),
      store.appendEvent({ source: "channel3", simulated: false, eventId: "evt_9", type: "offer.price.changed", verification: "verified" }),
    ]);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    await store.indexAdd("order", "O1", "sessiontest01");
    expect(store.indexLookup("order", "O1")).toEqual(["sessiontest01"]);
  });
});

describe("one budget and one clock across screens", () => {
  it("decides open checks again when the budget or the date changes", () => {
    const s = fresh();
    const retinol = s.checks.find((c) => c.id === "sample-retinol-brand")!;
    expect(retinol.decision.rule).toBe("above-usual-price");
    // Spend most of the skincare budget: the same check now waits for the budget, with the live figure.
    recordSpend(s.budgets, TODAY, "skincare", 60);
    expect(refreshChecks(s, TODAY)).toBeGreaterThan(0);
    expect(retinol.decision.rule).toBe("over-budget");
    expect(retinol.decision.evidence.budget?.remaining).toBe(remainingBudgets(s.budgets, TODAY).skincare);
    expect(retinol.reason.text).toContain("$15.00 left");
    // Unchanged state: nothing to redo.
    expect(refreshChecks(s, TODAY)).toBe(0);
  });

  it("keeps a bought check's verdict", () => {
    const s = fresh();
    const c = s.checks[0];
    c.purchasedReceiptId = "rc_x";
    const before = JSON.stringify(c.decision);
    recordSpend(s.budgets, TODAY, "skincare", 75);
    refreshChecks(s, TODAY);
    expect(JSON.stringify(c.decision)).toBe(before);
  });
});

describe("what a wait offers", () => {
  it("follows the rule that fired", () => {
    const s = fresh();
    const retinol = s.checks.find((c) => c.id === "sample-retinol-brand")!;
    expect(waitAction(retinol, TODAY)).toEqual({ kind: "price" });
    recordSpend(s.budgets, TODAY, "skincare", 60);
    refreshChecks(s, TODAY);
    expect(waitAction(retinol, TODAY)).toEqual({ kind: "budget", on: nextMonthStart(TODAY) });
    expect(nextMonthStart("2026-12-14")).toBe("2027-01-01");
    expect(nextMonthStart("2026-11-30")).toBe("2026-12-01");
  });

  it("holds a price drop that is still over budget, and says why", () => {
    const s = fresh();
    const retinol = s.checks.find((c) => c.id === "sample-retinol-brand")!;
    const w = newWatch(retinol, { status: "unavailable", reason: "test" });
    w.currentPrice = 50;
    w.droppedAt = new Date().toISOString();
    s.watch.push(w);
    expect(watchBudgetHold(s, w, TODAY)).toBeUndefined();
    recordSpend(s.budgets, TODAY, "skincare", 60);
    expect(watchBudgetHold(s, w, TODAY)).toMatchObject({ group: "skincare", remaining: 15, price: 50 });
    expect(budgetHoldFor(s, { kind: "watch", watchId: w.id })).toContain("$15.00 left");
  });
});

describe("receipt wording", () => {
  const base = { requestId: "r", sameOrderEveryTime: true };
  it("says what happened to repeats, in the app and at PayPal", () => {
    expect(repeatsLine({ ...base, attempts: 1 })).toBe("Sent to PayPal once.");
    const merged = repeatsLine({ ...base, attempts: 3, mergedInApp: 1, resentToPayPal: 1 });
    expect(merged).toContain("merged here and never reached PayPal");
    expect(merged).toContain("same PayPal-Request-Id, and PayPal returned this same order");
    expect(merged).not.toMatch(/every time/);
    expect(repeatsLine({ ...base, attempts: 2, sameOrderEveryTime: false })).toContain("different PayPal order");
  });

  it("never calls a first purchase a rebuy", () => {
    expect(chargeKind({ kind: "first-purchase", source: { kind: "check", checkId: "c" }, savedMethodId: "pm" })).toBe("First purchase, method saved for rebuys");
    expect(chargeKind({ kind: "saved-method", source: { kind: "staple", shelfItemId: "s", cycle: "x" } })).toBe("Rebuy");
  });
});

describe("offers at other stores", () => {
  it("keeps the cheapest USD offer per store and joins each with its opened-return policy", () => {
    const offers = storeOffers({
      offers: [
        { domain: "ulta.com", url: "https://u", price: { price: 28.8, currency: "USD" } },
        { domain: "www.sephora.com", url: "https://s", price: { price: 32, currency: "USD" } },
        { domain: "cvs.com", url: "https://c", price: { price: 27, currency: "USD" } },
        { domain: "cvs.com", url: "https://c2", price: { price: 29, currency: "USD" } },
        { domain: "boots.com", url: "https://b", price: { price: 20, currency: "GBP" } },
      ],
    });
    expect(offers.map((o) => [o.domain, o.price])).toEqual([
      ["cvs.com", 27],
      ["ulta.com", 28.8],
      ["sephora.com", 32],
    ]);
    const lines = offerLines(offers, "serum");
    expect(lines.map((l) => [l.store, l.returns])).toEqual([
      ["CVS Pharmacy", "yes"],
      ["Ulta Beauty", "yes"],
      ["Sephora", "yes"],
    ]);
    expect(lines[0].returnsText).toBe("takes opened back within 60 days");
    expect(lines[2].returnsText).toMatch(/^takes opened back within \d+ days$/);
  });
});

describe("product name", () => {
  it("names the product in the saved-method agreement, and nowhere uses an earlier name", () => {
    expect(consentText(2500)).toContain(`so ${APP_NAME} can rebuy`);
    const earlier = new RegExp(["sec", "ond"].join("") + "[\\s_-]?look", "i");
    const files = execSync("git ls-files", { cwd: process.cwd() }).toString().trim().split("\n").filter((f) => /\.(ts|tsx|md|json|css|yaml)$/.test(f) && !f.endsWith("package-lock.json"));
    const hits = files.filter((f) => earlier.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
