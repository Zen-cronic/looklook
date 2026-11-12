"use client";

import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { AgStudioAiModule, createAiHarness, directLlmRunner, singleColumnLayout, studioTheme } from "ag-studio";
import type { AgAiChatSession, AgAiHarness, AgReportState, AgStudioApi } from "ag-studio";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_NAME } from "@/lib/brand";
import type { WeekView } from "@/lib/app/week";
import { diffRows, type Row } from "@/lib/studio/schema";
import { SLIP_TABLE, slipAgentInstructions, slipRows } from "@/lib/studio/slip";
import { claudeAdapter, type TurnInfo } from "./adapter";
import { setSlipState, WeekSlipWidget, type SlipContext } from "./slip-widget";

const LICENSE = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;
const PAGE_ID = "week";
const AGENT_ID = "slip";
const RUN_LIMIT_MS = 60_000;

let onTurn: (t: TurnInfo) => void = () => undefined;
const adapter = claudeAdapter("/api/llm", (t) => onTurn(t));

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Requests the assistant box offers; each goes to the order assistant as typed. */
const STARTERS = ["Leave the cleanser for next week", "Put everything back in the order"];

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
    studioCanvasRowHeight: "20px",
    studioMinWidth: 0,
  } as Parameters<typeof studioTheme.withParams>[0]);
}

function slipSource(rows: Row[]) {
  return {
    id: SLIP_TABLE.id,
    name: SLIP_TABLE.name,
    description: SLIP_TABLE.description,
    primaryKeyField: "id",
    transactions: "all" as const,
    data: rows,
    fields: SLIP_TABLE.fields.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      blankValue: "",
      format: f.kind === "money" ? "currencyFormat" : "textFormat",
      ...(f.kind === "money" ? { formatOptions: { format: usd } } : {}),
    })),
  };
}

function initialState(): AgReportState {
  return {
    pages: [
      {
        id: PAGE_ID,
        name: "This week",
        widgets: {
          slip: { type: "weekSlip", dataMapping: {} },
        },
        widgetLayout: { slip: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 18 } },
      },
    ],
    selectedPageId: PAGE_ID,
  } as unknown as AgReportState;
}

type AskState = { kind: "idle" } | { kind: "running"; request: string; steps: number } | { kind: "done"; request: string; changes: string[]; found: string[]; note?: string };

