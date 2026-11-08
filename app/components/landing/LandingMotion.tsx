"use client";

import { useEffect, useRef, useState } from "react";
import { motionOff } from "../motion";

/**
 * Scroll reveals for the landing page. Marks each `[data-reveal]` element
 * `data-shown` once it scrolls into view; the CSS hides it only while
 * `html[data-reveal-on]` is set, which happens here, so without JavaScript,
 * with reduced motion or in capture-safe mode everything is simply shown.
 */
export function LandingMotion() {
  useEffect(() => {
    if (motionOff()) return;
    const root = document.documentElement;
    const items = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    const fold = window.innerHeight * 0.92;
    // Anything already on screen at load is shown at once, so the first paint never blinks.
    for (const el of items) if (el.getBoundingClientRect().top < fold) el.setAttribute("data-shown", "");
    root.setAttribute("data-reveal-on", "");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-shown", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const el of items) if (!el.hasAttribute("data-shown")) io.observe(el);
    return () => {
      io.disconnect();
      root.removeAttribute("data-reveal-on");
    };
  }, []);
  return null;
}

/**
 * A number that counts up from zero the first time it scrolls into view.
 * The server renders the final value, which is what reduced motion,
 * capture-safe mode and no-JavaScript readers see.
 */
export function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || motionOff()) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    let frame = 0;
    // Hidden below the fold: start from zero, count when it arrives.
    frame = requestAnimationFrame(() => setShown(0));
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / ms);
          setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, ms]);
  return (
    <span ref={ref} className="num-roll">
      {shown}
    </span>
  );
}
