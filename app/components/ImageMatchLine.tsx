import type { CheckRecord } from "@/lib/app/types";
import { imageEvidenceLine } from "@/lib/vision/match";

/** "Matched to" evidence from Channel3 image search, for a screenshot the shopper uploaded. Hidden while filming. */
export function ImageMatchLine({ check, film }: { check: CheckRecord; film: boolean }) {
  const uploaded = check.input.kind === "screenshot" && !check.input.sample;
  const line = imageEvidenceLine(check.byImage, { uploaded, film, asking: check.needsConfirmation });
  if (!line) return null;
  return (
    <>
      <dt>Picture</dt>
      <dd>{line}</dd>
    </>
  );
}
