"use client";

import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { AgStudioAiModule, createAiHarness, directLlmRunner, singleColumnLayout, studioTheme } from "ag-studio";
import type { AgAiChatSession, AgAiHarness, AgReportState, AgStudioApi } from "ag-studio";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_NAME } from "@/lib/brand";
import type { PurchaseSource } from "@/lib/app/types";
import { formatDay } from "@/lib/app/dates";
import { diffRows, fieldName, TABLES, waitCounts, type FieldKind, type Row, type StudioPayload, type TableId } from "@/lib/studio/schema";
import { SampleWeekNote } from "../components/SampleWeek";
import { claudeAdapter, type TurnInfo } from "./adapter";
import { DEFAULT_WAITS_WIDGET, isWaitsWidget, type WaitsWidget } from "./waits";
import { BudgetWidget, ShelfListWidget, SkipWidget, VerdictWidget, WatchListWidget, type ApproveResult, type WorkspaceContext } from "./widgets";

const LICENSE = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;
const PAGE_ID = "decisions";
const BASE_WIDGETS = ["verdicts", "budget", "skip", "shelf", "watch"];
const AGENT_ID = "looklook";
const RUN_LIMIT_MS = 150_000;
const CACHE_KEY = "looklook.waits-widget.v1";

// One workspace per page: model turns report progress to whichever run is active.
let onTurn: (t: TurnInfo) => void = () => undefined;
const adapter = claudeAdapter("/api/llm", (t) => onTurn(t));

const FORMAT: Record<FieldKind, string> = { text: "textFormat", money: "currencyFormat", date: "dateFormat", int: "integerFormat", bool: "booleanFormat" };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function toCells(table: TableId, rows: Row[]) {
  const dates = TABLES.find((t) => t.id === table)!.fields.filter((f) => f.kind === "date").map((f) => f.id);
  return rows.map((r) => {
    const o: Record<string, string | number | boolean | Date | null> = { ...r };
    for (const k of dates) if (typeof o[k] === "string" && o[k]) o[k] = new Date(`${o[k]}T12:00:00`);
    return o;
  });
}

function sources(payload: StudioPayload) {
  return TABLES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    primaryKeyField: "id",
    transactions: "all" as const,
    data: toCells(t.id, payload.tables[t.id]),
    fields: t.fields.map((f) => ({
      id: f.id,
      name: fieldName(f, payload.dayOffset),
      description: f.description,
      hide: f.hide,
      blankValue: "",
      format: FORMAT[f.kind],
      ...(f.kind === "money" ? { formatOptions: { format: usd } } : f.kind === "date" ? { formatOptions: { format: shortDate } } : {}),
    })),
  }));
}

// Canvas rows are 20px. The shelf grid is tall enough for every row, so it never cuts off mid-list.
const TRACK_PX = 20;
const shelfSpan = (rows: number) => Math.max(10, Math.ceil((rows * 26 + 96) / TRACK_PX));
const watchSpan = (rows: number) => (rows ? Math.max(8, Math.ceil((rows * 26 + 96) / TRACK_PX)) : 6);

/** About how many 20px tracks the verdict list needs: its heading, each card by kind (measured at 1440), then the rebuys. */
function verdictTracks(p: StudioPayload): number {
  const CARD_PX: Record<string, number> = { Skip: 250, Wait: 270, Buy: 285, "Check this": 235, Bought: 220 };
  const cards = p.tables.verdicts.reduce((n, r) => n + (r.status === "Bought" ? CARD_PX.Bought : (CARD_PX[String(r.verdict)] ?? 270)), 0);
  return Math.ceil((70 + cards + 90 + p.tables.rebuys.length * 165) / TRACK_PX);
}

