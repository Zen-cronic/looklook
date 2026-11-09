import Link from "next/link";
import { Suspense } from "react";
import { currentSession } from "@/lib/app/session";
import { SAMPLES } from "@/lib/app/samples";
import { sharedInput } from "@/lib/app/share";
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

export default function CheckPage({ searchParams }: PageProps<"/check">) {
  return (
    <main className="page">
      <div className="page-head">
        <h1>Saw it on your feed?</h1>
        <p className="lede">Send {APP_NAME} the post before you buy. It checks what you already own, your budget, the price history and whether the store takes it back once opened.</p>
      </div>
      <div className="object-layout">
        <Suspense fallback={null}>
          <LatestCheck />
        </Suspense>
        <div className="lead">
          <Suspense fallback={<Intake samples={SAMPLES} />}>
            <SharedIntake searchParams={searchParams} />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <RecentChecks />
        </Suspense>
      </div>
    </main>
  );
}

/** Opened from a phone's share sheet: check the shared link or screenshot straight away. */
async function SharedIntake({ searchParams }: { searchParams: PageProps<"/check">["searchParams"] }) {
  const shared = sharedInput(await searchParams);
  return <Intake samples={SAMPLES} shared={shared} />;
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
    <div className="stack">
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
    </div>
  );
}
