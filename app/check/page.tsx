import Link from "next/link";
import { Suspense } from "react";
import { currentSession } from "@/lib/app/session";
import { SAMPLES } from "@/lib/app/samples";
import { formatDollars } from "@/lib/app/money";
import { shelfLink } from "@/lib/app/shelf-link";
import { atTheTime } from "@/lib/app/when";
import { APP_NAME } from "@/lib/brand";
import { Intake } from "../components/Intake";
import { SampleWeekNote } from "../components/SampleWeek";
import { Chevron } from "../components/Chevron";
import { VerdictChip } from "../components/VerdictChip";
import { VerdictSummary } from "../components/VerdictSummary";
import { Frames, MaterialStage, ShelfLink } from "../components/stage/MaterialStage";

export const metadata = { title: "Check a post" };

export default function CheckPage() {
  return (
    <main className="page stack-lg">
      <div>
        <h1>Saw it on your feed?</h1>
        <p className="lede">Send {APP_NAME} the post before you buy. It checks what you already own, your budget, the price history and whether the store takes it back once opened.</p>
      </div>
      <Suspense fallback={null}>
        <LatestCheck />
      </Suspense>
      <Intake samples={SAMPLES} />
      <Suspense fallback={null}>
        <RecentChecks />
      </Suspense>
    </main>
  );
}

async function RecentChecks() {
  const { state } = await currentSession();
  const recent = [...state.checks].reverse().slice(1, 7);
  if (!recent.length) return null;
  return (
    <section>
      <div className="section-head">
        <h2>Earlier checks</h2>
      </div>
      <ul className="list">
        {recent.map((c) => (
          <li key={c.id}>
            <Link href={`/check/${c.id}`} className="split" style={{ textDecoration: "none" }}>
              <span>
                <span className="brand-line">{c.facts.brand || "Unknown brand"}</span>
                <span className="name-line" style={{ display: "block" }}>
                  {c.facts.name || "Unreadable post"}
                </span>
              </span>
              <span className="row-end">
                <VerdictChip verdict={c.decision.verdict} />
                <Chevron />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The most recent verdict, floating on the material panel, before anything else to do. */
async function LatestCheck() {
  const { state } = await currentSession();
  const c = state.checks.at(-1);
  if (!c) return null;
  const link = shelfLink(c, state.shelf);
  const price = c.facts.priceShown;
  return (
    <>
      {state.sample?.kind === "week" && <SampleWeekNote />}
      <MaterialStage tag="Last check" icon="check" label="Your last check">
        <Frames>
          <Link href={`/check/${c.id}`} className={`verdict compact ${c.decision.verdict}`}>
            <VerdictSummary verdict={c.decision.verdict} reason={c.purchasedReceiptId ? `Bought. ${atTheTime(c.reason.text)}` : c.reason.text} brand={c.facts.brand} name={c.facts.name} imageUrl={c.product?.imageUrl} priceLabel={price !== null ? formatDollars(price) : null} />
            <span className="compact-foot">
              See why, and what you can do
              <Chevron />
            </span>
          </Link>
        </Frames>
        {link && <ShelfLink label={link.label} brand={link.brand} name={link.name} note={link.note} href={`/shelf#${link.id}`} />}
      </MaterialStage>
    </>
  );
}
