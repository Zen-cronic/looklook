import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordPaid, sourceDetails, type PaidResult } from "../app/payments";
import { recordSpend } from "../app/budgets";
import { seedState } from "../app/seed";
import { refreshChecks } from "../app/refresh";
import type { SavedMethod, SessionState } from "../app/types";
import { CallBudget, STUDIO_MODEL, toAnthropicRequest, toMessages, toTurnReply } from "./llm";
import { diffRows, studioPayload, TABLES, waitCounts, WAITING_FOR } from "./tables";

const TODAY = "2026-11-10";

function fresh(): SessionState {
  const s = seedState("studiosession01", TODAY, new Date("2026-11-10T15:00:00Z"));
  refreshChecks(s, TODAY);
  return s;
}

const method: SavedMethod = { id: "pm_1", type: "card", vaultId: "v1", label: "Visa ending 1111", capCents: 5000, currency: "USD", consentText: "", consentedAt: "", firstOrderId: "O1", status: "active" };

describe("workspace tables", () => {
  it("every row carries the fields its table declares, and nothing else", () => {
    const p = studioPayload(fresh(), TODAY);
    for (const t of TABLES) {
      const ids = t.fields.map((f) => f.id).sort();
      for (const row of p.tables[t.id]) expect(Object.keys(row).sort()).toEqual(ids);
    }
  });

  it("puts skips first and explains what a wait is waiting for", () => {
    const p = studioPayload(fresh(), TODAY);
    const v = p.tables.verdicts;
    expect(v.length).toBe(3);
    expect(v.map((r) => r.verdict)).toEqual(["Skip", "Skip", "Wait"]);
    const wait = v.find((r) => r.verdict === "Wait")!;
    expect(wait.waitingFor).toBe(WAITING_FOR.price);
    expect(typeof wait.buyAt).toBe("number");
    const cvs = v.find((r) => r.id === "sample-spf-cvs")!;
    expect(cvs.policyUrl).toMatch(/^https:\/\//);
    expect(cvs.returns).toBe("CVS Pharmacy takes opened beauty back with a receipt within 60 days.");
  });

  it("lists due staples as rebuys and says whether they fit the saved method's cap", () => {
    const s = fresh();
    const none = studioPayload(s, TODAY).tables.rebuys;
    expect(none.every((r) => r.withinCap === false)).toBe(true);
    s.methods.push(method);
    const rows = studioPayload(s, TODAY).tables.rebuys;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.sourceKind === "staple" && r.withinCap === true)).toBe(true);
    expect(studioPayload(s, TODAY).method).toEqual({ label: "Visa ending 1111", capCents: 5000 });
  });

  it("orders the shelf by run-out date with undated items last", () => {
    const shelf = studioPayload(fresh(), TODAY).tables.shelf;
    const dated = shelf.filter((r) => r.runOutDate);
    expect(shelf.slice(0, dated.length)).toEqual(dated);
    expect(dated.map((r) => r.runOutDate)).toEqual([...dated.map((r) => r.runOutDate)].sort());
  });

  it("budget figure is the sum of the budget rows", () => {
    const s = fresh();
    recordSpend(s.budgets, TODAY, "skincare", 32);
    const p = studioPayload(s, TODAY);
    expect(p.budget.limit).toBe(510);
    expect(p.budget.spent).toBe(32);
    expect(p.budget.left).toBe(478);
    expect(p.tables.budgets.find((b) => b.id === "skincare")!.left).toBe(43);
  });

  it("counts waits in code, grouped by what they wait for", () => {
    const s = fresh();
    // After a $32 skincare purchase the $72 retinol waits for next month's budget, not a price drop.
    recordSpend(s.budgets, TODAY, "skincare", 32);
    refreshChecks(s, TODAY);
    const p = studioPayload(s, TODAY);
    expect(p.waits).toEqual({ total: 1, groups: [{ waitingFor: WAITING_FOR.budget, count: 1 }] });
    const rows = [...p.tables.verdicts, { ...p.tables.verdicts[2], id: "x", waitingFor: WAITING_FOR.price }];
    expect(waitCounts(rows).groups).toEqual([
      { waitingFor: WAITING_FOR.price, count: 1 },
      { waitingFor: WAITING_FOR.budget, count: 1 },
    ]);
  });

  it("after a rebuy the diff updates the shelf row and removes the rebuy row", () => {
    const s = fresh();
    s.methods.push(method);
    const before = studioPayload(s, TODAY);
    const due = before.tables.rebuys[0];
    const source = { kind: "staple" as const, shelfItemId: String(due.sourceRef), cycle: String(due.cycle) };
    const paid: PaidResult = { outcome: { orderId: "O2", orderStatus: "COMPLETED", captureId: "C2", captureStatus: "COMPLETED", amountCents: Math.round(Number(due.price) * 100), currency: "USD" }, requestId: "rebuy:a", kind: "saved-method", methodLabel: method.label, methodId: method.id };
    recordPaid(s, source, sourceDetails(s, source), paid, TODAY, new Date("2026-11-10T15:00:00Z"));
    const after = studioPayload(s, TODAY);
    const shelf = diffRows(before.tables.shelf, after.tables.shelf);
    expect(shelf.add).toEqual([]);
    expect(shelf.remove).toEqual([]);
    expect(shelf.update.map((r) => r.id)).toContain(due.sourceRef);
    expect(shelf.update.find((r) => r.id === due.sourceRef)!.lastRestocked).toBe("Nov 10, 10:00 AM");
    expect(diffRows(before.tables.rebuys, after.tables.rebuys).remove).toEqual([due.id]);
  });

  it("diff finds added, changed and removed rows by id", () => {
    const d = diffRows(
      [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
      ],
      [
        { id: "b", v: 3 },
        { id: "c", v: 4 },
      ],
    );
    expect(d).toEqual({ add: [{ id: "c", v: 4 }], update: [{ id: "b", v: 3 }], remove: ["a"] });
  });
});

