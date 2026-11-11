import Link from "next/link";
import { Suspense } from "react";
import { displaySession } from "@/lib/filming/server";
import { WeekLoader } from "../WeekLoader";
import "../studio.css";

export const metadata = { title: "This week in Studio" };

export default function StudioWeekPage(props: PageProps<"/studio/week">) {
  return (
    <main className="studio-page">
      <Suspense fallback={<div className="workspace-loading">Opening this week…</div>}>
        <Week searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Week({ searchParams }: { searchParams: PageProps<"/studio/week">["searchParams"] }) {
  const q = await searchParams;
  const { raw } = await displaySession();
  const asked = typeof q.run === "string" ? q.run : undefined;
  const run = asked ? raw.weeks?.find((r) => r.id === asked) : raw.weeks?.at(-1);
  if (!run) {
    return (
      <div className="workspace-loading">
        <p>No week handed over yet in this browser.</p>
        <Link className="btn" href="/week">
          Hand it your week
        </Link>
      </div>
    );
  }
  return <WeekLoader runId={run.id} />;
}
