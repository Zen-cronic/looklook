import type { Verdict } from "@/lib/verdict/types";
import { chipReason, VERDICT_LABELS } from "@/lib/verdict/labels";

export const VERDICT_WORD: Record<Verdict, string> = {
  skip: VERDICT_LABELS.skip.word,
  wait: VERDICT_LABELS.wait.word,
  buy: VERDICT_LABELS.buy.word,
  ask: VERDICT_LABELS.ask.word,
};

/** The bare chip. On product pages use VerdictTag, so the reason sits next to it. */
export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return <span className={`chip ${verdict}`}>{VERDICT_WORD[verdict]}</span>;
}

/** A verdict chip with its short reason right next to it. */
export function VerdictTag({ verdict, rule, reason }: { verdict: Verdict; rule?: string; reason?: string }) {
  return (
    <span className="verdict-tag">
      <VerdictChip verdict={verdict} />
      <span className="verdict-tag-reason">{reason ?? chipReason(verdict, rule)}</span>
    </span>
  );
}
