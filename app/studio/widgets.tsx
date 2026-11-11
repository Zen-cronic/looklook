"use client";

import type { AgWidgetParams } from "ag-studio";
import { useEffect, useState } from "react";
import type { PurchaseSource } from "@/lib/app/types";
import { RULE_TEXT } from "@/lib/app/explain";
import type { Cell, SkipFigure } from "@/lib/studio/schema";
import type { RuleId } from "@/lib/verdict/types";
import { Eyebrow } from "../components/Eyebrow";

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
  /** The date control is ahead of today: dates counted from it say so. */
  simulated?: boolean;
  /** Filming mode: the simulated date is said the short way. */
  film?: boolean;
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
const fullDay = (d: Cell | Date | undefined) => (d instanceof Date ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d) : typeof d === "string" && d ? d : "");
const plainDay = (d: Cell | Date | undefined) => (d instanceof Date ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d) : typeof d === "string" && d ? d : "");
/** A date counted from the shopper's today, labelled while the simulated date is on. */
const countedDay = (d: Cell | Date | undefined, simulated?: boolean, film?: boolean) => {
  const text = plainDay(d);
  return text && simulated ? `${text} (${film ? "simulated" : "simulated date"})` : text;
};
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

/** Verdicts, skips first, each with its reason and evidence; a buy can be approved here. Two columns when the widget is wide. */
export function VerdictWidget(params: AgWidgetParams) {
  const ctx = params.context as WorkspaceContext;
  const verdicts = useTable(params, "verdicts");
  if (!verdicts) return <div className="decision-list loading">Loading decisions…</div>;
  // Bought checks go last, under their own state: their reasons describe the day they were decided.
  const isBought = (r: Record<string, Cell | Date>) => r.status === "Bought";
  const sorted = [...verdicts].sort((a, b) => Number(isBought(a)) - Number(isBought(b)) || Number(a.rank) - Number(b.rank));
  const open = sorted.filter((r) => !isBought(r));
  const bought = sorted.length - open.length;
  const counts = ["Skip", "Wait", "Buy"].map((v) => `${open.filter((r) => r.verdict === v).length} ${verdictLabel(v).toLowerCase()}`);
  if (bought) counts.push(`${bought} bought`);
  return (
    <div className="decision-list">
      <div className="decision-head">
        <h2>Verdicts</h2>
        <p className="small muted">{counts.join(", ")}</p>
      </div>
      {sorted.length === 0 && <p className="muted">No checks yet. Check a post on the Check page.</p>}
      <div className="decision-grid">
      {sorted.map((r) => {
        const cls = verdictClass[String(r.verdict)] ?? "ask";
        if (isBought(r)) {
          return (
            <article key={String(r.id)} className="decision bought" data-testid={`verdict-${r.id}`}>
              <div className="decision-top">
                <Eyebrow as="span" icon="receipt">
                  Bought
                </Eyebrow>
                <span className="decision-price num">{money(r.price)}</span>
              </div>
              <h3>{String(r.product)}</h3>
              <p className="small">{r.boughtAt ? `Paid ${String(r.boughtAt)}.` : "Paid."} The verdict was {String(r.verdict).toLowerCase()}.</p>
              <p className="decision-reason muted">{String(r.reason)}</p>
              <div className="decision-links">
                <a className="btn small outline" href={`/check/${r.id}`}>
                  See why
                </a>
              </div>
            </article>
          );
        }
        return (
          <article key={String(r.id)} className={`decision ${cls}${r.payable ? " payable" : ""}`} data-testid={`verdict-${r.id}`}>
            <div className="decision-top">
              <span className="summary-verdict">
                <span className={`chip ${cls}`}>{verdictLabel(r.verdict)}</span>
                <span className="summary-reason">{shortReason(r.rule)}</span>
              </span>
              <span className="decision-price num">{money(r.price)}</span>
            </div>
            <h3>{String(r.product)}</h3>
            <p className="decision-reason">{String(r.reason)}</p>
            {r.waitingFor ? (
              <p className="small muted">
                Waiting for: {String(r.waitingFor).toLowerCase()}
                {r.buyAt ? `, buy at ${money(r.buyAt)} or less` : ""}
                {r.lookAgain ? `, look again ${countedDay(r.lookAgain, ctx.simulated, ctx.film)}` : ""}
              </p>
            ) : null}
            {r.returns ? <p className="decision-returns small">{String(r.returns)}</p> : null}
            <div className="decision-links">
              <a className="btn small outline" href={`/check/${r.id}`}>
                See why
              </a>
              {r.status === "Watching" && <span className="small muted">Watching the price</span>}
            </div>
            {r.payable ? <ApproveButton ctx={ctx} label="Buy" req={{ source: { kind: "check", checkId: String(r.id) }, withinCap: Boolean(r.withinCap), amount: Number(r.price) }} /> : null}
          </article>
        );
      })}
      </div>
    </div>
  );
}

