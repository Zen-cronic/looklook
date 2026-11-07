import type { Verdict } from "@/lib/verdict/types";

export const VERDICT_WORD: Record<Verdict, string> = { skip: "Skip", wait: "Wait", buy: "Buy", ask: "Check this" };

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return <span className={`chip ${verdict}`}>{VERDICT_WORD[verdict]}</span>;
}
