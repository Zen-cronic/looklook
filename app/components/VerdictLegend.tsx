"use client";

import { useEffect, useRef, useState } from "react";
import { FILM_COOKIE, filmFromCookie, filmFromEnv } from "@/lib/filming/flag";
import { LEGEND_PROTECTION, LEGEND_VERDICTS, VERDICT_LABELS } from "@/lib/verdict/labels";

/** Full-width pay buttons the round button must never sit on: it tucks away while one is under it. */
const AVOID = '[data-testid="week-yes"], .btn.block';

function hiddenForCapture(): boolean {
  const cookie = document.cookie.split("; ").find((c) => c.startsWith(`${FILM_COOKIE}=`));
  const film = filmFromEnv({ NEXT_PUBLIC_FILM_MODE: process.env.NEXT_PUBLIC_FILM_MODE }) || filmFromCookie(cookie?.split("=")[1]) || new URLSearchParams(location.search).get("film") === "1";
  return film || document.documentElement.hasAttribute("data-still");
}

/**
 * A round "?" button on every page that opens what Skip, Wait and Buy mean.
 * Hidden in filming and still captures; a recorder shows and opens it with ?legend=1.
 */
export function VerdictLegend() {
  const dialog = useRef<HTMLDialogElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"pending" | "shown" | "hidden" | "forced">("pending");
  const [tucked, setTucked] = useState(false);

  useEffect(() => {
    const forced = new URLSearchParams(location.search).get("legend") === "1";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the browser's capture switches once mounted
    setMode(forced ? "forced" : hiddenForCapture() ? "hidden" : "shown");
    if (forced) requestAnimationFrame(() => dialog.current?.showModal());
  }, []);

  // Tuck the button away while a full-width pay button is under it.
  useEffect(() => {
    if (mode === "hidden" || mode === "pending") return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const b = fab.current?.getBoundingClientRect();
      if (!b) return;
      const under = [...document.querySelectorAll(AVOID)].some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom + 8 && r.bottom > b.top - 8;
      });
      setTucked(under);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    schedule();
    // Pages change under the button without a scroll (client navigation, a card that grows), so look again now and then.
    const settle = window.setInterval(schedule, 700);
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      window.clearInterval(settle);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [mode]);

  if (mode === "hidden" || mode === "pending") return null;
  return (
    <>
      <button
        ref={fab}
        type="button"
        className="legend-fab"
        aria-label="What do Skip, Wait and Buy mean?"
        aria-haspopup="dialog"
        data-testid="verdict-legend-open"
        data-tucked={tucked ? "" : undefined}
        data-forced={mode === "forced" ? "" : undefined}
        tabIndex={tucked ? -1 : 0}
        onClick={() => dialog.current?.showModal()}
      >
        ?
      </button>
      <dialog
        ref={dialog}
        className="legend-sheet"
        aria-labelledby="verdict-legend-title"
        data-testid="verdict-legend"
        onClick={(e) => {
          // A click on the backdrop lands on the dialog itself, outside its content.
          if (e.target === dialog.current) dialog.current.close();
        }}
        onKeyDown={(e) => {
          // Keep Tab and Shift+Tab inside the sheet while it is open.
          if (e.key !== "Tab" || !dialog.current) return;
          const items = [...dialog.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")];
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="legend-inner">
          <div className="legend-head">
            <h2 id="verdict-legend-title">What the answers mean</h2>
            <button type="button" className="legend-close" aria-label="Close" onClick={() => dialog.current?.close()}>
              ×
            </button>
          </div>
          <ul className="legend-list">
            {LEGEND_VERDICTS.map((v) => (
              <li key={v}>
                <span className={`chip ${v}`}>{VERDICT_LABELS[v].word}</span>
                <span>{VERDICT_LABELS[v].legend}</span>
              </li>
            ))}
          </ul>
          <p className="legend-note">{LEGEND_PROTECTION}</p>
        </div>
      </dialog>
    </>
  );
}