function layouts(p: StudioPayload, narrow = false) {
  if (narrow) {
    // One column on a phone: each widget keeps its own height, the verdict list grows to fit its
    // (taller, narrower) cards, and the shelf rows wrap to two lines.
    const v = Math.ceil(verdictTracks(p) * 1.12);
    const shelfRows = Math.ceil((p.tables.shelf.length * 50 + 70) / TRACK_PX);
    const watchRows = p.tables.watchlist.length ? Math.ceil((p.tables.watchlist.length * 50 + 70) / TRACK_PX) : 8;
    const base = {
      verdicts: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: v },
      budget: { xTrack: 0, yTrack: v, xSpan: 24, ySpan: 12 },
      skip: { xTrack: 0, yTrack: v + 12, xSpan: 24, ySpan: 10 },
      shelf: { xTrack: 0, yTrack: v + 22, xSpan: 24, ySpan: shelfRows },
      watch: { xTrack: 0, yTrack: v + 22 + shelfRows, xSpan: 24, ySpan: watchRows },
    };
    return { base, withWaits: { ...base, waits: { xTrack: 0, yTrack: v + 22 + shelfRows + watchRows, xSpan: 24, ySpan: 10 } }, tracks: v + 22 + shelfRows + watchRows };
  }
  const shelf = shelfSpan(p.tables.shelf.length);
  const watch = watchSpan(p.tables.watchlist.length);
  // The verdict column grows to fit every card, so its last card is never cut off.
  const cards = verdictTracks(p);
  const base = {
    budget: { xTrack: 8, yTrack: 0, xSpan: 9, ySpan: 12 },
    skip: { xTrack: 17, yTrack: 0, xSpan: 7, ySpan: 12 },
    shelf: { xTrack: 8, yTrack: 12, xSpan: 16, ySpan: shelf },
    watch: { xTrack: 8, yTrack: 12 + shelf, xSpan: 16, ySpan: watch },
    verdicts: { xTrack: 0, yTrack: 0, xSpan: 8, ySpan: Math.max(12 + shelf + watch, cards) },
  };
  // With the waits table: it takes the slot under the figures, the grids move down.
  const withWaits = {
    ...base,
    waits: { xTrack: 8, yTrack: 12, xSpan: 16, ySpan: 10 },
    shelf: { ...base.shelf, yTrack: 22 },
    watch: { ...base.watch, yTrack: 22 + shelf },
    verdicts: { ...base.verdicts, ySpan: Math.max(22 + shelf + watch, cards) },
  };
  return { base, withWaits, tracks: Math.max(12 + shelf + watch, cards) };
}

const FOLDED_PANELS = { ai: { collapsed: true }, data: { collapsed: true } };

/** The page as it opens: grids on a wide screen, stacked lists on a phone, and a plain card when nothing is watched. */
function initialState(p: StudioPayload, narrow: boolean): AgReportState {
  return {
    pages: [
      {
        id: PAGE_ID,
        name: "Decisions",
        widgets: {
          verdicts: { type: "verdictList", dataMapping: {} },
          budget: { type: "budgetFigure", dataMapping: {} },
          skip: { type: "skipFigure", dataMapping: {} },
          shelf: narrow
            ? { type: "shelfList", dataMapping: {} }
            : {
                type: "grid",
                format: { title: { enabled: true, text: "Shelf" } },
                dataMapping: { cols: [{ id: "shelf.product" }, { id: "shelf.runOutDate" }, { id: "shelf.daysLeft" }, { id: "shelf.price" }] },
              },
          watch:
            narrow || p.tables.watchlist.length === 0
              ? { type: "watchList", dataMapping: {} }
              : {
                  type: "grid",
                  format: { title: { enabled: true, text: "Price watches" } },
                  dataMapping: { cols: [{ id: "watchlist.product" }, { id: "watchlist.startPrice" }, { id: "watchlist.currentPrice" }, { id: "watchlist.targetPrice" }, { id: "watchlist.status" }, { id: "watchlist.alert" }] },
                },
        },
        widgetLayout: layouts(p, narrow).base,
      },
    ],
    selectedPageId: PAGE_ID,
    // In the editor the assistant and the field list start as narrow rails, so the canvas keeps its width.
    panels: FOLDED_PANELS,
  } as unknown as AgReportState;
}

/** Suggestions in an empty assistant: each sends a precise request to LookLook's agent. */
const PROMPT_STARTERS = [
  { label: "Group my waits", prompt: "Group my waits: the shopper wants to see what each Wait verdict is waiting for, a price drop or next month's budget." },
  { label: "Chart what's left per budget", prompt: "Add one bar chart to the current page that reads the budgets table: group on the x axis, money left as the bar. Leave every other widget as it is." },
  { label: "Show only my skips", prompt: "Add one grid widget to the current page titled 'Skips', reading the verdicts table with the columns product, price, reason and store, with a widget filter verdict equals 'Skip'. Leave every other widget as it is." },
];