describe("/api/state", () => {
  let GET: () => Promise<Response>;
  beforeAll(async () => {
    process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "looklook-state-"));
    vi.doMock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "statesession0001" }) }), headers: async () => new Headers() }));
    vi.doMock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => undefined }));
    ({ GET } = await import("@/app/api/state/route"));
  });
  afterAll(() => {
    vi.doUnmock("next/headers");
    vi.doUnmock("next/server");
  });

  it("returns the session and the workspace tables from the same store", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.checks.length).toBe(j.studio.tables.verdicts.length);
    expect(j.shelf.length).toBe(j.studio.tables.shelf.length);
    expect(new Set(j.studio.tables.shelf.map((r: { id: string }) => r.id))).toEqual(new Set(j.shelf.map((i: { id: string }) => i.id)));
    expect(j.studio.tables.rebuys.map((r: { sourceRef: string }) => r.sourceRef)).toEqual(j.due.map((d: { id: string }) => d.id));
    expect(j.studio.skip).toEqual({ right: 28, n: 30, alwaysSkip: 13, sameCategory: 19, avoided: 470.25, dev: { right: expect.any(Number), n: 65 } });
    expect(j.studio.waits.total).toBe(j.studio.tables.verdicts.filter((r: { verdict: string }) => r.verdict === "Wait").length);
  });
});