export default function WeekWorkspace({ initial, runId, narrow }: { initial: WeekView; runId: string; narrow: boolean }) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const harnessRef = useRef<AgAiHarness | null>(null);
  const viewRef = useRef(initial);
  const rowsRef = useRef<Row[]>(slipRows(initial));
  const changesRef = useRef<string[]>([]);
  const foundRef = useRef<string[]>([]);
  const [view, setViewState] = useState(initial);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [was, setWas] = useState<number | undefined>(undefined);
  const [ask, setAsk] = useState<AskState>({ kind: "idle" });
  const [text, setText] = useState("");
  const [theme] = useState(themeFromTokens);
  const [state0] = useState(() => {
    setSlipState({ view: initial, paying: false, message: null });
    return initialState();
  });
  const router = useRouter();

  /** Show a new state of the week: the widget re-renders from it, and the grid gets only the rows that changed. */
  const show = useCallback(async (next: WeekView) => {
    viewRef.current = next;
    setViewState(next);
    const rows = slipRows(next);
    const d = diffRows(rowsRef.current, rows);
    rowsRef.current = rows;
    const engine = apiRef.current?.getDataEngine() as unknown as { applyTransaction(tx: unknown[]): Promise<unknown> } | undefined;
    if (engine && (d.add.length || d.update.length || d.remove.length)) await engine.applyTransaction([{ tableId: SLIP_TABLE.id, add: d.add, update: d.update, remove: d.remove }]);
  }, []);

  /** Take an item off the week's order or put it back (the assistant's tools call this). Returns what our code saw happen. */
  const change = useCallback(
    async (key: string, action: "leave" | "back"): Promise<{ ok: boolean; text: string }> => {
      const before = viewRef.current;
      const title = [...before.slip.lines, ...before.slip.leftOff].find((l) => l.approvalKey === key)?.title ?? key;
      const res = await fetch(`/api/week/${runId}/slip`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approvalKey: key, action }) });
      const data = (await res.json().catch(() => ({}))) as WeekView & { error?: string };
      if (!res.ok) return { ok: false, text: data.error ?? "That didn't change this week's order." };
      await show(data);
      const done = action === "leave" ? `Moved ${title} to Left for next week.` : `Put ${title} back in this week's order.`;
      changesRef.current.push(done);
      return { ok: true, text: `${done} It now has ${data.slip.lines.length} ${data.slip.lines.length === 1 ? "item" : "items"}.` };
    },
    [runId, show],
  );

  /** Read what PayPal recorded for a paid item (PayPal's Agent Toolkit, read only, on the server). */
  const lookUp = useCallback(
    async (key: string): Promise<string> => {
      const res = await fetch(`/api/week/${runId}/paypal?key=${encodeURIComponent(key)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) return data.error ?? "PayPal's record couldn't be read just now.";
      foundRef.current.push(data.text);
      return data.text;
    },
    [runId],
  );

  const yes = useCallback(async () => {
    const v = viewRef.current;
    if (v.slip.lines.length > 0 && !v.slip.methodId) {
      router.push(`/week?run=${runId}`);
      return;
    }
    setPaying(true);
    setMessage(null);
    const res = await fetch(`/api/week/${runId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hash: v.slip.hash }) });
    const data = (await res.json().catch(() => ({}))) as WeekView & { error?: string };
    if (res.ok) {
      await show(data);
      const paid = data.sent.filter((l) => l.status === "paid" && v.slip.lines.some((x) => x.approvalKey === l.approvalKey));
      setMessage(`Paid ${usd.format(paid.reduce((n, l) => n + l.amountCents, 0) / 100)}: ${paid.map((l) => `${l.title}, PayPal order ${l.orderId}`).join("; ")}.`);
    } else {
      setMessage(data.error ?? "The payment didn't go through. Nothing was charged.");
      const again = await fetch(`/api/week/${runId}`, { cache: "no-store" });
      if (again.ok) await show((await again.json()) as WeekView);
    }
    setPaying(false);
  }, [runId, show, router]);

  useEffect(() => setSlipState({ view, paying, message, was }), [view, paying, message, was]);
  const yesRef = useRef(yes);
  useEffect(() => {
    yesRef.current = yes;
  }, [yes]);
  const [context] = useState<SlipContext>(() => ({ yes: () => void yesRef.current() }));
  const data = useMemo(() => ({ sources: [slipSource(slipRows(initial))] }), [initial]);

  const widgets = useMemo(
    () => (base: { menu: unknown[] }) =>
      createWidgets({
        additionalTypes: [
          {
            id: "weekSlip",
            label: "This week's order",
            form: (p: { createDefaults: (o: unknown) => unknown }) => p.createDefaults({ dataMappingItems: [] }),
            comp: WeekSlipWidget,
            defaultSize: { width: 380, height: 480 },
            minSize: { width: 260, height: 240 },
            ai: { description: `${APP_NAME}'s order for this week: the items one yes would pay, each as its own PayPal payment, their total and the yes button. Needs no field mapping.` },
          },
        ],
        menu: [...base.menu, { label: APP_NAME, widgetIds: ["weekSlip"] }],
      } as never),
    [],
  );

  const ai = useMemo(
    () =>
      ({ api }: { api: AgStudioApi }) => {
        if (harnessRef.current) return harnessRef.current;
        const harness = createAiHarness(api, () => {
          type Params = { object: (o: unknown) => unknown; string: (o: unknown) => unknown };
          const keyParam = (s: Params) => s.object({ key: s.string({ description: "The item's key, exactly as listed in your instructions." }) });
          const run = (action: "leave" | "back") => async (args: { key?: string }, ctx: { success: (m: string) => unknown }) => {
            const r = await change(String(args?.key ?? ""), action);
            return ctx.success(r.text);
          };
          const leave = api.defineAiTool({ name: "leave_for_later", description: "Move one item from this week's order to Left for next week. Nothing is paid, and the item stays listed there.", params: keyParam, execute: run("leave") } as never);
          const back = api.defineAiTool({ name: "put_back", description: "Put one item that was left for later back in this week's order.", params: keyParam, execute: run("back") } as never);
          const paypal = api.defineAiTool({ name: "check_with_paypal", description: "Read what PayPal recorded for one paid item, through PayPal's Agent Toolkit: its PayPal order, status, amount and any refund. Read only. It cannot pay or refund.", params: keyParam, execute: async (args: { key?: string }, ctx: { success: (m: string) => unknown }) => ctx.success(await lookUp(String(args?.key ?? ""))) } as never);
          const slipAgent = directLlmRunner({
            id: AGENT_ID,
            name: APP_NAME,
            description: `${APP_NAME}'s order assistant. It moves items out of this week's order or puts them back, and it cannot pay.`,
            adapter,
            maxTurns: 6,
            instructions: () => slipAgentInstructions(viewRef.current),
            tools: () => [leave, back, paypal],
          } as never);
          return { agents: [slipAgent], primary: AGENT_ID } as never;
        });
        harnessRef.current = harness;
        return harness;
      },
    [change, lookUp],
  );

  const running = useRef(false);
  async function askAgent(request: string) {
    const harness = harnessRef.current;
    if (!harness || running.current || !request.trim()) return;
    running.current = true;
    changesRef.current = [];
    foundRef.current = [];
    const before = viewRef.current.slip.totalCents;
    let steps = 0;
    setAsk({ kind: "running", request, steps });
    onTurn = () => {
      steps += 1;
      setAsk({ kind: "running", request, steps });
    };
    let session: AgAiChatSession | null = null;
    try {
      session = await harness.createThread({ agentId: AGENT_ID, title: request.slice(0, 60) });
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
      session.sendMessage(request);
      const outcome = await finished;
      if (outcome === "timeout") session.cancel();
      const changes = [...changesRef.current];
      setWas(changes.length ? before : undefined);
      setAsk({ kind: "done", request, changes, found: [...foundRef.current], note: outcome === "idle" ? undefined : "The assistant didn't finish." });
    } catch {
      session?.cancel();
      setAsk({ kind: "done", request, changes: [...changesRef.current], found: [...foundRef.current], note: "The assistant isn't available right now. The order is unchanged." });
    } finally {
      onTurn = () => undefined;
      running.current = false;
    }
  }

  const busy = ask.kind === "running";
  return (
    <AgStudioProvider licenseKey={LICENSE} modules={[AgStudioAiModule]}>
      <div className={`workspace week-workspace${narrow ? " narrow" : ""}`}>
        <div className="workspace-bar">
          <div className="workspace-title">
            <h1>This week&apos;s order</h1>
            <p className="small muted">Built with AG Studio</p>
          </div>
          <div className="workspace-actions">
            <Link className="btn outline" href={`/week?run=${runId}`}>
              Back to the week
            </Link>
          </div>
        </div>
        <div className="week-grid">
        <div className="workspace-canvas" data-testid="studio-week" style={{ height: "360px" }}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            data={data as never}
            mode="view"
            initialState={state0}
            widgets={widgets as never}
            theme={theme}
            layout={{ columns: 24, minWidth: 250 } as never}
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
        <form
          className="slip-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void askAgent(text);
          }}
        >
          <label htmlFor="slip-ask-input">Change this order</label>
          <div className="slip-ask-row">
            <input id="slip-ask-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Leave the cleanser for next week" disabled={busy} data-testid="slip-ask-input" />
            <button className="btn" type="submit" disabled={busy || !text.trim()} data-testid="slip-ask">
              {busy ? "Asking…" : "Ask"}
            </button>
          </div>
          <div className="slip-starters">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="btn outline small" disabled={busy} onClick={() => (setText(s), void askAgent(s))}>
                {s}
              </button>
            ))}
          </div>
          {ask.kind !== "idle" && (
            <p className={`slip-ask-status ${ask.kind}`} role="status" aria-live="polite" data-testid="slip-ask-status">
              {ask.kind === "running" ? (
                <>
                  <span className="spinner" aria-hidden />
                  <span>Working on it</span>
                </>
              ) : (
                <span>
                  <strong>{ask.changes.length ? ask.changes.join(" ") : ask.found.length ? ask.found.join(" ") : "The order didn't change."}</strong> {ask.note ?? ""} Nothing was paid.
                </span>
              )}
            </p>
          )}
          <p className="slip-ask-limit">The assistant can change this order. Only you can pay.</p>
        </form>
        </div>
      </div>
    </AgStudioProvider>
  );
}
