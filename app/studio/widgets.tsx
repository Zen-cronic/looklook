"use client";

import type { AgWidgetParams } from "ag-studio";
import { useEffect, useState } from "react";
import type { PurchaseSource } from "@/lib/app/types";
import type { Cell, SkipFigure } from "@/lib/studio/schema";

export interface ApproveRequest {
  source: PurchaseSource;
  withinCap: boolean;
  amount: number;
}

export type ApproveResult = { kind: "paid"; text: string; receiptHref: string } | { kind: "leaving" } | { kind: "error"; text: string; reapprove?: boolean };

export interface WorkspaceContext {
  approve(req: ApproveRequest): Promise<ApproveResult>;
  checkout(source: PurchaseSource): Promise<ApproveResult>;
  skip?: SkipFigure;
  hasMethod: boolean;
  capLabel?: string;
}

type Rows = Array<Record<string, Cell | Date>>;

interface SchemaField {
  key: string;
}

interface DataResponse {
  replaced?: boolean;
  results?: { rows: Array<Record<string, Cell | Date>> };
}

interface WidgetApiLike {
  getSchema(): Array<{ fields: SchemaField[] }>;
  getData(query: unknown, opts: { queryId: string }): Promise<DataResponse>;
  setDisplayState(state: string): void;
}

