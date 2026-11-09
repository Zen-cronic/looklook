import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import skipResults from "@/eval/skip-set/results.json";
import skipCases from "@/eval/skip-set/cases.json";
import { recordSpend } from "../app/budgets";
import { DEV_SET_SIZE, devCorrections, devSetRuns, runSkipEval } from "../app/eval";
import { RULE_ORDER, RULE_TEXT, returnsLine } from "../app/explain";
import { offerLines } from "../app/offers";
import { baselineScore, heldOutHeadline, heldOutResult } from "../app/holdout";
import { formatDollars } from "../app/money";
import { CONSENT_TEMPLATE, dueStaples, REBUY_LEAD_DAYS, SELLER_OF_RECORD } from "../app/payments";
import { LANDING_SKIP_ID, landingSample } from "../app/landing";
import { refreshChecks } from "../app/refresh";
import { sampleWeekState } from "../app/sample-week";
import { SAMPLES } from "../app/samples";
import { numberWord, startHereSteps } from "../app/start-here";
import { APP_NAME } from "../brand";
import { MAX_REQUEST_ID_LENGTH, PayPalClient, refundCapture } from "../paypal";
import { openedReturnPolicy, policyTable } from "../policies";
import { STUDIO_MODEL } from "../studio/llm";
import { decide, type ProductFacts, type VerdictInput } from "../verdict";
import type { Decision } from "../verdict/types";
import { READER_MODEL } from "../vision/read";

/**
 * Every number the README states, recomputed from the committed data and
 * code, and the claims ledger (FACTS.md) checked against the tests it names.
 * Offline and fast: no network, no model.
 */

const read = (path: string) => readFileSync(path, "utf8");
const README = read("README.md").replace(/\*\*/g, "");
const FACTS = read("FACTS.md");

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "2026-11-06 22:28 EST" from an ISO time with its offset. */
function easternStamp(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

/** The README section under a "## " heading. */
function section(md: string, heading: string): string {
  const start = md.indexOf(`## ${heading}\n`);
  if (start < 0) throw new Error(`README has no "${heading}" section`);
  const next = md.indexOf("\n## ", start + 4);
  return md.slice(start, next < 0 ? undefined : next);
}

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : filesUnder(path, ext);
    return path.endsWith(ext) ? [path] : [];
  });
}

