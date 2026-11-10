import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appToday } from "./dates";
import { HttpError } from "./http";
import { fakePayPal, savedCard } from "./testing";
import type { SessionState } from "./types";

let dir: string;
const previous = { data: process.env.APP_DATA_DIR, neg: process.env.DEMO_NEGATIVE_TESTING };
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "week-data-"));
  process.env.APP_DATA_DIR = dir;
  process.env.DEMO_NEGATIVE_TESTING = "1";
});
afterAll(() => {
  process.env.APP_DATA_DIR = previous.data;
  process.env.DEMO_NEGATIVE_TESTING = previous.neg;
});

const WEEK_POSTS = ["week-spf", "week-vitc", "week-retinol", "week-peptide"];

let n = 0;
/** The sample week loaded in a fresh session, handed over as one week, with a saved card unless told otherwise. */
async function week(setup: (s: SessionState) => void = (s) => s.methods.push({ ...savedCard })) {
  const { loadSampleWeek, updateSession } = await import("./store");
  const { newWeekRun, saveRun } = await import("./week");
  const sid = `weektest${String(++n).padStart(4, "0")}`;
  await loadSampleWeek(sid);
  const runId = await updateSession(sid, (s) => {
    setup(s);
    const run = newWeekRun(s, WEEK_POSTS, "sample-week");
    saveRun(s, run);
    return run.id;
  });
  return { sid, runId };
}

async function slipOf(sid: string, runId: string) {
  const { loadSession } = await import("./store");
  const { buildSlip, findRun } = await import("./week");
  const s = loadSession(sid);
  return buildSlip(s, findRun(s, runId), appToday(s.dayOffset));
}

/** A watch stand-in: records when it was started relative to PayPal calls. */
function watcher(pp: ReturnType<typeof fakePayPal>, log: string[] = []) {
  return {
    log,
    startWatch: async (_sid: string, checkId: string) => {
      log.push(`watch:${checkId}@${pp.requests.length}`);
      return { watchId: `wt_${checkId}`, subscription: { status: "active" } };
    },
  };
}

describe("hand it your week: the slip", () => {
  it("groups the sample week and puts the buy and the due cleanser on one slip", async () => {
    const { sid, runId } = await week();
    const { loadSession } = await import("./store");
    const { findRun } = await import("./week");
    const run = findRun(loadSession(sid), runId);
    expect(run.inputs.map((i) => `${i.checkId}:${i.group}`)).toEqual(["week-spf:skip", "week-vitc:skip", "week-retinol:wait", "week-peptide:buy"]);
    expect(run.inputs.reduce((sum, i) => sum + (i.keptCents ?? 0), 0)).toBe(5898);
    const slip = await slipOf(sid, runId);
    expect(slip.lines.map((l) => [l.why, l.amountCents])).toEqual([
      ["buy", 3200],
      ["due", 1697],
    ]);
    expect(slip.totalCents).toBe(4897);
    expect(slip.watches.map((w) => w.checkId)).toEqual(["week-retinol"]);
    expect(slip.methodLabel).toBe("Visa ending 1111");
    expect((await slipOf(sid, runId)).hash).toBe(slip.hash);
  });

  it("leaves a line off when the card's cap or the month's budget can't cover it", async () => {
    const capped = await week((s) => s.methods.push({ ...savedCard, capCents: 3000 }));
    const slip = await slipOf(capped.sid, capped.runId);
    expect(slip.lines.map((l) => l.why)).toEqual(["due"]);
    expect(slip.leftOff.map((l) => [l.why, l.leftOff])).toEqual([["buy", "over-cap"]]);

    const tight = await week((s) => {
      s.methods.push({ ...savedCard });
      s.budgets.limits.skincare = 40;
      s.budgets.spent = {};
    });
    const slip2 = await slipOf(tight.sid, tight.runId);
    expect(slip2.lines.map((l) => l.amountCents)).toEqual([3200]);
    expect(slip2.leftOff.map((l) => l.leftOff)).toEqual(["over-budget"]);
  });
});

