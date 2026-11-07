/**
 * Runs the verdict engine once on the held-out set and writes the score.
 *
 *   npm run eval:holdout
 *
 * Reads eval/holdout/{cases,shelf,price-bands,provenance}.json, makes no
 * network or model calls, and writes eval/holdout/RESULTS.md and results.json
 * with the same scorer as the first skip set (lib/eval/skip-set).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { PriceBand } from "../../lib/channel3/band";
import { baselines, runCase, scoreOutcomes, splitCorrectSkips, type CaseOutcome, type ShelfFile, type SkipSet } from "../../lib/eval/skip-set";
import { isCategory, type Category } from "../../lib/shelf/categories";
import { SETTINGS } from "../../lib/verdict/engine";

const DIR = "eval/holdout";
const setAsWritten = JSON.parse(readFileSync(`${DIR}/cases.json`, "utf8")) as SkipSet & { shopper?: string };
const shelfAsWritten = JSON.parse(readFileSync(`${DIR}/shelf.json`, "utf8")) as ShelfFile;
const bands = (JSON.parse(readFileSync(`${DIR}/price-bands.json`, "utf8")) as { bands: Record<string, PriceBand | null> }).bands;
const provenance = JSON.parse(readFileSync(`${DIR}/provenance.json`, "utf8")) as { expectations: { commit: string } };

/*
 * Fixture shape. The app knows 16 categories; the shelf check rejects any other
 * (the first attempt stopped on "unknown category lip-balm" before deciding any
 * case). Shelf items in other categories are left out, because the app's shelf
 * can't hold them, and cases in other categories are passed with no category,
 * which is how the app reads a catalogue category it doesn't map. Expectations
 * and engine are unchanged.
 */
const droppedShelf = shelfAsWritten.items.filter((i) => !isCategory(i.category));
const uncategorised = setAsWritten.cases.filter((c) => !isCategory(c.category));
const shelf: ShelfFile = { ...shelfAsWritten, items: shelfAsWritten.items.filter((i) => isCategory(i.category)) };
const set: SkipSet & { shopper?: string } = {
  ...setAsWritten,
  cases: setAsWritten.cases.map((c) => (isCategory(c.category) ? c : { ...c, category: undefined as unknown as Category })),
};

/** The same-category baseline on the shelf and categories as written, without the shelf check. */
const sameCategoryAsWritten = setAsWritten.cases.filter((c) => {
  const skips = shelfAsWritten.items.some((i) => i.category === c.category);
  return skips === (c.expected.verdict === "skip");
}).length;

/** Changes to the runner or fixture shape needed to get a clean run. */
const RUNNER_FIXES: string[] = droppedShelf.length || uncategorised.length
  ? [
      `The first attempt stopped before deciding any case: the shelf check rejected the category \`lip-balm\`, because the app knows 16 categories.`,
      `The runner now leaves out shelf items in categories the app can't hold (${droppedShelf.map((i) => `${i.id}, ${i.category}`).join("; ")}) and passes cases in such categories with no category, as the app does for a catalogue category it doesn't map (${uncategorised.map((c) => `${c.id}, ${c.category}`).join("; ")}); the engine's first rule then asks.`,
      `Expectations and engine are unchanged. Both baselines use the same inputs as the engine; on the shelf and categories as written, the same-category baseline would score ${sameCategoryAsWritten} of ${setAsWritten.cases.length}.`,
    ]
  : [];