describe("README numbers match the data and code", () => {
  const held = heldOutResult();

  it("states the held-out headline and its baselines from the scored run", () => {
    expect(README).toContain(heldOutHeadline(held));
    expect([held.skipCorrect, held.n, baselineScore(held, "always-skip"), baselineScore(held, "same-category")]).toEqual([28, 30, 13, 19]);
    // The landing page, /proof and /judge read the same function; none types a score in by hand.
    for (const page of ["app/page.tsx", "app/proof/page.tsx", "app/judge/page.tsx"]) {
      const src = read(page);
      expect(src).toContain("heldOutHeadline(");
      expect(src).not.toMatch(/>[^<{]*\b\d+ of \d+\b[^<]*</);
    }
  });

  it("states held-out precision, recall and the evidence split as computed", () => {
    expect(README).toContain(`Skip precision ${pct(held.precision)} (${held.skipsRight} of ${held.skipsMade} skips right), recall ${pct(held.recall)} (${held.skipsRight} of ${held.skipsExpected} caught).`);
    expect(README).toContain(`Of the ${held.skipsRight} right skips, ${held.split.onEvidence} rest on evidence (the shelf, or a cited store policy) and ${held.split.onDefault} on our default`);
    expect(held.split.onEvidence + held.split.onDefault).toBe(held.skipsRight);
  });

  it("states the order of work with the commits and Eastern times in history.json", () => {
    const o = held.order;
    expect(README).toContain(`the engine last changed in \`${o.engine.commit.slice(0, 7)}\` (${easternStamp(o.engine.at)})`);
    expect(README).toContain(`the ${held.n} expected answers were committed in \`${o.expectations.commit.slice(0, 7)}\` (${easternStamp(o.expectations.at)})`);
    expect(README).toContain(`committed as generated in \`${o.scoredRun.commit.slice(0, 7)}\` (${easternStamp(o.scoredRun.at)})`);
  });

  it("states the held-out re-run after the later matching change", () => {
    const after = held.afterChanges[0];
    expect(after.commit).toBe(skipProvenanceChange("c0d3b0d").commit);
    expect(README).toContain(
      `the held-out set scores ${after.skipCorrect} of ${after.n} (same category ${baselineScore(after, "same-category")}, now that the shopper's lip balm and hair oil stay on her shelf; saying skip to everything ${baselineScore(after, "always-skip")})`,
    );
    expect(README).toContain(`(commit \`${after.commit.slice(0, 7)}\`, ${easternStamp(after.at)})`);
    expect(README).toContain(`the headline stays ${held.skipCorrect} of ${held.n}`);
  });

  it("states the development set's score and baselines as re-run now, and its committed results agree", () => {
    const r = runSkipEval();
    expect(DEV_SET_SIZE).toBe(r.n);
    expect(README).toContain(`${r.skipCorrect} of ${r.n} there (same category gets ${baselineScore(r, "same-category")}; saying skip to everything gets ${baselineScore(r, "always-skip")})`);
    expect(README).toContain(`then re-runs the ${r.n}-product development set`);
    expect(README).toContain(`The ${r.n} products the matching was developed on`);
    // The committed results file and its RESULTS.md are the same run as the code gives now.
    expect(skipResults.headline).toEqual({ skipCorrect: r.skipCorrect, n: r.n, precision: r.precision, recall: r.recall });
    expect(skipResults.split).toEqual(r.split);
    expect(read("eval/skip-set/RESULTS.md")).toContain(`**${r.skipCorrect} of ${r.n} skip decisions correct.**`);
  });

  it("states the development set's history: first run, matching change, store-policy correction", () => {
    const runs = devSetRuns();
    const [first, similarity] = runs;
    expect(skipProvenanceFirstRun()).toContain(first.result);
    // Store-policy fixes are labelled as such, never as a matching change.
    expect(runs.filter((x) => x.label.startsWith("After a matching change")).map((x) => x.commit.slice(0, 7))).toEqual(["1fb8457", "c0d3b0d"]);
    expect(runs.find((x) => x.commit.startsWith("250e1c4"))?.label).toMatch(/^After a store-policy fix: /);
    expect(README).toContain(`Its first scored run was ${first.result} and one similarity change later ${similarity.result}`);
    expect(README).toContain(`The first scored run was ${first.result}.`);
    expect(README).toContain(`The development set stayed at ${skipProvenanceChange("c0d3b0d").result} through that change`);
    const [c] = devCorrections();
    expect(c.after).toBe(`${runSkipEval().skipCorrect} of ${DEV_SET_SIZE}`);
    expect(README).toContain(`The development set went from ${c.before.split(" of ")[0]} to ${c.after}`);
    expect(README).toContain(`(commit \`${c.policy.commit.slice(0, 7)}\`, ${easternStamp(c.policy.at)})`);
    expect(README).toContain(`(\`${c.expectations.commit.slice(0, 7)}\`, ${easternStamp(c.expectations.at).slice(11)})`);
  });

  it("states how many development cases rest on the unknown-policy default", () => {
    const r = runSkipEval();
    const cases = (skipCases as unknown as { cases: Array<{ store: string; category: Parameters<typeof openedReturnPolicy>[1] }> }).cases;
    const outside = cases.filter((c) => openedReturnPolicy(c.store, c.category).fallback).length;
    expect(README).toContain(`${outside} of the ${r.n} cases are at stores outside the policy table, where an unknown policy counts as not returnable; ${r.split.onDefault} of the ${r.skipsRight} right skips depend on that default.`);
    expect(README).toContain(`On the development set ${numberWord(r.n - r.skipCorrect)} of ${r.n} skip decisions disagree`);
  });

  it("counts twelve ordered verdict rules, the same list the engine documents", () => {
    expect(README).toContain(`${cap(numberWord(RULE_ORDER.length))} ordered rules then decide from structured fields only`);
    expect(Object.keys(RULE_TEXT).sort()).toEqual([...RULE_ORDER].sort());
    const documented = [...read("lib/verdict/engine.ts").matchAll(/^\s*\*\s+\d+\.\s+([a-z-]+)\s/gm)].map((m) => m[1]);
    expect(documented).toEqual(RULE_ORDER);
  });

  it("states the coded limits: rebuy lead time, sample posts, request-id length, model", () => {
    expect(README).toContain(`Staples due within ${numberWord(REBUY_LEAD_DAYS)} days ask for your yes`);
    expect(README).toContain(`${cap(numberWord(SAMPLES.length))} sample posts (mock posts of real products)`);
    expect(README).toContain(`longer ids are hashed to at most ${MAX_REQUEST_ID_LENGTH}`);
    expect(STUDIO_MODEL).toBe(READER_MODEL);
    expect(README).toContain(`Claude (\`${READER_MODEL}\`)`);
  });

  it("names the sandbox test store as the seller, as the app does", () => {
    expect(SELLER_OF_RECORD).toBe(`${APP_NAME} Test Store (PayPal sandbox)`);
    expect(README).toContain(`sold by "${SELLER_OF_RECORD}"`);
  });

  it("summarises the policy table's opened-beauty answers as the README does", () => {
    const beauty = (store: string) => openedReturnPolicy(store, "serum");
    for (const store of ["sephora", "ulta", "target", "kohls", "cvs"]) expect(beauty(store).returnableOpened).toBe("yes");
    expect(beauty("walgreens").returnableOpened).toBe("conditional");
    expect(README).toContain("(Sephora, Ulta, Target, Kohl's and CVS do; Walgreens leaves it to the manager)");
    const asShown = (store: string, verdict: Decision["verdict"]) => {
      const p = beauty(store);
      const d = { verdict, rule: "owns-similar", flags: [], evidence: { trace: [], policy: p } } as unknown as Decision;
      return returnsLine(d)?.text.replace(/\.$/, "");
    };
    expect(README).toContain(`"${asShown("ulta", "buy")}"`);
    expect(README).toContain(`"${asShown("cvs", "skip")}"`);
    const sephora = policyTable().retailers.find((r) => r.id === "sephora")!;
    const rule = sephora.rules.find((x) => x.group === "beauty")!;
    expect(rule.conditions).toContain('"new or gently used"');
    expect(rule.sourceUrl).toBe(sephora.policyUrl);
    expect(README).toContain(`(opened beauty back in "new or gently used" condition within ${rule.windowDays} days) is read from Sephora's returns page`);
    // No store note claims a page could not be read any more.
    for (const r of policyTable().retailers) expect(r.notes ?? "").not.toMatch(/blocked/);
  });
});

function skipProvenance() {
  return JSON.parse(read("eval/skip-set/provenance.json")) as { firstRun: { what: string }; changes: Array<{ commit: string; result: string }> };
}
function skipProvenanceFirstRun(): string {
  return skipProvenance().firstRun.what;
}
function skipProvenanceChange(prefix: string) {
  const c = skipProvenance().changes.find((x) => x.commit.startsWith(prefix));
  if (!c) throw new Error(`no recorded change ${prefix}`);
  return c;
}

describe("evidence and safety", () => {
  it("never shows a return window a store's page doesn't state", () => {
    const noWindow = policyTable().retailers.flatMap((r) => r.rules.filter((x) => x.windowDays === null && x.sourceUrl).map((x) => ({ r, x })));
    expect(noWindow.map(({ r, x }) => `${r.id}/${x.group}`)).toContain("cvs/beauty");
    for (const { r, x } of noWindow) {
      const p = openedReturnPolicy(r.domains[0], x.group === "beauty" ? "serum" : x.group === "electronics" ? "headphones" : "blender");
      for (const verdict of ["buy", "skip"] as const) {
        const line = returnsLine({ verdict, rule: "owns-similar", flags: [], evidence: { trace: [], policy: p } } as unknown as Decision)?.text ?? "";
        expect(line).not.toMatch(/\d+ days/);
      }
      const offer = offerLines([{ domain: r.domains[0], price: 10 }], x.group === "beauty" ? "serum" : x.group === "electronics" ? "headphones" : "blender")[0];
      expect(offer.returnsText).not.toMatch(/\d+ days/);
    }
    expect(README).not.toMatch(/CVS[^.]*beauty[^.]*within 60 days/);
  });

  it("gives every store return rule a source page and a check date, as FACTS.md lists them", () => {
    const table = policyTable();
    const storeRules = table.retailers.filter((r) => !r.rules.every((x) => x.returnableOpened === "unknown" && x.sourceUrl === null)).flatMap((r) => r.rules);
    for (const rule of storeRules) {
      expect(rule.sourceUrl).toMatch(/^https:\/\//);
      expect(rule.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rule.checkedOn <= table.checkedOn).toBe(true);
    }
    // The only rule without a source is the fallback for stores outside the table, and it is unknown.
    const sourceless = table.retailers.flatMap((r) => r.rules).filter((x) => x.sourceUrl === null);
    expect(sourceless.every((x) => x.returnableOpened === "unknown")).toBe(true);
    // FACTS.md lists each store rule once, word for word, with the same source and date.
    const policyRows = factRows().filter((row) => row.where.includes("`data/return-policies.json`"));
    expect(policyRows).toHaveLength(storeRules.length);
    for (const rule of storeRules) {
      const row = policyRows.find((x) => x.claim === rule.conditions);
      expect(row, rule.conditions).toBeDefined();
      expect(row!.checkedBy).toContain(`external: ${rule.sourceUrl} (checked ${rule.checkedOn})`);
    }
    expect(badges().get("store return rules")).toBe(`${storeRules.length} cited and dated`);
  });

  it("never answers buy when the product, its price or its price history is unresolved", () => {
    const today = "2026-11-07";
    const product: ProductFacts = { brand: "Brand", name: "Serum", category: "serum", attributes: { primaryActive: "retinol" }, priceShown: 20, identityConfidence: 0.95 };
    const band = { typical: 20, low: 20, high: 20, latest: 20, days: 90, usable: true, asOf: today };
    const base: VerdictInput = { product, store: "ulta", shelf: [], budgets: { skincare: 75 }, priceBand: band, today };
    expect(decide(base).verdict).toBe("buy");
    const unresolved: Array<[string, (i: VerdictInput) => VerdictInput]> = [
      ["no category", (i) => ({ ...i, product: { ...i.product, category: undefined } })],
      ["low confidence", (i) => ({ ...i, product: { ...i.product, identityConfidence: 0.5 } })],
      ["confidence not a number", (i) => ({ ...i, product: { ...i.product, identityConfidence: Number.NaN } })],
      ["no price", (i) => ({ ...i, product: { ...i.product, priceShown: null } })],
      ["zero price", (i) => ({ ...i, product: { ...i.product, priceShown: 0 } })],
      ["price not a number", (i) => ({ ...i, product: { ...i.product, priceShown: Number.NaN } })],
      ["no price history", (i) => ({ ...i, priceBand: null })],
      ["unusable price history", (i) => ({ ...i, priceBand: { ...band, usable: false } })],
      ["budget not a number", (i) => ({ ...i, budgets: { skincare: Number.NaN } })],
    ];
    const stores = ["ulta", "cvs", "walgreens", "somewhere-unknown.example", undefined];
    for (const [name, change] of unresolved) {
      for (const store of stores) {
        const d = decide(change({ ...base, store }));
        expect(d.verdict, `${name} at ${store}`).not.toBe("buy");
        expect(["ask", "wait"]).toContain(d.verdict);
      }
      // Two unknowns at once are still never a buy.
      for (const [, other] of unresolved) expect(decide(other(change(base))).verdict, name).not.toBe("buy");
    }
  });

  it("decides in code: the engine imports no model client", () => {
    for (const file of ["lib/verdict/engine.ts", "lib/verdict/types.ts"]) {
      const imports = [...read(file).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const from of imports) expect(from, file).toMatch(/^(\.\.\/policies|\.\.\/shelf\/[a-z-]+|\.\.\/channel3\/band|\.\/types)$/);
    }
  });

  it("shows the commission notice wherever a retailer link is rendered", () => {
    const notice = "We may earn a commission when you buy through them.";
    const ours = /^(`\/|"\/)|sourceUrl|policyUrl|receiptHref/;
    let retailerLinks = 0;
    for (const file of filesUnder("app", ".tsx")) {
      const lines = read(file).split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/<a\s[^>]*href=\{([^}]+)\}[^>]*>/g)) {
          if (ours.test(m[1].trim())) continue;
          retailerLinks += 1;
          expect(m[0], `${file}:${i + 1}`).toMatch(/rel="[^"]*\bsponsored\b/);
          expect(lines.slice(i, i + 40).join("\n"), `${file}:${i + 1}`).toContain(notice);
        }
      });
    }
    expect(retailerLinks).toBeGreaterThan(0);
    expect(README).toContain("the store names on a verdict are links to the retailers, and we may earn a commission when you buy through them");
  });

  it("refunds the rest of a capture when no amount is given, under its own request id", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 32400 }), { status: 200 });
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ id: "R1", status: "COMPLETED", amount: { currency_code: "USD", value: "32.00" } }), { status: 201 });
    });
    const client = new PayPalClient({ credentials: { clientId: "id", clientSecret: "secret" }, fetch });
    const refund = await refundCapture(client, "C1", { requestId: "refund:c1" });
    expect(refund).toEqual({ refundId: "R1", status: "COMPLETED", amountCents: 3200 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/v2\/payments\/captures\/C1\/refund$/);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({});
    expect((calls[0].init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("refund:c1");
    expect(README).toContain("A charge can be refunded in full from its receipt.");
  });
});

describe("landing page", () => {
  it("keeps the landing page's promises to the ledger and its numbers computed", () => {
    const page = read("app/page.tsx");
    const claims = factRows().filter((r) => r.quoted && r.where.includes("`app/page.tsx`"));
    expect(claims.map((r) => r.id)).toEqual(["F54", "F55", "F56", "F57"]);
    // The first promise is the save agreement's own line, word for word.
    expect(CONSENT_TEMPLATE).toContain(claims[0].claim);
    // Scores come from the scored run: the headline function and its numbers, never digits typed in.
    expect(page).toContain("heldOutHeadline(held)");
    expect(page).toContain('baselineScore(held, "same-category")');
    expect(page).toContain('baselineScore(held, "always-skip")');
    expect(page).not.toMatch(/value=\{\d/);
    // Two ways in: Check a post, or Start here.
    expect(page).toMatch(/className="btn" href="\/check"/);
    expect(page).toMatch(/className="btn outline" href="\/judge"/);
  });

  it("shows the sample shelf's sunscreen skip, decided by the engine, and the shelf item it matched", () => {
    const x = landingSample();
    expect(x.check.id).toBe(LANDING_SKIP_ID);
    expect(x.verdict).toBe("skip");
    expect(x.check.decision.rule).toBe("owns-similar");
    expect(x.reason).toContain(`You already own ${x.shelf.brand} ${x.shelf.name}`);
    expect(x.shelf.matchPercent).toBeGreaterThanOrEqual(90);
    expect(x.staple.daysLeft).toBeLessThanOrEqual(REBUY_LEAD_DAYS);
    // The hero slot renders the app's own verdict component, not a picture of one.
    expect(read("app/components/hero-object/HeroObject.tsx")).toContain("<VerdictSummary");
    expect(read("app/check/[id]/page.tsx")).toContain("<VerdictSummary");
  });

  it("puts the intake on /check and sends every Check link there", () => {
    const intake = read("app/check/page.tsx");
    expect(intake).toContain("<Intake samples={SAMPLES} />");
    expect(read("app/components/NavLinks.tsx")).toContain('{ href: "/check", label: "Check" }');
    for (const file of ["app/check/[id]/page.tsx", "app/checkout/[id]/page.tsx", "app/components/VerdictActions.tsx"]) {
      expect(read(file), file).not.toMatch(/href="\/"/);
    }
    const held = heldOutResult();
    const steps = startHereSteps({ heldOutRight: held.skipCorrect, heldOutN: held.n, devN: DEV_SET_SIZE, rebuyLeadDays: REBUY_LEAD_DAYS });
    expect(steps[0].links).toEqual([{ href: "/check", label: "Open Check" }]);
  });
});

describe("judge kit", () => {
  const held = heldOutResult();
  const steps = startHereSteps({ heldOutRight: held.skipCorrect, heldOutN: held.n, devN: DEV_SET_SIZE, rebuyLeadDays: REBUY_LEAD_DAYS });

  it("keeps the start-here path to six steps or fewer, the same in the README", () => {
    expect(steps.length).toBeLessThanOrEqual(6);
    expect(README).toContain(`Open \`/judge\` on the running app for ${numberWord(steps.length)} short steps.`);
    const tryIt = section(README, "Try it");
    const listed = [...tryIt.matchAll(/^\d+\. (.+?)\. /gm)].map((m) => m[1]);
    expect(listed).toEqual(steps.map((s) => s.title));
    const page = read("app/judge/page.tsx");
    expect(page).toContain("startHereSteps(");
    expect(page).toContain("numberWord(steps.length)");
    expect(steps.filter((s) => s.sampleWeek)).toHaveLength(1);
    // Login and card details live in the submission's testing instructions, never here.
    expect(page).toContain("Sandbox login and test card:</strong> see the testing instructions on the submission page");
    expect(steps.some((s) => s.body.includes("testing instructions on the submission page"))).toBe(true);
    for (const text of [read("README.md"), page, read("lib/app/start-here.ts"), FACTS]) {
      expect(text).not.toMatch(/\b(?:4\d{3}|5[1-5]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/);
      expect(text).not.toMatch(/@personal\.example\.com|sb-[a-z0-9]+@/i);
    }
  });

  it("describes the sample week as it loads, and why the price watch comes before the first purchase", () => {
    const today = "2026-11-07";
    const s = sampleWeekState("factsweek1", today);
    const count = (v: string) => s.checks.filter((c) => c.decision.verdict === v).length;
    expect([count("skip"), count("wait"), count("buy")]).toEqual([2, 4, 1]);
    expect(dueStaples(s, today).map((d) => d.item.id)).toEqual(["sh-cleanser"]);
    expect(steps[0].body).toContain(`${numberWord(count("skip"))} skips, ${numberWord(count("wait"))} waits, a buy and a cleanser due for a rebuy`);
    expect(s.checks.find((c) => c.id === "week-spf")?.decision.verdict).toBe("skip");
    // Newest first on Check: the sunscreen is the newest entry.
    expect([...s.checks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id).toBe("week-spf");
    // The retinol waits for a lower price until the first purchase spends the skincare budget.
    const retinol = () => s.checks.find((c) => c.id === "week-retinol")!.decision.rule;
    expect(retinol()).toBe("above-usual-price");
    const peptide = s.checks.find((c) => c.id === "week-peptide")!;
    expect(peptide.decision.verdict).toBe("buy");
    expect(steps[2].body).toContain(`tap Buy for ${formatDollars(peptide.facts.priceShown!)} with PayPal`);
    recordSpend(s.budgets, today, "skincare", peptide.facts.priceShown!);
    refreshChecks(s, today);
    expect(retinol()).toBe("over-budget");
    const order = steps.map((x) => x.title);
    expect(order.indexOf("Wait for a lower price")).toBeLessThan(order.indexOf("Buy once and save PayPal for rebuys"));
  });

  it("states the unit test count", () => {
    const testFiles = filesUnder(".", ".test.ts");
    const sources = testFiles.map(read);
    for (const src of sources) expect(src).not.toMatch(/\b(it|test|describe)\.(each|only|skip|todo|concurrent)\b/);
    const count = sources.reduce((n, src) => n + (src.match(/^\s*(it|test)\(/gm)?.length ?? 0), 0);
    expect(badges().get("unit tests")).toBe(String(count));
  });

  it("shows only computed numbers on the README badges", () => {
    const r = runSkipEval();
    const b = badges();
    expect(b.get("skip on held-out products")).toBe(`${held.skipCorrect} of ${held.n}`);
    expect(b.get("held-out baselines")).toBe(`same category ${baselineScore(held, "same-category")}, skip everything ${baselineScore(held, "always-skip")}`);
    expect(b.get("skip precision on held-out products")).toBe(pct(held.precision));
    expect(b.get("skip on the development set")).toBe(`${r.skipCorrect} of ${r.n}`);
    expect([...b.keys()].sort()).toEqual(["held-out baselines", "skip on held-out products", "skip on the development set", "skip precision on held-out products", "store return rules", "unit tests"]);
  });

  it("lists every claim in FACTS.md with a check that exists", () => {
    const rows = factRows();
    expect(rows.length).toBeGreaterThanOrEqual(60);
    expect(new Set(rows.map((x) => x.id)).size).toBe(rows.length);
    for (const row of rows) {
      const tests = [...row.checkedBy.matchAll(/`([\w/.-]+\.test\.ts)` › "([^"]+)"/g)];
      const external = row.checkedBy.match(/external: (https:\/\/\S+)/);
      expect(tests.length > 0 || external !== null, row.id).toBe(true);
      for (const [, file, name] of tests) {
        expect(existsSync(file), `${row.id}: ${file}`).toBe(true);
        expect(read(file), `${row.id}: ${file} › ${name}`).toContain(`it(${JSON.stringify(name)}`);
      }
      // A quoted claim appears word for word in every file listed in backticks.
      if (!row.quoted) continue;
      for (const [, file] of row.where.matchAll(/`([^`]+)`/g)) {
        expect(existsSync(file), `${row.id}: ${file}`).toBe(true);
        const text = file.endsWith(".json") ? jsonStrings(JSON.parse(read(file))).join("\n") : file === "README.md" ? README : read(file);
        expect(text, `${row.id} in ${file}`).toContain(row.claim);
      }
    }
  });
});

interface FactRow {
  id: string;
  claim: string;
  quoted: boolean;
  where: string;
  checkedBy: string;
}

function factRows(): FactRow[] {
  return FACTS.split("\n")
    .filter((line) => /^\| [FE]\d{2} \|/.test(line))
    .map((line) => {
      const cells = line.split(" | ").map((c) => c.replace(/^\| /, "").replace(/ \|$/, ""));
      if (cells.length !== 4) throw new Error(`FACTS.md row has ${cells.length} cells: ${line.slice(0, 40)}`);
      const [id, rawClaim, where, checkedBy] = cells;
      const quoted = /^".*"$/.test(rawClaim);
      return { id, claim: (quoted ? rawClaim.slice(1, -1) : rawClaim).replace(/\\"/g, '"'), quoted, where, checkedBy };
    });
}

function jsonStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(jsonStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(jsonStrings);
  return [];
}

/** README badges: label to message, decoded from the static badge URLs. */
function badges(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of read("README.md").matchAll(/\[!\[([^\]]+)\]\(https:\/\/img\.shields\.io\/badge\/([^)]+)\)\]\(([^)]+)\)/g)) {
    const [, alt, path, link] = m;
    const parts = path.replace(/--/g, "\u0000").split("-").map((p) => decodeURIComponent(p.replace(/\u0000/g, "-")));
    expect(parts).toHaveLength(3);
    const [label, message] = parts;
    expect(alt).toBe(`${label}: ${message}`);
    expect(existsSync(link)).toBe(true);
    out.set(label, message);
  }
  return out;
}
