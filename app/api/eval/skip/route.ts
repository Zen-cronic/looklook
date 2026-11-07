import { connection } from "next/server";
import { runSkipEval } from "@/lib/app/eval";

/** Re-run the verdict engine over the committed skip test set and return the number. */
export async function GET() {
  await connection();
  const r = runSkipEval();
  return Response.json({
    headline: `${r.skipCorrect} of ${r.n} skip decisions correct`,
    skipCorrect: r.skipCorrect,
    n: r.n,
    skipPrecision: Math.round(r.precision * 1000) / 1000,
    skipRecall: Math.round(r.recall * 1000) / 1000,
    skipsMade: r.skipsMade,
    skipsRight: r.skipsRight,
    skipsExpected: r.skipsExpected,
    wrongSkips: r.wrongSkips.map((c) => ({ id: c.id, product: c.product, store: c.store, rule: c.rule })),
    missedSkips: r.missedSkips.map((c) => ({ id: c.id, product: c.product, store: c.store, got: c.got, rule: c.rule })),
    asOf: r.asOf,
    ranAt: r.ranAt,
    ms: r.ms,
  });
}
