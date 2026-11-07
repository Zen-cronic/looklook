import { connection } from "next/server";
import { devSetJson, runSkipEval } from "@/lib/app/eval";
import { heldOutHeadline, heldOutJson, heldOutResult } from "@/lib/app/holdout";

/**
 * How often skip is right. The headline is the held-out set's single scored
 * run, read from its committed results (not re-run). The development set
 * comes second and is re-run on the server on every request.
 */
export async function GET() {
  await connection();
  const held = heldOutResult();
  return Response.json({
    headline: heldOutHeadline(held),
    heldOut: heldOutJson(held),
    developmentSet: devSetJson(runSkipEval()),
  });
}
