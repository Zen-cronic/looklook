/**
 * The "waiting for" table that Studio's agents build on request. When a run
 * fails or takes too long, the workspace puts back the last table they built
 * in this browser, or this one (the configuration they built on 2026-11-06).
 */

export interface WaitsWidget {
  widget: { type: string; title?: string; dataMapping?: unknown } & Record<string, unknown>;
  layout: { xTrack: number; yTrack: number; xSpan: number; ySpan: number };
  filters?: unknown[];
}

export function isWaitsWidget(w: unknown): w is WaitsWidget["widget"] {
  if (!w || typeof w !== "object") return false;
  const x = w as WaitsWidget["widget"];
  return typeof x.type === "string" && JSON.stringify(x.dataMapping ?? {}).includes("verdicts.");
}

export const DEFAULT_WAITS_WIDGET: WaitsWidget = {
  widget: {
    type: "grid",
    format: { title: { enabled: true, text: "Waiting for a price drop or next month" } },
    dataMapping: {
      cols: [{ id: "verdicts.waitingFor" }, { id: "verdicts.product" }, { id: "verdicts.price" }, { id: "verdicts.buyAt" }, { id: "verdicts.lookAgain" }],
    },
    sort: [{ field: { id: "verdicts.waitingFor" }, direction: "asc" }],
  },
  layout: { xTrack: 9, yTrack: 12, xSpan: 15, ySpan: 10 },
  filters: [{ field: { id: "verdicts.verdict" }, model: { operator: "equals", value: "Wait" } }],
};