const STEP_WORDS: Record<string, string> = {
  delegate_to: "Handing the request to Studio's lead agent",
  view_schema: "Reading the tables",
  view_report: "Reading the workspace",
  view_page: "Reading the page",
  view_widget: "Checking the new table",
  add_widget: "Adding a table",
  configure_widget: "Choosing the columns",
  add_widget_filter: "Filtering to waits",
  position_widget: "Placing the table",
  complete_task: "Reporting back",
  report_to_looklook: "Checking the result",
};

interface ReceiptLite {
  id: string;
  title: string;
  amountCents: number;
  methodLabel: string;
  orderId: string;
  captureId?: string;
  shelfNote: string;
}

type RunState =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number; calls: number; step: string }
  | { kind: "done"; seconds: number; calls: number; fromCache: boolean; note?: string };

interface Props {
  initial: StudioPayload;
  narrow: boolean;
}

function themeFromTokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const font = `${v("--font-ui")}, sans-serif`;
  return studioTheme.withParams({
    accentColor: v("--signature"),
    foregroundColor: v("--ink"),
    backgroundColor: v("--card"),
    borderColor: v("--line"),
    chromeBackgroundColor: v("--paper"),
    studioCanvasBackgroundColor: v("--paper"),
    studioWidgetBackgroundColor: v("--card"),
    studioWidgetBorderRadius: v("--radius"),
    fontFamily: font,
    studioCanvasFontFamily: font,
    studioWidgetTitleFontFamily: font,
    studioWidgetTitleFontWeight: 800,
    studioCanvasBorder: false,
    studioCanvasShadow: false,
    studioCanvasPadding: "0px",
    studioWidgetBorder: `0.5px solid ${v("--ink")}`,
    studioWidgetSubtitleFontFamily: font,
    studioWidgetCaptionFontFamily: font,
    studioPanelHeaderFontFamily: font,
    studioPopupTitleBarFontFamily: font,
    studioCanvasRowHeight: "20px",
    studioMinWidth: 0,
    // Charts the agents add use the product's colours only: cobalt, ink, the pink highlighter, then grey.
    ...chartPalette([v("--signature"), v("--ink"), v("--accent"), v("--line-strong")]),
  } as Parameters<typeof studioTheme.withParams>[0]);
}

/** The chart palette params: the given colours, and every other slot cleared so no default colour returns. */
function chartPalette(colors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 1; i <= 20; i++) {
    const c = colors[i - 1] ?? "#00000000";
    out[`chartPaletteFills${i}Color`] = c;
    out[`chartPaletteStrokes${i}Color`] = c;
  }
  return out;
}

function readCache(): WaitsWidget | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const w = raw ? (JSON.parse(raw) as WaitsWidget) : null;
    return w && isWaitsWidget(w.widget) ? w : null;
  } catch {
    return null;
  }
}

type PageLike = { id: string; widgets?: Record<string, unknown>; widgetLayout?: Record<string, unknown>; filter?: { page?: unknown[]; widget?: Record<string, unknown> } };

function currentPage(api: AgStudioApi): PageLike | undefined {
  const st = api.getState() as unknown as { pages: PageLike[] };
  return st.pages.find((p) => p.id === PAGE_ID);
}

function addedWidgets(api: AgStudioApi): string[] {
  return Object.keys(currentPage(api)?.widgets ?? {}).filter((id) => !BASE_WIDGETS.includes(id));
}

/** Replace the decisions page, keeping the base widgets and adding `waits` when given. */
function withWaits(api: AgStudioApi, payload: StudioPayload, waits: WaitsWidget | null, id = "waits"): void {
  const { base: BASE_LAYOUT, withWaits: WITH_WAITS_LAYOUT } = layouts(payload);
  const st = api.getState() as unknown as { pages: PageLike[] } & Record<string, unknown>;
  const pages = st.pages.map((p) => {
    if (p.id !== PAGE_ID) return p;
    const keep = <T,>(rec: Record<string, T> | undefined) => Object.fromEntries(Object.entries(rec ?? {}).filter(([k]) => BASE_WIDGETS.includes(k)));
    const widgets = keep(p.widgets);
    const widgetFilters = keep(p.filter?.widget);
    const { waits: slot, ...rest } = WITH_WAITS_LAYOUT;
    const widgetLayout: Record<string, unknown> = { ...(p.widgetLayout ?? {}), ...(waits ? rest : BASE_LAYOUT) };
    for (const k of Object.keys(widgetLayout)) if (!BASE_WIDGETS.includes(k)) delete widgetLayout[k];
    if (waits) {
      widgets[id] = waits.widget;
      widgetLayout[id] = slot;
      if (waits.filters) widgetFilters[id] = waits.filters;
    }
    return { ...p, widgets, widgetLayout, filter: { ...(p.filter ?? {}), widget: widgetFilters } };
  });
  api.setState({ ...st, pages } as unknown as AgReportState, {} as never);
}

