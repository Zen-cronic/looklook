import { connection } from "next/server";
import { devSetJson, runSkipEval } from "@/lib/app/eval";
import { heldOutHeadline, heldOutJson, heldOutResult } from "@/lib/app/holdout";

/**
 * Both skip sets in full. Held out: the single scored run, every case, read
 * from eval/holdout/results.json, plus any later re-runs recorded beside it.
 * Development set: re-run on the server now.
 */
export async function GET() {
  await connection();
  const held = heldOutResult();
  return Response.json({
    headline: heldOutHeadline(held),
    heldOut: { ...heldOutJson(held, true), afterLaterChanges: held.afterChanges },
    developmentSet: devSetJson(runSkipEval()),
  });
}
