"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { WeekView } from "@/lib/app/week";

// The workspace runs only in the browser.
const WeekWorkspace = dynamic(() => import("./WeekWorkspace"), { ssr: false, loading: () => <div className="workspace-loading">Opening this week…</div> });

const NARROW = "(max-width: 760px)";

export function WeekLoader({ runId }: { runId: string }) {
  const [view, setView] = useState<WeekView | null>(null);
  const [failed, setFailed] = useState(false);
  const [narrow, setNarrow] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    fetch(`/api/week/${runId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((v: WeekView) => setView(v))
      .catch(() => setFailed(true));
    return () => mq.removeEventListener("change", update);
  }, [runId]);

  if (failed) {
    return (
      <div className="workspace-loading">
        <p>Couldn&apos;t load this week.</p>
        <button className="btn outline small" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!view || narrow === null) return <div className="workspace-loading">Opening this week…</div>;
  return <WeekWorkspace initial={view} runId={runId} narrow={narrow} />;
}
