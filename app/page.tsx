import Link from "next/link";
import { Suspense } from "react";
import { currentSession } from "@/lib/app/session";
import { SAMPLES } from "@/lib/app/samples";
import { atTheTime } from "@/lib/app/when";
import { APP_NAME } from "@/lib/brand";
import { Intake } from "./components/Intake";
import { SampleWeekNote } from "./components/SampleWeek";
import { VerdictChip } from "./components/VerdictChip";

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
              <VerdictChip verdict={c.decision.verdict} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The most recent verdict, in one line, before anything else to do. */
async function LatestCheck() {
  const { state } = await currentSession();
  const c = state.checks.at(-1);
  if (!c) return null;
  return (
    <>
      {state.sample?.kind === "week" && <SampleWeekNote />}
      <Link href={`/check/${c.id}`} className={`latest ${c.decision.verdict}`}>
      <span>
        <span className="brand-line">Last check: {c.facts.brand}</span>
        <span className="name-line" style={{ display: "block" }}>
          {c.facts.name}
        </span>
        <p className="muted">{c.purchasedReceiptId ? `Bought. ${atTheTime(c.reason.text)}` : c.reason.text}</p>
      </span>
      <VerdictChip verdict={c.decision.verdict} />
      </Link>
    </>
  );
}
