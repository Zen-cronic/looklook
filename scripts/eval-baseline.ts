/**
 * Plain-model baseline on the held-out skip set: the same Claude model the app
 * uses, asked "skip or buy?" in plain words, with no LookLook rules.
 *
 *   npm run eval:baseline -- --show h01      print one filled prompt (no call)
 *   npm run eval:baseline -- --run 1         30 calls, writes eval/baseline/runs/run-1.jsonl
 *   npm run eval:baseline -- --score         writes eval/baseline/results.json from the runs
 *
 * The prompt (eval/baseline/prompt.md), this runner and lib/eval/baseline.ts
 * were committed before any scored call; --run refuses to start if any of
 * them has uncommitted changes, and records the commit it ran on. A run file
 * is written only when all 30 answers are in, and never overwritten.
 * Temperature, effort and thinking are left at the API defaults. The logs hold
 * the model's answers and token counts, never keys or request headers.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { fillPrompt, median, parseAnswer, parseJsonl, promptHash, scoreRun, type BaselineLine } from "../lib/eval/baseline";
import type { ShelfFile, SkipSet } from "../lib/eval/skip-set";
import { READER_MODEL } from "../lib/vision/read";
import { loadEnv } from "./lib/env";

const DIR = "eval/baseline";
const PROMPT = `${DIR}/prompt.md`;
const PINNED = [PROMPT, "scripts/eval-baseline.ts", "lib/eval/baseline.ts"];
/** The model the app reads posts with and words reasons with. */
const MODEL = READER_MODEL;
const MAX_TOKENS = 1024;
const CONCURRENCY = 5;

const set = JSON.parse(readFileSync("eval/holdout/cases.json", "utf8")) as SkipSet;
const shelf = JSON.parse(readFileSync("eval/holdout/shelf.json", "utf8")) as ShelfFile;
const template = readFileSync(PROMPT, "utf8");
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function runOnce(run: number) {
  const file = `${DIR}/runs/run-${run}.jsonl`;
  if (existsSync(file)) throw new Error(`${file} exists; runs are never overwritten`);
  if (git("status", "--porcelain", "--", ...PINNED)) throw new Error("Commit the prompt and runner before a scored run.");
  loadEnv();
  if (process.env.ANTHROPIC_MODEL && process.env.ANTHROPIC_MODEL !== MODEL) throw new Error("ANTHROPIC_MODEL overrides the app's model; unset it for the baseline.");
  const client = new Anthropic({ maxRetries: 6 });
  const commit = git("rev-parse", "HEAD");
  const lines: BaselineLine[] = new Array(set.cases.length);
  let next = 0;
  async function callNext() {
    while (next < set.cases.length) {
      const k = next++;
      const c = set.cases[k];
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: fillPrompt(template, c, set, shelf) }],
      });
      const text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const answer = parseAnswer(text);
      lines[k] = {
        run,
        id: c.id,
        expected: c.expected.verdict,
        answer,
        skipCorrect: (answer === "skip") === (c.expected.verdict === "skip"),
        text,
        model: msg.model,
        stopReason: msg.stop_reason,
        usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
        at: new Date().toISOString(),
      };
      process.stdout.write(".");
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, callNext));
  writeFileSync(file, lines.map((l) => JSON.stringify({ ...l, commit })).join("\n") + "\n");
  const s = scoreRun(run, lines);
  console.log(`\nrun ${run}: ${s.skipCorrect} of ${s.n} (wrong skips ${s.wrongSkips.join(", ") || "none"}; missed ${s.missedSkips.join(", ") || "none"}; unclear ${s.unclear.join(", ") || "none"})`);
}

function score() {
  const files = readdirSync(`${DIR}/runs`).filter((f) => /^run-\d+\.jsonl$/.test(f)).sort();
  const runs = files.map((f) => parseJsonl(readFileSync(`${DIR}/runs/${f}`, "utf8")));
  const scores = runs.map((lines) => scoreRun(lines[0].run, lines));
  const frozen = JSON.parse(readFileSync("eval/holdout/results.json", "utf8")) as { cases: Array<{ id: string; verdict: string }> };
  const correct = scores.map((s) => s.skipCorrect);
  const out = {
    what: "The same model with no LookLook rules, asked whether to skip each held-out product. Scored like the engine: right when it says skip exactly when skip was expected.",
    model: MODEL,
    modelsAnswering: [...new Set(runs.flat().map((l) => l.model))],
    promptSha256: promptHash(template),
    commits: [...new Set(runs.flat().map((l) => (l as BaselineLine & { commit: string }).commit))],
    asOf: set.asOf,
    ranAt: runs.map((lines) => lines.map((l) => l.at).sort()[0]),
    n: set.cases.length,
    runs: scores,
    median: median(correct),
    min: Math.min(...correct),
    max: Math.max(...correct),
    lookLookScoredRun: { skipCorrect: frozen.cases.filter((x) => (x.verdict === "skip") === (set.cases.find((c) => c.id === x.id)!.expected.verdict === "skip")).length },
    cases: set.cases.map((c) => ({
      id: c.id,
      expected: c.expected.verdict,
      answers: runs.map((lines) => lines.find((l) => l.id === c.id)!.answer),
      lookLook: frozen.cases.find((x) => x.id === c.id)!.verdict,
    })),
  };
  writeFileSync(`${DIR}/results.json`, JSON.stringify(out, null, 2) + "\n");
  console.log(`runs ${correct.join(", ")}; median ${out.median}; range ${out.min}-${out.max}; LookLook scored run ${out.lookLookScoredRun.skipCorrect}`);
}

async function main() {
  const show = arg("--show");
  const run = arg("--run");
  if (show) {
    const c = set.cases.find((x) => x.id === show);
    if (!c) throw new Error(`no case ${show}`);
    console.log(fillPrompt(template, c, set, shelf));
    console.log(`\n[model ${MODEL}; prompt sha256 ${promptHash(template)}]`);
  } else if (run) {
    await runOnce(Number(run));
  } else if (process.argv.includes("--score")) {
    score();
  } else {
    console.log("Pass --show <case>, --run <n> or --score.");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
