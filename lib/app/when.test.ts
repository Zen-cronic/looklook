import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fieldName, studioPayload, TABLES, waitCounts, WAITING_FOR } from "../studio/tables";
import { addDays, formatDay } from "./dates";
import { recordPaid, sourceDetails, type PaidResult } from "./payments";
import { refreshChecks } from "./refresh";
import { sampleWeekState } from "./sample-week";
import { seedState } from "./seed";
import type { PurchaseSource, SavedMethod, SessionState } from "./types";
import { atTheTime, countedDate, restockedLabel, SIMULATED } from "./when";

// Real clock for these tests: 2026-11-07 10:00 AM US Eastern.
const NOW = new Date("2026-11-07T15:00:00Z");
const REAL = "2026-11-07";

const method: SavedMethod = { id: "pm_1", type: "card", vaultId: "v1", label: "Visa ending 1111", capCents: 5000, currency: "USD", consentText: "", consentedAt: "", firstOrderId: "O1", status: "active" };

function paid(cents: number, requestId: string): PaidResult {
  return { outcome: { orderId: `O-${requestId}`, orderStatus: "COMPLETED", captureId: `C-${requestId}`, captureStatus: "COMPLETED", amountCents: cents, currency: "USD" }, requestId, kind: "saved-method", methodLabel: method.label, methodId: method.id };
}

function pay(s: SessionState, source: PurchaseSource, today: string, requestId: string) {
  const details = sourceDetails(s, source);
  return recordPaid(s, source, details, paid(details.amountCents, requestId), today, NOW);
}

describe("dates from the simulated clock", () => {
  it("shows a restock at the real Eastern time it was paid, not the simulated day", () => {
    const s = seedState("whensession01", REAL, NOW);
    s.dayOffset = 6;
    const sim = addDays(REAL, 6);
    const { receipt } = pay(s, { kind: "staple", shelfItemId: "sh-cream", cycle: "x" }, sim, "r1");
    expect(receipt.shelfNote).toMatch(new RegExp(`\\(counted from the ${SIMULATED} ${formatDay(sim)}\\)\\.$`));
    const item = s.shelf.find((i) => i.id === "sh-cream")!;
    expect(item.lastRestockedOn).toBe(sim);
    expect(restockedLabel(s, item, NOW)).toBe("Nov 7, 10:00 AM ET");
    const row = studioPayload(s, sim).tables.shelf.find((r) => r.id === "sh-cream")!;
    expect(row.lastRestocked).toBe("Nov 7, 10:00 AM");
  });

  it("labels a stored restock day with no payment on record when it isn't today", () => {
    const s = seedState("whensession02", REAL, NOW);
    expect(restockedLabel(s, { id: "x", lastRestockedOn: "2026-11-13" }, NOW)).toBe(`Nov 13, 2026 (${SIMULATED})`);
    expect(restockedLabel(s, { id: "x", lastRestockedOn: REAL }, NOW)).toBe("Nov 7, 2026");
    expect(restockedLabel(s, { id: "x" }, NOW)).toBe("");
  });

  it("leaves a restock on the real day unlabelled", () => {
    const s = seedState("whensession03", REAL, NOW);
    const { receipt } = pay(s, { kind: "staple", shelfItemId: "sh-cream", cycle: "x" }, REAL, "r2");
    expect(receipt.shelfNote).not.toContain(SIMULATED);
  });

  it("labels counted dates and date columns only while the simulated date is on", () => {
    expect(countedDate("2026-11-19", 0)).toBe("Nov 19, 2026");
    expect(countedDate("2026-11-19", 6)).toBe(`Nov 19, 2026 (${SIMULATED})`);
    for (const t of TABLES) {
      for (const f of t.fields) {
        expect(fieldName(f, 0)).toBe(f.name);
        expect(fieldName(f, 6).includes(SIMULATED)).toBe(f.kind === "date");
      }
    }
  });

  it("never puts the simulated day into a workspace text cell without the label", () => {
    const s = sampleWeekState("whensession04", REAL, undefined, NOW);
    s.methods.push(method);
    s.dayOffset = 6;
    const sim = addDays(REAL, 6);
    refreshChecks(s, sim);
    pay(s, { kind: "staple", shelfItemId: "sh-cleanser", cycle: "x" }, sim, "r3");
    pay(s, { kind: "check", checkId: "week-peptide" }, sim, "r4");
    const p = studioPayload(s, sim);
    const simWords = [formatDay(sim), "Nov 13"];
    for (const t of TABLES) {
      const textFields = t.fields.filter((f) => f.kind === "text").map((f) => f.id);
      for (const row of p.tables[t.id]) {
        for (const k of textFields) {
          const v = String(row[k] ?? "");
          if (simWords.some((w) => v.includes(w))) expect(v).toContain(SIMULATED);
        }
      }
    }
  });
});

describe("a bought verdict", () => {
  it("reads as what was true when it was decided, under a Bought state", () => {
    const s = seedState("whensession05", REAL, NOW);
    s.checks.push({ ...s.checks[0], id: "bought-1", reason: { text: "The price is $32, within your $75 skincare budget.", source: "model" } });
    const { receipt } = pay(s, { kind: "check", checkId: "bought-1" }, REAL, "r5");
    const row = studioPayload(s, REAL).tables.verdicts.find((r) => r.id === "bought-1")!;
    expect(row.status).toBe("Bought");
    expect(row.reason).toBe("At the time: the price is $32, within your $75 skincare budget.");
    expect(row.boughtAt).toBe("Nov 7, 10:00 AM ET");
    expect(receipt.id).toBe(s.checks.find((c) => c.id === "bought-1")!.purchasedReceiptId);
    const open = studioPayload(s, REAL).tables.verdicts.filter((r) => r.status !== "Bought");
    expect(open.every((r) => r.boughtAt === "" && !String(r.reason).startsWith("At the time"))).toBe(true);
  });

  it("keeps a brand name's capital after 'At the time'", () => {
    expect(atTheTime("CeraVe is cheaper elsewhere.")).toBe("At the time: CeraVe is cheaper elsewhere.");
    expect(atTheTime("You already own one.")).toBe("At the time: you already own one.");
    expect(atTheTime("$72.00 is more than the $2.84 left.")).toBe("At the time: $72.00 is more than the $2.84 left.");
  });
});