/** Read one table's rows through the workspace's data engine; re-reads when the table changes. */
function useTable(params: AgWidgetParams, table: string): Rows | null {
  const [rows, setRows] = useState<Rows | null>(null);
  useEffect(() => {
    let live = true;
    const api = params.widgetApi as unknown as WidgetApiLike;
    (async () => {
      const fields = api
        .getSchema()
        .flatMap((t) => t.fields)
        .filter((f) => String(f.key).split(".")[0] === table);
      if (!fields.length) return;
      const res = await api.getData({ fields }, { queryId: table });
      if (!live || res.replaced || !res.results) return;
      setRows(
        res.results.rows.map((r) => {
          const o: Record<string, Cell | Date> = {};
          for (const f of fields) o[String(f.key).split(".")[1]] = r[f.key];
          return o;
        }),
      );
      api.setDisplayState("displayed");
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [params, table]);
  return rows;
}

const money = (n: Cell | Date | undefined) => (typeof n === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n) : "");
const day = (d: Cell | Date | undefined) => (d instanceof Date ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d) : typeof d === "string" && d ? d : "");
const verdictClass: Record<string, string> = { Skip: "skip", Wait: "wait", Buy: "buy", "Check this": "ask" };

function ApproveButton({ ctx, req, label }: { ctx: WorkspaceContext; req: ApproveRequest; label: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApproveResult | null>(null);
  const capped = ctx.hasMethod && !req.withinCap;
  const text = !ctx.hasMethod ? `${label} with PayPal` : capped ? `Above your ${ctx.capLabel} cap: pay with PayPal` : `Yes, ${label.toLowerCase()} for ${money(req.amount)}`;
  async function go(fn: () => Promise<ApproveResult>) {
    setBusy(true);
    setResult(null);
    const r = await fn();
    if (r.kind !== "leaving") {
      setResult(r);
      setBusy(false);
    }
  }
  return (
    <div className="decision-act">
      {result?.kind === "paid" ? (
        <p className="decision-paid" role="status">
          {result.text}{" "}
          <a href={result.receiptHref}>Receipt</a>
        </p>
      ) : (
        <>
          {result?.kind === "error" && <p className="decision-error">{result.text}</p>}
          {result?.kind === "error" && result.reapprove ? (
            <button className="btn small" disabled={busy} onClick={() => go(() => ctx.checkout(req.source))}>
              {busy ? "Opening…" : "Approve with another card or PayPal"}
            </button>
          ) : (
            <button className="btn small" disabled={busy} onClick={() => go(() => (ctx.hasMethod && req.withinCap ? ctx.approve(req) : ctx.checkout(req.source)))}>
              {busy ? (ctx.hasMethod && req.withinCap ? "Paying…" : "Opening…") : text}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Verdicts, skips first, each with its reason and evidence; buys and due rebuys can be approved here. */
export function VerdictWidget(params: AgWidgetParams) {
  const ctx = params.context as WorkspaceContext;
  const verdicts = useTable(params, "verdicts");
  const rebuys = useTable(params, "rebuys");
  if (!verdicts || !rebuys) return <div className="decision-list loading">Loading decisions…</div>;
  const sorted = [...verdicts].sort((a, b) => Number(a.rank) - Number(b.rank));
  const counts = ["Skip", "Wait", "Buy"].map((v) => [v, sorted.filter((r) => r.verdict === v).length] as const);
  return (
    <div className="decision-list">
      <div className="decision-head">
        <h2>Verdicts</h2>
        <p className="small muted">{counts.map(([v, n]) => `${n} ${v.toLowerCase()}`).join(", ")}</p>
      </div>
      {sorted.length === 0 && <p className="muted">No checks yet. Check a post on the Check page.</p>}
      {sorted.map((r) => {
        const cls = verdictClass[String(r.verdict)] ?? "ask";
        return (
          <article key={String(r.id)} className={`decision ${cls}`} data-testid={`verdict-${r.id}`}>
            <div className="decision-top">
              <span className={`chip ${cls}`}>{String(r.verdict)}</span>
              <span className="decision-price num">{money(r.price)}</span>
            </div>
            <h3>{String(r.product)}</h3>
            <p className="decision-reason">{String(r.reason)}</p>
            {r.waitingFor ? (
              <p className="small muted">
                Waiting for: {String(r.waitingFor).toLowerCase()}
                {r.buyAt ? `, buy at ${money(r.buyAt)} or less` : ""}
                {r.lookAgain ? `, look again ${day(r.lookAgain)}` : ""}
              </p>
            ) : null}
            {r.returns ? <p className="small muted">{String(r.returns)}</p> : null}
            <div className="decision-links">
              <a className="btn small outline" href={`/check/${r.id}`}>
                See why
              </a>
              {r.policyUrl ? (
                <a className="btn small outline" href={String(r.policyUrl)} target="_blank" rel="noreferrer">
                  Store policy
                </a>
              ) : null}
              {r.status === "Bought" && <span className="small muted">Bought</span>}
              {r.status === "Watching" && <span className="small muted">Watching the price</span>}
            </div>
            {r.payable ? <ApproveButton ctx={ctx} label="Buy" req={{ source: { kind: "check", checkId: String(r.id) }, withinCap: Boolean(r.withinCap), amount: Number(r.price) }} /> : null}
          </article>
        );
      })}

      <div className="decision-head" style={{ marginTop: "1.25rem" }}>
        <h2>Needs your yes</h2>
        <p className="small muted">{rebuys.length ? `${rebuys.length} waiting` : "Nothing due"}</p>
      </div>
      {rebuys.length === 0 && <p className="small muted">Staples show up five days before they run out, and watched items when the price drops to your target.</p>}
      {rebuys.map((r) => {
        const source: PurchaseSource = r.sourceKind === "watch" ? { kind: "watch", watchId: String(r.sourceRef) } : { kind: "staple", shelfItemId: String(r.sourceRef), cycle: String(r.cycle) };
        const days = typeof r.daysLeft === "number" ? r.daysLeft : null;
        return (
          <article key={String(r.id)} className={`decision rebuy${r.declined ? " declined" : ""}`} data-testid={`rebuy-${r.id}`}>
            <div className="decision-top">
              <span className="chip">{String(r.kind)}</span>
              <span className="decision-price num">{money(r.price)}</span>
            </div>
            <h3>{String(r.product)}</h3>
            <p className="small muted">
              {days === null ? "At or under your target price." : days < 0 ? `Ran out ${-days} days ago.` : days === 0 ? "Runs out today." : `Runs out in ${days} ${days === 1 ? "day" : "days"} (${day(r.runOutDate)}).`}
              {r.store ? ` Last bought at ${String(r.store)}.` : ""}
            </p>
            {r.declined ? <p className="decision-error">{String(r.declined)}. Nothing was charged.</p> : null}
            {r.held ? (
              <p className="small muted">On hold: {String(r.held)}.</p>
            ) : r.declined ? (
              <ApproveReapprove ctx={ctx} source={source} />
            ) : (
              <ApproveButton ctx={ctx} label={r.sourceKind === "watch" ? "Buy" : "Rebuy"} req={{ source, withinCap: Boolean(r.withinCap), amount: Number(r.price) }} />
            )}
          </article>
        );
      })}
    </div>
  );
}

function ApproveReapprove({ ctx, source }: { ctx: WorkspaceContext; source: PurchaseSource }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="decision-act">
      <button
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await ctx.checkout(source);
          if (r.kind !== "leaving") setBusy(false);
        }}
      >
        {busy ? "Opening…" : "Approve with another card or PayPal"}
      </button>
    </div>
  );
}

/** Money left this month, overall and per budget group. */
export function BudgetWidget(params: AgWidgetParams) {
  const rows = useTable(params, "budgets");
  if (!rows) return <div className="figure-widget loading">Loading budgets…</div>;
  const left = rows.reduce((s, r) => s + Number(r.left ?? 0), 0);
  const limit = rows.reduce((s, r) => s + Number(r.limit ?? 0), 0);
  return (
    <div className="figure-widget">
      <div className="figure-label">Left this month</div>
      <div className="figure-big num">{money(left)}</div>
      <div className="small muted">of {money(limit)} across your budgets</div>
      <ul className="budget-bars">
        {rows.map((r) => {
          const pct = Number(r.limit) > 0 ? Math.min(100, Math.round((Number(r.spent) / Number(r.limit)) * 100)) : 0;
          return (
            <li key={String(r.id)}>
              <span>{String(r.group)}</span>
              <span className="bar" aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="num small">{money(r.left)} left</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** How often skip is right on the 65-case test, beside saying skip to everything. */
export function SkipWidget(params: AgWidgetParams) {
  const skip = (params.context as WorkspaceContext).skip;
  useEffect(() => {
    (params.widgetApi as unknown as WidgetApiLike).setDisplayState("displayed");
  }, [params]);
  if (!skip) return <div className="figure-widget loading">Loading…</div>;
  return (
    <div className="figure-widget skip">
      <div className="figure-label">How often skip is right</div>
      <div className="figure-big num">
        {skip.right} of {skip.n}
      </div>
      <div className="small muted">
        test products. Saying skip to everything gets {skip.alwaysSkip} of {skip.n}.
      </div>
      <a className="btn small outline" href="/proof">
        See every case
      </a>
    </div>
  );
}