/** Code that decides a verdict or scores it. */
const ENGINE_PATHS = ["lib/verdict", "lib/shelf", "lib/eval", "lib/policies", "lib/channel3/band.ts", "lib/channel3/clean.ts", "data/return-policies.json"];

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** A timestamp in US Eastern, labelled with its zone (EST or EDT). */
function eastern(when: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(when);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`;
}
const commitTime = (ref: string) => new Date(git("show", "-s", "--format=%cI", ref));

const expectationsCommit = provenance.expectations.commit;
const expectationsAt = commitTime(expectationsCommit);
const engineCommit = git("log", "-1", "--format=%H", expectationsCommit, "--", ...ENGINE_PATHS);
const engineAt = commitTime(engineCommit);
const runOnCommit = git("rev-parse", "HEAD");
const engineChangedSince = git("log", "--format=%h", `${expectationsCommit}..HEAD`, "--", ...ENGINE_PATHS);
const engineDirty = git("status", "--porcelain", "--", ...ENGINE_PATHS);
const ranAt = new Date();

const outcomes = set.cases.map((c) => runCase(c, set, shelf, bands));
const s = scoreOutcomes(outcomes);
const split = splitCorrectSkips(outcomes);
const base = baselines(set, shelf);
const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function shelfNote(o: CaseOutcome): string {
  const e = o.decision.evidence.shelf;
  const r = o.decision.evidence.replaces;
  const parts = [e ? `closest: ${e.brand} ${e.name} (${e.relation}, ${e.score.toFixed(2)})` : "no other shelf item in this category"];
  if (r) parts.push(`replaces ${r.brand} ${r.name} (${r.daysLeft} days left)`);
  return parts.join("; ");
}

function policyNote(o: CaseOutcome): string {
  const p = o.decision.evidence.policy;
  return p ? `${p.retailerName}: opened ${p.returnableOpened}` : "";
}

function row(o: CaseOutcome): string {
  return `| ${o.id} | ${o.label} | ${o.store} | ${o.expected.verdict} (${o.expected.reasons.join(", ")}) | ${o.decision.verdict} (${o.decision.rule}) | ${shelfNote(o)}; ${policyNote(o)} |`;
}

const listHeader = "| Case | Product | Store | Expected | Engine (rule that fired) | Evidence |\n|---|---|---|---|---|---|";
const list = (xs: CaseOutcome[]) => (xs.length ? `${listHeader}\n${xs.map(row).join("\n")}` : "None.");

const engineLine = engineChangedSince || engineDirty
  ? `**The engine changed after the expectations were committed** (${[engineChangedSince.replace(/\n/g, ", "), engineDirty ? "uncommitted changes" : ""].filter(Boolean).join("; ")}).`
  : "No engine or scorer file changed between the expectations commit and this run, and none had uncommitted changes.";

const md = `# Held-out skip correctness

Generated once by \`npm run eval:holdout\` at ${eastern(ranAt)}. Do not edit by hand.

**${s.skipCorrect} of ${s.n} skip decisions correct.** Skip precision ${pct(s.precision)} (${s.truePositives} of ${s.truePositives + s.falsePositives} skips were right), recall ${pct(s.recall)} (${s.truePositives} of ${s.truePositives + s.falseNegatives} expected skips caught).

| Way of deciding skip | Skip decisions correct | Skips made | Skips right |
|---|---|---|---|
${base.map((b) => `| ${b.label} | ${b.skipCorrect} of ${s.n} | ${b.skipsMade} | ${b.skipsRight} |`).join("\n")}
| The verdict engine | ${s.skipCorrect} of ${s.n} | ${s.truePositives + s.falsePositives} | ${s.truePositives} |

- Of the ${s.truePositives} correct skips, ${split.onEvidence} were decided on evidence (the shelf, or a cited policy that refuses opened returns or takes them only on conditions) and ${split.onDefault} needed the default that counts an unknown opened-return policy as not returnable.
- Duplicate or non-returnable spending avoided on correct skips: ${money(split.dollarsAvoided)} (sum of the prices shown; ${money(split.dollarsOnEvidence)} on evidence, ${money(split.dollarsOnDefault)} on the unknown-policy default).
- Wrong skips (skipped when it shouldn't): ${s.falsePositives}
- Missed skips (should have skipped): ${s.falseNegatives}
- Near-duplicates caught: ${s.nearDuplicatesCaught}
- Full verdict agreement (skip, wait, buy, ask): ${pct(s.verdictAgreement)}; deciding reason matches an expected one in ${pct(s.reasonAgreement)} of agreeing cases.

Test set: ${s.n} real products not in the first skip set, ${set.shopper ?? "a fictional shopper"} with her own shelf and budgets, the scenario's "today" set to ${set.asOf}, and expected verdicts written by hand and committed before the engine saw them. See \`README.md\` in this folder.

## Order of work

| Step | Commit | When (US Eastern) |
|---|---|---|
| Engine and scorer as last changed before the expectations | ${engineCommit.slice(0, 7)} | ${eastern(engineAt)} |
| Expectations, shelf and price bands committed | ${expectationsCommit.slice(0, 7)} | ${eastern(expectationsAt)} |
| This run, on the code at | ${runOnCommit.slice(0, 7)} | ${eastern(ranAt)} |

${engineLine} The results are committed in the commit after ${runOnCommit.slice(0, 7)}; the expectations are not changed after this run.

Runner and fixture changes needed for a clean run: ${RUNNER_FIXES.length ? RUNNER_FIXES.join(" ") : "none."}

Engine settings: identity confidence at least ${SETTINGS.minIdentityConfidence}, lead time ${SETTINGS.leadDays} days, urgent within ${SETTINGS.urgentDays} days, price tolerance ${SETTINGS.tolerance}, minimum depth ${SETTINGS.minDepth}, well above typical at +${SETTINGS.aboveTypical * 100}%.

## Wrong skips

${list(s.wrongSkips)}

## Missed skips

${list(s.missedSkips)}

## Other disagreements (not about skip)

${list(s.otherMismatches)}

## Confusion (rows expected, columns engine)

| | skip | wait | buy | ask |
|---|---|---|---|---|
${(["skip", "wait", "buy", "ask"] as const).map((e) => `| ${e} | ${(["skip", "wait", "buy", "ask"] as const).map((a) => s.confusion[e][a]).join(" | ")} |`).join("\n")}

## Every case

${list(outcomes)}
`;

writeFileSync(`${DIR}/RESULTS.md`, md);
writeFileSync(
  `${DIR}/results.json`,
  JSON.stringify(
    {
      asOf: set.asOf,
      ranAt: ranAt.toISOString(),
      commits: { engine: engineCommit, expectations: expectationsCommit, runOn: runOnCommit, engineChangedSinceExpectations: engineChangedSince ? engineChangedSince.split("\n") : [], engineDirty: Boolean(engineDirty) },
      runnerFixes: RUNNER_FIXES,
      headline: { skipCorrect: s.skipCorrect, n: s.n, precision: s.precision, recall: s.recall },
      counts: { tp: s.truePositives, fp: s.falsePositives, fn: s.falseNegatives, tn: s.trueNegatives, nearDuplicatesCaught: s.nearDuplicatesCaught, nonReturnableCaught: s.nonReturnableCaught, unknownPolicyCaught: s.unknownPolicyCaught },
      split,
      baselines: base,
      verdictAgreement: s.verdictAgreement,
      reasonAgreement: s.reasonAgreement,
      cases: outcomes.map((o) => ({ id: o.id, expected: o.expected.verdict, verdict: o.decision.verdict, rule: o.decision.rule, flags: o.decision.flags, shelfItem: o.decision.evidence.shelf?.itemId ?? null, score: o.decision.evidence.shelf?.score ?? null, policyUrl: o.decision.evidence.policy?.sourceUrl ?? null })),
    },
    null,
    2,
  ) + "\n",
);

console.log(`held-out skip correctness: ${s.skipCorrect}/${s.n}; precision ${pct(s.precision)}, recall ${pct(s.recall)}; wrong skips ${s.falsePositives}, missed skips ${s.falseNegatives}`);
console.log(`baselines: ${base.map((b) => `${b.id} ${b.skipCorrect}/${s.n}`).join(", ")}; correct skips on evidence ${split.onEvidence}, on the unknown-policy default ${split.onDefault}; ${money(split.dollarsAvoided)} avoided`);
console.log(`verdict agreement ${pct(s.verdictAgreement)}; written ${DIR}/RESULTS.md`);