describe("assistant request shaping", () => {
  const msg = (role: "user" | "system", text: string) => ({ id: "m", kind: "input", type: "message", role, status: "completed", content: [{ type: "text", text }] });
  const said = (text: string) => ({ id: "o", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
  const call = (id: string, name: string, args = "{}") => ({ id, kind: "output", type: "function_call", callId: id, name, arguments: args });
  const result = (id: string, output: string) => ({ kind: "input", type: "function_call_output", callId: id, output, status: "completed" });
  const tool = (name: string) => ({ name, description: `${name} tool`, parameters: { type: "object", properties: { x: { type: "string" } } } });

  it("maps tools and messages, keeps the model on the server", () => {
    const body = toAnthropicRequest({ input: [msg("user", "Group my waits")], instructions: "Be brief.", tools: [tool("delegate_to")], responseFormat: { type: "text" } });
    expect(body.model).toBe(STUDIO_MODEL);
    expect(body.system).toBe("Be brief.");
    expect(body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Group my waits" }] }]);
    expect(body.tools).toEqual([{ name: "delegate_to", description: "delegate_to tool", input_schema: { type: "object", properties: { x: { type: "string" } } } }]);
    expect(body.tool_choice).toBeUndefined();
  });

  it("turns a forced tool into an instruction, since the model refuses forced tool choice", () => {
    const named = toAnthropicRequest({ input: [msg("user", "go")], tools: [tool("complete_task")], toolChoice: { name: "complete_task" } });
    expect(named.tool_choice).toBeUndefined();
    expect(named.system).toMatch(/MUST respond now with a call to the tool `complete_task`/);
    const any = toAnthropicRequest({ input: [msg("user", "go")], tools: [tool("a")], toolChoice: "required" });
    expect(any.tool_choice).toBeUndefined();
    expect(any.system).toMatch(/one of your tools/);
    expect(toAnthropicRequest({ input: [msg("user", "go")], tools: [tool("a")], toolChoice: "none" }).tool_choice).toEqual({ type: "none" });
  });

  it("never ends on an assistant turn (no prefill)", () => {
    const { messages } = toMessages([msg("user", "go"), said("Done, here is the summary.")]);
    expect(messages.at(-1)!.role).toBe("user");
    expect(messages.at(-1)!.content[0]).toMatchObject({ type: "text", text: expect.stringMatching(/complete_task/) });
  });

  it("puts tool results first and answers every tool call", () => {
    const { messages } = toMessages([msg("user", "go"), call("t1", "view_page"), call("t2", "view_schema"), msg("user", "also this"), result("t1", "page ok")]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const blocks = messages[2].content;
    expect(blocks.map((b) => b.type)).toEqual(["tool_result", "tool_result", "text"]);
    expect(blocks[0]).toMatchObject({ tool_use_id: "t1", content: "page ok" });
    expect(blocks[1]).toMatchObject({ tool_use_id: "t2", is_error: true });
  });

  it("drops reasoning items, stray results and bad tool names; moves system messages to the system prompt", () => {
    const body = toAnthropicRequest({
      input: [msg("system", "House rules."), msg("user", "go"), { id: "r", kind: "output", type: "reasoning", summary: [] }, result("nope", "orphan"), call("t1", "add_widget", '{"type":"grid"}'), result("t1", "ok")],
      tools: [tool("add_widget"), tool("bad name!")],
      responseFormat: { type: "json", name: "x", schema: { type: "object" } },
    });
    expect(body.system).toContain("House rules.");
    expect(body.system).toMatch(/Respond with JSON only/);
    expect(body.tools!.map((t) => (t as { name: string }).name)).toEqual(["add_widget"]);
    expect(body.messages[1]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "add_widget", input: { type: "grid" } }] });
    expect(JSON.stringify(body.messages)).not.toContain("orphan");
    expect(body.messages.at(-1)!.role).toBe("user");
  });

  it("starts with a user turn even when the input starts with a tool call", () => {
    const { messages } = toMessages([call("t1", "view_page"), result("t1", "ok")]);
    expect(messages[0].role).toBe("user");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("returns only text and tool calls to the browser", () => {
    const reply = toTurnReply({
      id: "msg_1",
      model: STUDIO_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 } as never,
      content: [{ type: "thinking", thinking: "x", signature: "s" } as never, { type: "text", text: "ok", citations: null } as never, { type: "tool_use", id: "t", name: "view_page", input: {} } as never],
    });
    expect(reply.content).toEqual([
      { type: "text", text: "ok" },
      { type: "tool_use", id: "t", name: "view_page", input: {} },
    ]);
    expect(reply.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("limits model calls per session in a rolling window", () => {
    const b = new CallBudget(2, 1000);
    expect(b.take("s", 0)).toBe(true);
    expect(b.take("s", 10)).toBe(true);
    expect(b.take("s", 20)).toBe(false);
    expect(b.take("other", 20)).toBe(true);
    expect(b.take("s", 1011)).toBe(true);
  });
});
