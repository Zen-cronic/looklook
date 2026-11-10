import Link from "next/link";
import { Suspense } from "react";
import { neutralDeep } from "@/lib/filming/view";
import { displaySession } from "@/lib/filming/server";
import { WEEK_TAGLINE, weekView } from "@/lib/app/week";
import { WeekFlow, WeekStart } from "../components/WeekFlow";

export const metadata = { title: "Hand it your week" };

export default function WeekPage(props: PageProps<"/week">) {
  return (
    <main className="page">
      <div className="page-head">
        <h1>Hand it your week</h1>
        <p className="lede">{WEEK_TAGLINE}</p>
      </div>
      <Suspense fallback={<div className="skeleton" />}>
        <Week searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Week({ searchParams }: { searchParams: PageProps<"/week">["searchParams"] }) {
  const q = await searchParams;
  const runId = typeof q.run === "string" ? q.run : undefined;
  const { raw, film } = await displaySession();
  const run = runId ? raw.weeks?.find((r) => r.id === runId) : undefined;
  if (!run) {
    return (
      <>
        {runId && <p className="error">That week is gone. Hand it over again.</p>}
        <WeekStart hasMethod={raw.methods.some((m) => m.status === "active")} />
        <p className="small muted week-own">
          One post at a time instead? <Link href="/check">Check a post</Link>.
        </p>
      </>
    );
  }
  // The slip's hash comes from the real records; filming mode only changes how names show.
  const view = weekView(raw, run);
  const paid = typeof q.paid === "string" ? q.paid : undefined;
  // Keyed by where the week stands, so a kept page (back, or back from checkout) never shows an old state.
  const key = `${run.id}:${paid ?? ""}:${run.sent.length}:${run.approvedAt ?? ""}:${Object.keys(run.outcomes).length}`;
  return <WeekFlow key={key} initial={film ? neutralDeep(view, { shortIds: true }) : view} paidReceipt={paid} />;
}