function snapshot(api: AgStudioApi, id: string): WaitsWidget | null {
  const p = currentPage(api);
  const widget = p?.widgets?.[id];
  if (!widget || !isWaitsWidget(widget)) return null;
  return { widget, layout: (p?.widgetLayout?.[id] ?? DEFAULT_WAITS_WIDGET.layout) as WaitsWidget["layout"], filters: p?.filter?.widget?.[id] as WaitsWidget["filters"] };
}

export default function Workspace({ initial, narrow }: Props) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const harnessRef = useRef<AgAiHarness | null>(null);
  const rowsRef = useRef<StudioPayload["tables"]>(initial.tables);
  const [payload, setPayload] = useState(initial);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [notice, setNotice] = useState<Extract<ApproveResult, { kind: "paid" }> | null>(null);
  const [theme] = useState(themeFromTokens);

  const refresh = useCallback(async (): Promise<ReceiptLite[]> => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) return [];
    const full = (await res.json()) as { studio: StudioPayload; receipts: ReceiptLite[] };
    const next = full.studio;
    const engine = apiRef.current?.getDataEngine() as unknown as { applyTransaction(tx: unknown[]): Promise<unknown> } | undefined;
    const tx = TABLES.map((t) => {
      const d = diffRows(rowsRef.current[t.id], next.tables[t.id]);
      return { tableId: t.id, add: toCells(t.id, d.add), update: toCells(t.id, d.update), remove: d.remove };
    }).filter((t) => t.add.length || t.update.length || t.remove.length);
    if (engine && tx.length) await engine.applyTransaction(tx);
    rowsRef.current = next.tables;
    setPayload(next);
    return full.receipts ?? [];
  }, []);

  const router = useRouter();
  const checkout = useCallback(async (source: PurchaseSource): Promise<ApproveResult> => {
    const res = await fetch("/api/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source }) });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !data.id) return { kind: "error", text: data.error ?? "Couldn't start the PayPal checkout." };
    router.push(`/checkout/${data.id}`);
    return { kind: "leaving" };
  }, [router]);

  const approve = useCallback<WorkspaceContext["approve"]>(
    async ({ source, amount }) => {
      const res = await fetch("/api/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, approved: { amountCents: Math.round(amount * 100) } }) });
      const data = (await res.json().catch(() => ({}))) as { receiptId?: string; orderId?: string; captureStatus?: string; repeat?: boolean; error?: string; overCap?: boolean; needsCheckout?: boolean; declined?: boolean };
      if (res.ok && data.receiptId) {
        const receipts = await refresh();
        const r = receipts.find((x) => x.id === data.receiptId);
        const status = data.captureStatus === "COMPLETED" ? "Paid" : `PayPal says ${String(data.captureStatus ?? "pending").toLowerCase()}`;
        const text = r
          ? `${status} ${usd.format(r.amountCents / 100)} for ${r.title} with ${r.methodLabel}. PayPal order ${r.orderId}${r.captureId ? `, capture ${r.captureId}` : ""}.${data.repeat ? " Same order as your first yes, charged once." : ""} ${r.shelfNote}`.trim()
          : `${status}. PayPal order ${data.orderId}.`;
        const result: ApproveResult = { kind: "paid", text, receiptHref: `/receipts/${data.receiptId}` };
        setNotice(result);
        return result;
      }
      if (data.overCap || data.needsCheckout) return checkout(source);
      await refresh();
      return { kind: "error", text: data.error ?? "Something went wrong.", reapprove: Boolean(data.declined) };
    },
    [refresh, checkout],
  );

  const context = useMemo<WorkspaceContext>(
    () => ({ approve, checkout, skip: payload.skip, hasMethod: payload.method !== null, capLabel: payload.method ? usd.format(payload.method.capCents / 100) : undefined, simulated: payload.dayOffset > 0 }),
    [approve, checkout, payload.skip, payload.method, payload.dayOffset],
  );

  const data = useMemo(() => ({ sources: sources(initial) }), [initial]);

  const widgets = useMemo(
    () => (base: { menu: unknown[] }) =>
      createWidgets({
        additionalTypes: [
          {
            id: "verdictList",
            label: "Verdicts",
            form: (p: { createDefaults: (o: unknown) => unknown }) => p.createDefaults({ dataMappingItems: [] }),
            comp: VerdictWidget,
            defaultSize: { width: 420, height: 640 },
            minSize: { width: 260, height: 220 },
            ai: { description: `${APP_NAME} verdicts: one card per checked product (skip, wait, buy) with its reason, evidence links and a pay button on buys, then rebuys waiting for the shopper's yes. Reads the verdicts and rebuys tables; needs no field mapping.` },
          },
          {
            id: "budgetFigure",
            label: "Budget left",
            form: (p: { createDefaults: (o: unknown) => unknown }) => p.createDefaults({ dataMappingItems: [] }),
            comp: BudgetWidget,
            defaultSize: { width: 320, height: 240 },
            minSize: { width: 220, height: 160 },
            ai: { description: "Money left this month across the shopper's budgets, with a bar per group. Reads the budgets table; needs no field mapping." },
          },
          {
            id: "skipFigure",
            label: "Skip accuracy",
            form: (p: { createDefaults: (o: unknown) => unknown }) => p.createDefaults({ dataMappingItems: [] }),
            comp: SkipWidget,
            defaultSize: { width: 300, height: 240 },
            minSize: { width: 220, height: 160 },
            ai: { description: "How often skip is right on 30 held-out products it had never seen (the single scored run), beside saying skip to everything, with a link to every case. Needs no data." },
          },
          {
            id: "shelfList",
            label: "Shelf list",
            form: (p: { createDefaults: (o: unknown) => unknown }) => p.createDefaults({ dataMappingItems: [] }),
            comp: ShelfListWidget,
            defaultSize: { width: 320, height: 480 },
            minSize: { width: 220, height: 160 },
            ai: { description: "The shopper's shelf as stacked rows: product, when it runs out and days left. Reads the shelf table; needs no field mapping." },
          },
          {
            id: "watchList",
            label: "Price watches",
            form: (p: { createDefaults: (o: unknown) => unknown }) => p.createDefaults({ dataMappingItems: [] }),
            comp: WatchListWidget,
            defaultSize: { width: 320, height: 240 },
            minSize: { width: 220, height: 120 },
            ai: { description: "Items watched for a price drop as stacked rows, or a short note when nothing is watched. Reads the watch list table; needs no field mapping." },
          },
        ],
        menu: [...base.menu, { label: APP_NAME, widgetIds: ["verdictList", "budgetFigure", "skipFigure", "shelfList", "watchList"] }],
      } as never),
    [],
  );

  const ai = useMemo(
    () =>
      ({ api }: { api: AgStudioApi }) => {
        // One harness for the editor's assistant panel and for Group my waits, built on first need.
        if (harnessRef.current) return harnessRef.current;
        const harness = createAiHarness(api, ({ builtIn, tools }) => {
          const report = api.defineAiTool({
            name: "report_to_looklook",
            description: `Tell ${APP_NAME} that Studio's lead agent finished, so ${APP_NAME} can check the workspace itself.`,
            params: (s: { object: (o: unknown) => unknown; string: (o: unknown) => unknown }) => s.object({ summary: s.string({ description: "One sentence: what the lead said it changed." }) }),
            execute: async (_args: unknown, ctx: { success: (m: string) => unknown }) => {
              const found = addedWidgets(api);
              return ctx.success(found.length ? `${APP_NAME} found the new widget(s) ${found.join(", ")} on the page.` : `${APP_NAME} found no new widget on the page.`);
            },
          } as never);
          const looklook = directLlmRunner({
            id: AGENT_ID,
            name: APP_NAME,
            description: `${APP_NAME}'s own agent. It knows the shopper's verdicts and asks Studio's lead agent for workspace changes.`,
            adapter,
            maxTurns: 10,
            instructions: () =>
              [
                `You are ${APP_NAME}'s agent. ${APP_NAME} decides skip, wait or buy for products a shopper is considering, and keeps their shelf, budgets and rebuys.`,
                "You never build widgets yourself. For any change to the workspace, delegate to Studio's lead agent with delegate_to and a precise instruction.",
                "When asked to group the shopper's waits: ask the lead to add ONE grid widget to the current page, titled 'Waiting for a price drop or next month', that reads the verdicts table with the columns waitingFor, product, price, buyAt and lookAgain, with a widget filter verdict equals 'Wait', sorted by waitingFor. Tell it to leave every other widget as it is and not to create a page.",
                `After the lead reports back, call report_to_looklook once with the lead's summary, then reply in one short sentence. Never state how many rows there are: ${APP_NAME} counts them itself.`,
              ].join("\n"),
            tools: () => [tools.delegateTo(["lead"]), report],
          } as never);
          const builtIns = Object.values(builtIn).map((d) => directLlmRunner({ ...(d as object), adapter } as never));
          return { agents: [looklook, ...builtIns], primary: AGENT_ID, promptStarters: PROMPT_STARTERS } as never;
        });
        harnessRef.current = harness;
        return harness;
      },
    [],
  );

  const [now, setNow] = useState(0);
  const running = useRef(false);
  async function groupWaits() {
    const api = apiRef.current;
    const harness = harnessRef.current;
    if (!api || running.current) return;
    running.current = true;
    const startedAt = Date.now();
    setNow(startedAt);
    let calls = 0;
    setRun({ kind: "running", startedAt, calls, step: "Starting" });
    onTurn = (t) => {
      calls += 1;
      const step = t.tools.map((n) => STEP_WORDS[n]).find(Boolean) ?? (t.ok ? "Thinking" : "A step failed, retrying");
      setRun((r) => (r.kind === "running" ? { ...r, calls, step } : r));
    };
    withWaits(api, payload, null);
    const fallback = (note: string) => {
      withWaits(api, payload, readCache() ?? DEFAULT_WAITS_WIDGET);
      setRun({ kind: "done", seconds: Math.round((Date.now() - startedAt) / 1000), calls, fromCache: true, note });
    };
    let session: AgAiChatSession | null = null;
    try {
      if (!harness) return fallback("The assistant isn't available, so this is the saved table.");
      session = await harness.createThread({ agentId: AGENT_ID, title: "Group my waits" });
      const finished = new Promise<string>((resolve) => {
        let sawRunning = false;
        const timer = window.setTimeout(() => resolve("timeout"), RUN_LIMIT_MS);
        session!.addEventListener("changed", () => {
          const st = session!.status;
          if (st === "running") sawRunning = true;
          if (sawRunning && (st === "idle" || st === "error")) {
            window.clearTimeout(timer);
            resolve(st);
          }
        });
      });
      session.sendMessage("Group my waits: the shopper wants to see what each Wait verdict is waiting for, a price drop or next month's budget.");
      const outcome = await finished;
      if (outcome === "timeout") session.cancel();
      const built = addedWidgets(api).map((id) => [id, snapshot(api, id)] as const).find(([, s]) => s);
      if (outcome !== "idle" || !built) return fallback(outcome === "timeout" ? "The assistant took too long, so this is the saved table." : "The assistant didn't finish, so this is the saved table.");
      withWaits(api, payload, built[1]!, built[0]);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(built[1]));
      } catch {}
      setRun({ kind: "done", seconds: Math.round((Date.now() - startedAt) / 1000), calls, fromCache: false });
    } catch {
      session?.cancel();
      fallback("The assistant didn't finish, so this is the saved table.");
    } finally {
      onTurn = () => undefined;
      running.current = false;
    }
  }

  // Count the running seconds on screen.
  useEffect(() => {
    if (run.kind !== "running") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [run.kind]);

  const waits = waitCounts(payload.tables.verdicts);
  const [initial0] = useState(() => initialState(initial, narrow));
  // The canvas is as tall as its widgets, so the page scrolls, not the canvas. On a phone the widgets stack in one column.
  const tracks = layouts(initial, narrow).tracks + (run.kind !== "idle" ? 10 : 0);
  const canvasHeight = `${Math.max(tracks, 34) * TRACK_PX + (narrow ? 80 : 24)}px`;
  const editing = mode === "edit" && !narrow;

  // The editor's panels are created when it first opens, after the page state was applied, so the
  // assistant and the field list are folded to rails then, with their own headers. Later opens keep
  // whatever the shopper chose.
  const foldedOnce = useRef(false);
  useEffect(() => {
    if (!editing || foldedOnce.current) return;
    foldedOnce.current = true;
    let tries = 0;
    const t = window.setInterval(() => {
      const open = ["ai", "data"].map((id) => document.querySelector<HTMLElement>(`.workspace-canvas .ag-studio-${id}-panel:not(.ag-studio-panel-collapsed) .ag-studio-panel-header`));
      open.forEach((h) => h?.click());
      if (open.some(Boolean) || ++tries > 20) window.clearInterval(t);
    }, 50);
    return () => window.clearInterval(t);
  }, [editing]);

  return (
    <AgStudioProvider licenseKey={LICENSE} modules={[AgStudioAiModule]}>
      <div className={`workspace${narrow ? " narrow" : ""}${editing ? " editing" : ""}`}>
        <div className="workspace-bar">
          <div>
            <h1>Decisions</h1>
            <p className="small muted">Your verdicts, rebuys, shelf and budgets in one place. Built in AG Studio.</p>
          </div>
          {!narrow && (
            <div className="workspace-actions">
              <button className="btn" onClick={groupWaits} disabled={run.kind === "running"} data-testid="group-waits">
                {run.kind === "running" ? "Grouping…" : "Group my waits"}
              </button>
              <button className={`btn outline${editing ? " on" : ""}`} onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))} aria-pressed={editing} data-testid="customize">
                {editing ? "Done customizing" : "Customize"}
              </button>
            </div>
          )}
        </div>
        {payload.sample && <SampleWeekNote />}
        {payload.dayOffset > 0 && (
          <p className="simdate" data-testid="studio-simdate">
            <span className="chip sim">Simulated date: {formatDay(payload.today)}</span>
          </p>
        )}
        {narrow && (
          <div className="workspace-note">
            <p>Grouping your waits with Studio&apos;s agents and changing the layout need a wider screen.</p>
          </div>
        )}
        {!narrow && run.kind !== "idle" && (
          <div className={`workspace-run ${run.kind}${run.kind === "done" && run.fromCache ? " saved" : ""}`} role="status" aria-live="polite">
            {run.kind === "running" ? (
              <>
                <span className="spinner" aria-hidden />
                <span>
                  {APP_NAME}&apos;s agent asked Studio&apos;s agents to build the table. {run.step}, {run.calls} {run.calls === 1 ? "step" : "steps"}, {Math.max(0, Math.round((now - run.startedAt) / 1000))} s.
                </span>
              </>
            ) : (
              <span>
                {run.fromCache ? run.note : `Studio's agents built the table in ${run.seconds} s (${run.calls} steps).`}{" "}
                <strong>
                  {waits.total === 0
                    ? "Nothing is waiting."
                    : `Your ${waits.total === 1 ? "wait" : `${waits.total} waits`}: ${waits.groups.map((g) => `${g.count} for ${g.waitingFor.toLowerCase()}`).join(", ")}.`}
                </strong>
              </span>
            )}
          </div>
        )}
        {notice && (
          <div className="workspace-notice" role="status" data-testid="paid-notice">
            <span>{notice.text}</span>
            <a className="btn small outline" href={notice.receiptHref}>
              Receipt
            </a>
            <button className="btn small outline" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        <div className="workspace-canvas" data-testid="studio" style={canvasHeight ? { height: canvasHeight } : undefined}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            data={data as never}
            mode={editing ? "edit" : "view"}
            initialState={initial0}
            widgets={widgets as never}
            theme={theme}
            layout={{ columns: 24, minWidth: editing ? 760 : 250 } as never}
            responsiveLayoutBreakpoints={[{ maxWidth: 760, layout: singleColumnLayout }] as never}
            context={context}
            panels={{ view: { left: [], right: [] }, edit: { left: ["ai"], right: ["edit", "data"] } }}
            ai={ai as never}
            onApiReady={(e: { api: AgStudioApi }) => {
              apiRef.current = e.api;
              ai({ api: e.api });
            }}
          />
        </div>
      </div>
    </AgStudioProvider>
  );
}
