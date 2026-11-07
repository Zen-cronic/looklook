import Link from "next/link";
import { Suspense } from "react";
import { currentSession } from "@/lib/app/session";
import { SAMPLES } from "@/lib/app/samples";
import { APP_NAME } from "@/lib/brand";
import { Intake } from "./components/Intake";
import { VerdictChip } from "./components/VerdictChip";

export default function CheckPage() {
  return (
    <main className="page stack-lg">
      <div>
        <h1>Saw it on your feed?</h1>
        <p className="lede">Send {APP_NAME} the post before you buy. It checks what you already own, your budget, the price history and whether the store takes it back once opened.</p>
      </div>
      <Intake samples={SAMPLES} />
      <Suspense fallback={null}>
        <RecentChecks />
      </Suspense>
    </main>
  );
}

async function RecentChecks() {
  const { state } = await currentSession();
  const recent = [...state.checks].reverse().slice(0, 6);
  if (!recent.length) return null;
  return (
    <section>
      <div className="section-head">
        <h2>Your recent checks</h2>
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