const VERDICT_ORDER = ["Skip", "Wait", "Buy", "Check this"] as const;
/** The words shown for each verdict value in the table. Change a verdict's display word here only. */
export const VERDICT_LABEL: Record<string, string> = { Skip: "Skip", Wait: "Wait", Buy: "Buy", "Check this": "Check this", Bought: "Bought" };
const verdictLabel = (v: unknown) => VERDICT_LABEL[String(v)] ?? String(v);

/** The short reason that goes right next to each verdict chip, per rule. The table carries the rule's full sentence. */
export const SHORT_REASON: Record<RuleId, string> = {
  "identity-unconfirmed": "Not sure which product",
  "owns-unopened": "You have one unopened",
  "run-out-unknown": "Run-out date not set",
  "not-needed-yet": "Yours lasts two more weeks",
  "owns-similar": "You already own one",
  "overlap-non-returnable": "Overlaps, may not go back",
  "price-unknown": "No price shown",
  "over-budget": "Over this month's budget",
  "no-price-history": "Not enough price history",
  "above-usual-price": "Price is higher than usual",
  "replacing-run-out": "Replaces one running out",
  "clear-to-buy": "Worth it, within budget",
};
const BY_RULE_TEXT = new Map(Object.entries(RULE_TEXT).map(([id, text]) => [text, SHORT_REASON[id as RuleId]]));
const shortReason = (rule: unknown) => BY_RULE_TEXT.get(String(rule ?? "")) ?? "";

