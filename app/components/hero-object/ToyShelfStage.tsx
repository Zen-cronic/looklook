"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useState, type ReactNode } from "react";
import { motionOff } from "../motion";
import type { ShelfMode } from "./ToyShelfScene";
import s from "./HeroObject.module.css";

// three.js loads only in the browser, only when it will play, and after the page has painted.
const Scene = dynamic(() => import("./ToyShelfScene"), { ssr: false, loading: () => null });

/**
 * poster: the still of the shelf before the new bottle arrives (first paint).
 * play:   the canvas has drawn its first frame over the poster and is running.
 * done:   the sequence finished; the verdict below the shelf shows.
 * final:  no canvas (reduced motion, capture-safe or filming mode, no WebGL,
 *         or the scene failed): the still of the finished scene and the verdict.
 * capture: development only, `?shelf=initial|final`, to render the stills.
 */
type Phase = "poster" | "play" | "done" | "final" | "capture";

const STILLS = {
  poster: { wide: "/media/toy-shelf-start-wide", narrow: "/media/toy-shelf-start-narrow" },
  final: { wide: "/media/toy-shelf-skip-wide", narrow: "/media/toy-shelf-skip-narrow" },
};

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function afterPaint(fn: () => void) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 1200 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Still({ src, kind, priority }: { src: { wide: string; narrow: string }; kind: "poster" | "final"; priority?: boolean }) {
  return (
    <picture className={kind === "poster" ? s.poster : s.finalStill} data-shelf-still={kind}>
      <source media="(max-width: 640px)" type="image/avif" srcSet={`${src.narrow}.avif`} />
      <source media="(max-width: 640px)" type="image/webp" srcSet={`${src.narrow}.webp`} />
      <source type="image/avif" srcSet={`${src.wide}.avif`} />
      <img src={`${src.wide}.webp`} alt="" width={1632} height={1020} decoding="async" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} />
    </picture>
  );
}

export function ToyShelfStage({ film = false, label, children }: { film?: boolean; label: string; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(film ? "final" : "poster");
  const [mode, setMode] = useState<ShelfMode | null>(null);

  useEffect(() => {
    if (film) return;
    if (process.env.NODE_ENV !== "production") {
      const q = new URLSearchParams(window.location.search).get("shelf");
      if (q === "initial" || q === "final") {
        const id = requestAnimationFrame(() => {
          setPhase("capture");
          setMode(q);
        });
        return () => cancelAnimationFrame(id);
      }
    }
    if (motionOff() || !hasWebGL()) {
      const id = requestAnimationFrame(() => setPhase("final"));
      return () => cancelAnimationFrame(id);
    }
    return afterPaint(() => setMode("play"));
  }, [film]);

  return (
    <div className={s.object} data-shelf="" data-phase={phase}>
      <div className={s.stage} role="img" aria-label={label}>
        <Still src={STILLS.poster} kind="poster" priority />
        <Still src={STILLS.final} kind="final" />
        {mode && (
          <div className={s.canvas}>
            <SceneBoundary onError={() => setPhase("final")}>
              <Scene mode={mode} onReady={() => setPhase((p) => (p === "poster" ? "play" : p))} onDone={() => setPhase((p) => (p === "play" ? "done" : p))} />
            </SceneBoundary>
          </div>
        )}
      </div>
      <div className={s.caption}>{children}</div>
    </div>
  );
}
