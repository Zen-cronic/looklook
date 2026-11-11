import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { median, parseAnswer, parseJsonl, promptHash, scoreRun } from "../eval/baseline";
import { READER_MODEL } from "../vision/read";
import { plainModelBaseline, plainModelLine } from "./baseline";

const read = (path: string) => readFileSync(path, "utf8");
const results = JSON.parse(read("eval/baseline/results.json"));
const cases = JSON.parse(read("eval/holdout/cases.json")).cases as Array<{ id: string; expected: { verdict: string } }>;
const runFiles = readdirSync("eval/baseline/runs").filter((f) => /^run-\d+\.jsonl$/.test(f)).sort();
const runs = runFiles.map((f) => parseJsonl(read(`eval/baseline/runs/${f}`)));
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

describe("plain-model baseline (read from its committed runs)", () => {
  it("states the plain-model baseline from its committed runs", () => {
    const b = plainModelBaseline();
    expect(runs).toHaveLength(3);
    for (const lines of runs) {
      // Every case once, scored against the held-out answer key as it stands.
      expect(lines.map((l) => l.id)).toEqual(cases.map((c) => c.id));
      for (const l of lines) {
        expect(l.expected).toBe(cases.find((c) => c.id === l.id)!.expected.verdict);
        expect(l.answer).toBe(parseAnswer(l.text));
        expect(l.model).toBe(READER_MODEL);
      }
    }
    const scores = runs.map((lines) => scoreRun(lines[0].run, lines));
    expect(scores).toEqual(results.runs);
    expect(scores.map((s) => s.skipCorrect)).toEqual([27, 27, 27]);
    expect([b.median, b.min, b.max, b.n]).toEqual([median(b.runs), Math.min(...b.runs), Math.max(...b.runs), 30]);
    expect(b.model).toBe(READER_MODEL);

    const line = plainModelLine(b);
    expect(line).toBe("The same model with no LookLook rules got it right 27 times (median of 3 runs, range 27 to 27).");
    expect(read("README.md")).toContain(line);
    const md = read("eval/baseline/RESULTS.md");
    expect(md).toContain(`(median ${b.median}, range ${b.min} to ${b.max})`);
    scores.forEach((s) => expect(md).toContain(`| Plain model, run ${s.run} | ${s.skipCorrect} of ${s.n} | ${s.skipsMade} | ${s.skipsRight} |`));
    expect(md).toContain(results.promptSha256);
    // /proof reads the committed result; it types no score in by hand.
    expect(read("app/proof/page.tsx")).toContain("plainModelBaseline()");
  });

  it("fixed the prompt and runner before the first scored call", () => {
    const [commit] = results.commits;
    expect(results.commits).toHaveLength(1);
    for (const lines of runs) for (const l of lines) expect((l as unknown as { commit: string }).commit).toBe(commit);
    expect(promptHash(read("eval/baseline/prompt.md"))).toBe(results.promptSha256);
    expect(promptHash(git("show", `${commit}:eval/baseline/prompt.md`) + "\n")).toBe(results.promptSha256);
    // No run files existed at the commit the runs name, and it came before the first answer.
    expect(git("ls-tree", "-r", "--name-only", commit, "eval/baseline/")).toBe("eval/baseline/prompt.md");
    const firstAnswer = Math.min(...runs.flat().map((l) => Date.parse(l.at)));
    expect(Date.parse(git("show", "-s", "--format=%cI", commit))).toBeLessThan(firstAnswer);
  });

  it("reads the first whole SKIP or BUY as the answer", () => {
    expect(parseAnswer("**SKIP.** They own one.")).toBe("skip");
    expect(parseAnswer("BUY: nothing they own does this.")).toBe("buy");
    expect(parseAnswer("Buy it; skipping makes no sense")).toBe("buy");
    expect(parseAnswer("Not sure.")).toBe("unclear");
  });
});