/** The verdicts at a glance: a count per verdict over one stacked bar, then one short row per product. A buy can be paid here. */
export function VerdictSummaryWidget(params: AgWidgetParams) {
  const ctx = params.context as WorkspaceContext;
  const verdicts = useTable(params, "verdicts");
  if (!verdicts) return <div className="decision-list loading">Loading verdicts…</div>;
  const isBought = (r: Record<string, Cell | Date>) => r.status === "Bought";
  const open = verdicts.filter((r) => !isBought(r)).sort((a, b) => VERDICT_ORDER.indexOf(String(a.verdict) as never) - VERDICT_ORDER.indexOf(String(b.verdict) as never) || Number(a.rank) - Number(b.rank));
  const bought = verdicts.filter(isBought);
  const counts = VERDICT_ORDER.map((v) => ({ v, n: open.filter((r) => r.verdict === v).length })).filter((c) => c.n > 0 || c.v !== "Check this");
  const total = Math.max(1, open.length);
  return (
    <div className="decision-list summary-widget" data-testid="studio-verdicts">
      <div className="decision-head">
        <h2>Verdicts</h2>
        <p className="small muted">{verdicts.length} products checked</p>
      </div>
      {verdicts.length === 0 ? (
        <p className="muted">No checks yet. Check a post on the Check page.</p>
      ) : (
        <>
          <div className="summary-figures">
            {counts.map((c) => (
              <div key={c.v} className={`summary-figure ${verdictClass[c.v]}`}>
                <span className="figure-big num">{c.n}</span>
                <span className="figure-label">
                  <i aria-hidden />
                  {verdictLabel(c.v)}
                </span>
              </div>
            ))}
            {bought.length > 0 && (
              <div className="summary-figure bought">
                <span className="figure-big num">{bought.length}</span>
                <span className="figure-label">Bought</span>
              </div>
            )}
          </div>
          <div className="summary-bar" aria-hidden>
            {counts.map((c) => (c.n ? <span key={c.v} className={verdictClass[c.v]} style={{ flexGrow: c.n / total }} /> : null))}
          </div>
          <ul className="summary-rows">
            {[...open, ...bought].map((r) => {
              const cls = isBought(r) ? "bought" : (verdictClass[String(r.verdict)] ?? "ask");
              return (
                <li key={String(r.id)} data-testid={`verdict-${r.id}`}>
                  <span className="summary-verdict">
                    <span className={`chip ${cls}`}>{verdictLabel(isBought(r) ? "Bought" : r.verdict)}</span>
                    <span className="summary-reason">{isBought(r) ? "Paid" : shortReason(r.rule)}</span>
                  </span>
                  <a className="summary-name" href={`/check/${r.id}`}>
                    {String(r.product)}
                  </a>
                  <span className="num">{money(r.price)}</span>
                  {r.payable && !isBought(r) ? <ApproveButton ctx={ctx} label="Buy" req={{ source: { kind: "check", checkId: String(r.id) }, withinCap: Boolean(r.withinCap), amount: Number(r.price) }} /> : <span />}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** Staples running out and price drops waiting for the shopper's yes, each payable here. */
export function RebuyWidget(params: AgWidgetParams) {
  const ctx = params.context as WorkspaceContext;
  const rebuys = useTable(params, "rebuys");
  if (!rebuys) return <div className="decision-list loading">Loading reorders…</div>;
  return (
    <div className="decision-list">
      <div className="decision-head">
        <h2>Reorders</h2>
        <p className="small muted">{rebuys.length ? `${rebuys.length} waiting` : "Nothing due"}</p>
      </div>
      {rebuys.length === 0 && <p className="small muted">Staples show up five days before they run out, and watched items when the price drops to your target.</p>}
      <div className="decision-grid">
      {rebuys.map((r) => {
        const source: PurchaseSource = r.sourceKind === "watch" ? { kind: "watch", watchId: String(r.sourceRef) } : { kind: "staple", shelfItemId: String(r.sourceRef), cycle: String(r.cycle) };
        const days = typeof r.daysLeft === "number" ? r.daysLeft : null;
        return (
          <article key={String(r.id)} className={`decision rebuy${r.declined ? " declined" : ""}`} data-testid={`rebuy-${r.id}`}>
            <div className="decision-top">
              <Eyebrow as="span" icon={r.sourceKind === "watch" ? "chart" : "clock"}>
                {String(r.kind)}
              </Eyebrow>
              <span className="decision-price num">{money(r.price)}</span>
            </div>
            <h3>{String(r.product)}</h3>
            <p className="small muted">
              {days === null ? "At or under your target price." : days < 0 ? `Ran out ${-days} days ago.` : days === 0 ? "Runs out today." : `Runs out in ${days} ${days === 1 ? "day" : "days"} (${plainDay(r.runOutDate)}${ctx.simulated ? (ctx.film ? ", simulated" : ", simulated date") : ""}).`}
              {r.store ? ` Last bought at ${String(r.store)}.` : ""}
            </p>
            {r.declined ? <p className="decision-error">{String(r.declined)}. Nothing was charged.</p> : null}
            {r.held ? (
              <p className="small muted">On hold: {String(r.held)}.</p>
            ) : r.declined ? (
              <ApproveReapprove ctx={ctx} source={source} />
            ) : (
              <ApproveButton ctx={ctx} label={r.sourceKind === "watch" ? "Buy" : "Reorder"} req={{ source, withinCap: Boolean(r.withinCap), amount: Number(r.price) }} />
            )}
          </article>
        );
      })}
      </div>
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
  const maxCap = Math.max(1, ...rows.map((r) => Number(r.limit ?? 0)));
  const whole = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  return (
    <div className="figure-widget budget-widget" data-testid="studio-budget">
      <div className="figure-label">Budget left this month</div>
      <div className="figure-big num">{whole(left)}</div>
      <div className="small figure-gloss">of {whole(limit)}</div>
      <ul className="budget-bars">
        {rows.map((r) => {
          // One bar per budget, as long as its monthly limit (against the largest), filled with what's left.
          const cap = Number(r.limit);
          const leftN = Math.max(0, Number(r.left));
          const pct = cap > 0 ? Math.max(0, Math.min(100, Math.round((leftN / cap) * 100))) : 0;
          const length = cap > 0 ? Math.max(12, Math.round((cap / maxCap) * 100)) : 0;
          return (
            <li key={String(r.id)}>
              <span className="budget-name">{String(r.group)}</span>
              <span className="budget-track" style={{ width: `${length}%` }} aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="num">{whole(leftN)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** How often skip is right: the held-out run, beside the two simple baselines, with the development set second. */
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
        right on {skip.n} products it had never seen. Same category: {skip.sameCategory}. Skip everything: {skip.alwaysSkip}.
      </div>
      <a className="btn small outline" href="/proof">
        See every case
      </a>
    </div>
  );
}

/** The shelf as stacked rows, for a phone: product, when it runs out, days left. */
export function ShelfListWidget(params: AgWidgetParams) {
  const ctx = params.context as WorkspaceContext;
  const rows = useTable(params, "shelf");
  if (!rows) return <div className="decision-list loading">Loading the shelf…</div>;
  const sorted = [...rows].sort((a, b) => (typeof a.daysLeft === "number" ? a.daysLeft : 1e9) - (typeof b.daysLeft === "number" ? b.daysLeft : 1e9));
  return (
    <div className="decision-list">
      <div className="decision-head">
        <h2>Shelf</h2>
        <p className="small muted">{rows.length} items</p>
      </div>
      <ul className="stack-rows">
        {sorted.map((r) => {
          const days = typeof r.daysLeft === "number" ? r.daysLeft : null;
          return (
            <li key={String(r.id)}>
              <span className="name-line">{String(r.product)}</span>
              <span className="small muted">
                {days === null ? "No run-out date" : days < 0 ? `Ran out ${-days} days ago` : days === 0 ? "Runs out today" : `${days} ${days === 1 ? "day" : "days"} left, runs out ${countedDay(r.runOutDate, ctx.simulated, ctx.film)}`}
                {r.price ? `. ${money(r.price)} last time` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Days left as the shelf table shows it: a pink pill when it runs out within six days, or already has. */
function DaysCell({ days }: { days: number | null }) {
  if (days === null) return null;
  if (days <= 6) {
    const text = days < 0 ? `${-days} ${days === -1 ? "day" : "days"} ago` : days === 0 ? "Today" : `${days} ${days === 1 ? "day" : "days"}`;
    return <span className="due soon">{text}</span>;
  }
  return <>{days}</>;
}

/** The shelf as a table in the app's own type: product, when it runs out, days left and the last price. */
export function ShelfTableWidget(params: AgWidgetParams) {
  const ctx = params.context as WorkspaceContext;
  const rows = useTable(params, "shelf");
  if (!rows) return <div className="decision-list loading">Loading the shelf…</div>;
  const sorted = [...rows].sort((a, b) => (typeof a.daysLeft === "number" ? a.daysLeft : 1e9) - (typeof b.daysLeft === "number" ? b.daysLeft : 1e9));
  return (
    <div className="decision-list shelf-widget" data-testid="studio-shelf">
      <div className="decision-head">
        <h2>Shelf</h2>
        <p className="small muted">{rows.length} items</p>
      </div>
      <div className="shelf-table-wrap">
        <table className="shelf-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Runs out{ctx.simulated ? " (simulated date)" : ""}</th>
              <th className="num">Days left</th>
              <th className="num">Last price</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const days = typeof r.daysLeft === "number" ? r.daysLeft : null;
              return (
                <tr key={String(r.id)}>
                  <td>{String(r.product)}</td>
                  <td className="mono">{fullDay(r.runOutDate)}</td>
                  <td className="num">
                    <DaysCell days={days} />
                  </td>
                  <td className="num">{money(r.price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Items watched for a price drop. With none watched, the price waits instead: what each is waiting for. */
export function WatchListWidget(params: AgWidgetParams) {
  const rows = useTable(params, "watchlist");
  const verdicts = useTable(params, "verdicts");
  useEffect(() => {
    (params.widgetApi as unknown as WidgetApiLike).setDisplayState("displayed");
  }, [params]);
  const watched = rows ?? [];
  const priceWaits = (verdicts ?? []).filter((r) => r.verdict === "Wait" && typeof r.buyAt === "number" && r.status !== "Bought");
  const list = watched.length
    ? watched.map((r) => ({ id: String(r.id), product: String(r.product), now: r.currentPrice, target: r.targetPrice }))
    : priceWaits.map((r) => ({ id: String(r.id), product: String(r.product), now: r.price, target: r.buyAt }));
  return (
    <div className="decision-list watch-widget" data-testid="studio-watches">
      <div className="decision-head">
        <h2>{watched.length ? "Price watches" : "Waiting for a lower price"}</h2>
      </div>
      {list.length === 0 ? (
        <p className="small muted">Nothing is waiting for a lower price.</p>
      ) : (
        <ul className="watch-rows">
          {list.map((r) => {
            const now = Number(r.now);
            const target = Number(r.target);
            const pct = now > 0 ? Math.max(4, Math.min(100, Math.round((target / now) * 100))) : 0;
            return (
              <li key={r.id}>
                <span className="name-line">{r.product}</span>
                <span className="watch-figures">
                  <span>
                    <span className="figure-label">Buy at</span>
                    <span className="watch-target num">{money(target)}</span>
                  </span>
                  <span>
                    <span className="figure-label">Now</span>
                    <span className="num">{money(now)}</span>
                  </span>
                </span>
                <span className="watch-bar" aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
