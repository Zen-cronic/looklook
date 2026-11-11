import results from "@/eval/baseline/results.json";
import { APP_NAME } from "../brand";

/**
 * The plain-model baseline on the held-out set: the same Claude model with no
 * LookLook rules, asked skip or buy. Read from the committed scores
 * (eval/baseline/results.json); nothing is re-run here.
 */
export interface PlainModelBaseline {
  model: string;
  n: number;
  runs: number[];
  median: number;
  min: number;
  max: number;
}

export function plainModelBaseline(): PlainModelBaseline {
  const r = results as unknown as { model: string; n: number; runs: Array<{ skipCorrect: number }>; median: number; min: number; max: number };
  return { model: r.model, n: r.n, runs: r.runs.map((x) => x.skipCorrect), median: r.median, min: r.min, max: r.max };
}

/** The one line for the README and the video. */
export function plainModelLine(b: PlainModelBaseline = plainModelBaseline()): string {
  return `The same model with no ${APP_NAME} rules got it right ${b.median} times (median of ${b.runs.length} runs, range ${b.min} to ${b.max}).`;
}
