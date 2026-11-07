"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { StudioPayload } from "@/lib/studio/schema";

// The workspace runs only in the browser.
const Workspace = dynamic(() => import("./Workspace"), { ssr: false, loading: () => <div className="workspace-loading">Opening your decisions…</div> });

const NARROW = "(max-width: 760px)";

export function DecisionsLoader() {
  const [payload, setPayload] = useState<StudioPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [narrow, setNarrow] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    fetch("/api/state", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { studio: StudioPayload }) => setPayload(j.studio))
      .catch(() => setFailed(true));
    return () => mq.removeEventListener("change", update);
  }, []);

  if (failed) {
    return (
      <div className="workspace-loading">
        <p>Couldn&apos;t load your decisions.</p>
        <button className="btn outline small" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!payload || narrow === null) return <div className="workspace-loading">Opening your decisions…</div>;
  return <Workspace initial={payload} narrow={narrow} />;
}