describe("sample week", () => {
  const week = () => {
    const s = sampleWeekState("whensession06", REAL, undefined, NOW);
    refreshChecks(s, REAL);
    return s;
  };

  it("gives Group my waits two price waits and two budget waits, with two skips, a buy and a staple due", () => {
    const s = week();
    const p = studioPayload(s, REAL);
    const v = p.tables.verdicts;
    expect(v.filter((r) => r.verdict === "Skip").length).toBe(2);
    expect(v.filter((r) => r.verdict === "Buy").length).toBe(1);
    const price = v.filter((r) => r.waitingFor === WAITING_FOR.price);
    const budget = v.filter((r) => r.waitingFor === WAITING_FOR.budget);
    expect(price.length).toBe(2);
    expect(budget.length).toBe(2);
    expect(price.every((r) => typeof r.buyAt === "number" && (r.buyAt as number) < (r.price as number))).toBe(true);
    expect(budget.every((r) => r.lookAgain === "2026-12-01")).toBe(true);
    expect(waitCounts(v)).toEqual({ total: 4, groups: [{ waitingFor: WAITING_FOR.price, count: 2 }, { waitingFor: WAITING_FOR.budget, count: 2 }] });
    expect(p.tables.rebuys.filter((r) => r.sourceKind === "staple").length).toBeGreaterThanOrEqual(1);
    expect(p.sample).toBe(true);
  });

  it("carries the 90-day trend on both price waits", () => {
    const s = week();
    const waits = s.checks.filter((c) => c.decision.verdict === "wait" && c.decision.rule === "above-usual-price");
    expect(waits.length).toBe(2);
    for (const c of waits) {
      expect(c.band?.usable).toBe(true);
      expect(c.band!.weekly!.length).toBeGreaterThanOrEqual(10);
      expect(c.decision.evidence.price?.target).toBeGreaterThan(0);
    }
  });

  it("marks every entry as a sample, spreads them over the week and shows a skip first", () => {
    const s = week();
    expect(new Set(s.checks.map((c) => c.id)).size).toBe(s.checks.length);
    expect(s.checks.every((c) => c.id.startsWith("week-") && c.input.kind === "screenshot" && c.input.sample?.startsWith("week-"))).toBe(true);
    const times = s.checks.map((c) => Date.parse(c.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(NOW.getTime() - times[0]).toBeGreaterThan(5 * 86_400_000);
    expect(s.checks.at(-1)!.decision.verdict).toBe("skip");
  });

  it("keeps the browser's active saved methods and nothing else from before", () => {
    const before = seedState("whensession07", REAL, NOW);
    before.methods.push(method, { ...method, id: "pm_2", status: "removed" });
    before.dayOffset = 9;
    before.checks.push({ ...before.checks[0], id: "mine" });
    const s = sampleWeekState("whensession07", REAL, before, NOW);
    expect(s.methods.map((m) => m.id)).toEqual(["pm_1"]);
    expect(s.customerId).toBe(before.customerId);
    expect(s.dayOffset).toBe(0);
    expect(s.checks.some((c) => c.id === "mine")).toBe(false);
  });

  it("leaves a fresh session as it was", () => {
    const s = seedState("whensession08", REAL, NOW);
    expect(s.sample).toBeUndefined();
    expect(s.checks.map((c) => c.id)).toEqual(["sample-retinol-brand", "sample-vitc-ulta", "sample-spf-cvs"]);
    expect(studioPayload(s, REAL).sample).toBe(false);
  });
});

describe("/api/demo sample week and reset", () => {
  let POST: (r: Request) => Promise<Response>;
  let GET: () => Promise<Response>;
  beforeAll(async () => {
    process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "looklook-demo-"));
    vi.resetModules();
    const { signSession, sessionSecret } = await import("@/lib/app/session-cookie");
    const signed = await signSession("demosession00001", sessionSecret()!);
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: signed }) }), headers: async () => new Headers() }));
    vi.doMock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => undefined }));
    ({ POST } = await import("@/app/api/demo/route"));
    ({ GET } = await import("@/app/api/state/route"));
  });
  afterAll(() => {
    vi.doUnmock("next/headers");
    vi.doUnmock("next/server");
  });
  const post = (action: string) => POST(new Request("http://x/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }));

  it("loads the sample week, then resets to the fresh sample shelf", async () => {
    const fresh = await (await GET()).json();
    expect(fresh.studio.sample).toBe(false);
    expect(fresh.checks.length).toBe(3);
    expect((await post("sample-week")).status).toBe(200);
    const loaded = await (await GET()).json();
    expect(loaded.studio.sample).toBe(true);
    expect(loaded.checks.length).toBe(7);
    expect(loaded.studio.waits.total).toBe(4);
    expect(loaded.studio.waits.groups.length).toBe(2);
    expect((await post("reset")).status).toBe(200);
    const reset = await (await GET()).json();
    expect(reset.studio.sample).toBe(false);
    expect(reset.checks.length).toBe(3);
  });
});