describe("hand it your week: one yes", () => {
  it("pays each line once, as its own PayPal order, after starting the watch", async () => {
    const { sid, runId } = await week();
    const { approveWeek } = await import("./week");
    const pp = fakePayPal();
    const w = watcher(pp);
    const slip = await slipOf(sid, runId);
    const view = await approveWeek(sid, runId, slip.hash, { client: () => pp.client as never, startWatch: w.startWatch });
    expect(w.log).toEqual(["watch:week-retinol@0"]);
    expect(pp.orders.size).toBe(2);
    expect(new Set(pp.requests.map((r) => r.requestId)).size).toBe(2);
    expect(view.sent.map((l) => l.status)).toEqual(["paid", "paid"]);
    expect(view.run.watches).toEqual([{ checkId: "week-retinol", watchId: "wt_week-retinol", status: "armed" }]);
    const { loadSession } = await import("./store");
    const s = loadSession(sid);
    expect(s.receipts.filter((r) => r.status !== "failed")).toHaveLength(2);
  });

  it("never charges a paid line again: the old slip is refused with no PayPal call", async () => {
    const { sid, runId } = await week();
    const { approveWeek } = await import("./week");
    const pp = fakePayPal();
    const w = watcher(pp);
    const slip = await slipOf(sid, runId);
    await approveWeek(sid, runId, slip.hash, { client: () => pp.client as never, startWatch: w.startWatch });
    const before = pp.requests.length;
    await expect(approveWeek(sid, runId, slip.hash, { client: () => pp.client as never, startWatch: w.startWatch })).rejects.toMatchObject({ status: 409, extra: { slipChanged: true } });
    const after = await slipOf(sid, runId);
    expect(after.lines).toHaveLength(0);
    await expect(approveWeek(sid, runId, after.hash, { client: () => pp.client as never, startWatch: w.startWatch })).rejects.toBeInstanceOf(HttpError);
    expect(pp.requests.length).toBe(before);
  });

  it("charges once when the yes is tapped twice at the same moment", async () => {
    const { sid, runId } = await week();
    const { approveWeek } = await import("./week");
    const pp = fakePayPal();
    const w = watcher(pp);
    const slip = await slipOf(sid, runId);
    await Promise.all([1, 2].map(() => approveWeek(sid, runId, slip.hash, { client: () => pp.client as never, startWatch: w.startWatch })));
    expect(pp.orders.size).toBe(2);
    expect(w.log).toHaveLength(1);
  });

  it("keeps paying the other lines when one is declined, and the paid one stays paid on a new yes", async () => {
    const { sid, runId } = await week((s) => {
      s.methods.push({ ...savedCard });
      s.demo.declineNextRebuy = true;
    });
    const { approveWeek } = await import("./week");
    const pp = fakePayPal();
    const w = watcher(pp);
    const slip = await slipOf(sid, runId);
    const view = await approveWeek(sid, runId, slip.hash, { client: () => pp.client as never, startWatch: w.startWatch });
    expect(view.sent.map((l) => [l.why, l.status])).toEqual([
      ["buy", "declined"],
      ["due", "paid"],
    ]);
    expect(pp.orders.size).toBe(1);
    // A new yes offers only the declined line.
    const again = await slipOf(sid, runId);
    expect(again.lines.map((l) => l.why)).toEqual(["buy"]);
    const view2 = await approveWeek(sid, runId, again.hash, { client: () => pp.client as never, startWatch: w.startWatch });
    expect(view2.sent.map((l) => l.status)).toEqual(["paid", "paid"]);
    expect(pp.orders.size).toBe(2);
  });

  it("charges nothing when a price on the slip moved after it was shown", async () => {
    const { sid, runId } = await week();
    const { approveWeek } = await import("./week");
    const { updateSession } = await import("./store");
    const slip = await slipOf(sid, runId);
    await updateSession(sid, (s) => {
      s.shelf.find((i) => i.id === "sh-cleanser")!.price = 18.5;
    });
    const pp = fakePayPal();
    await expect(approveWeek(sid, runId, slip.hash, { client: () => pp.client as never, startWatch: watcher(pp).startWatch })).rejects.toMatchObject({ status: 409, extra: { slipChanged: true } });
    expect(pp.requests).toHaveLength(0);
  });

  it("marks a line whose price moved while the week was being paid, and pays only the others", async () => {
    const { sid, runId } = await week();
    const { approveWeek } = await import("./week");
    const { updateSession } = await import("./store");
    const slip = await slipOf(sid, runId);
    let moved = false;
    const pp = fakePayPal({
      onRequest: async () => {
        if (moved) return;
        moved = true;
        await updateSession(sid, (s) => {
          s.shelf.find((i) => i.id === "sh-cleanser")!.price = 18.5;
        });
      },
    });
    const view = await approveWeek(sid, runId, slip.hash, { client: () => pp.client as never, startWatch: watcher(pp).startWatch });
    expect(view.sent.map((l) => [l.why, l.status])).toEqual([
      ["buy", "paid"],
      ["due", "price-changed"],
    ]);
    expect(pp.orders.size).toBe(1);
  });

  it("asks for a first payment at checkout when there is no saved method", async () => {
    const { sid, runId } = await week(() => {});
    const { approveWeek } = await import("./week");
    const slip = await slipOf(sid, runId);
    expect(slip.methodId).toBeUndefined();
    const pp = fakePayPal();
    await expect(approveWeek(sid, runId, slip.hash, { client: () => pp.client as never, startWatch: watcher(pp).startWatch })).rejects.toMatchObject({ status: 409, extra: { needsCheckout: true } });
    expect(pp.requests).toHaveLength(0);
  });
});
