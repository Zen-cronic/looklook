import type Anthropic from "@anthropic-ai/sdk";

/**
 * The Decisions workspace's agents send one turn at a time in a
 * provider-neutral shape (input items, instructions, JSON-schema tools, a tool
 * choice and a response format). This turns that into a Claude Messages
 * request. The key stays on the server and the model is chosen here.
 */

export const STUDIO_MODEL = "claude-sonnet-5-5";
export const STUDIO_MAX_TOKENS = 4096;

type Json = Record<string, unknown>;

export interface StudioTurn {
  input?: unknown;
  instructions?: unknown;
  tools?: unknown;
  toolChoice?: unknown;
  responseFormat?: unknown;
}

type Block = Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam;
interface Msg {
  role: "user" | "assistant";
  content: Block[];
}

export class TurnShapeError extends Error {}

const asArray = (x: unknown): Json[] => (Array.isArray(x) ? (x.filter((v) => v && typeof v === "object") as Json[]) : []);
const str = (x: unknown): string => (typeof x === "string" ? x : "");

function textOf(content: unknown): string {
  return asArray(content)
    .map((c) => (c.type === "text" ? str(c.text) : c.type === "refusal" ? str(c.refusal) : ""))
    .filter(Boolean)
    .join("\n");
}

function parseArgs(raw: unknown): Json {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Json;
  try {
    const v = JSON.parse(str(raw) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Input items to Claude messages: alternating roles, tool results first in their user turn, every tool call answered. */
export function toMessages(input: unknown): { system: string[]; messages: Msg[] } {
  const system: string[] = [];
  const messages: Msg[] = [];
  const push = (role: Msg["role"], block: Block) => {
    const last = messages.at(-1);
    if (last && last.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const item of asArray(input)) {
    if (item.type === "message" && item.kind === "input") {
      const text = textOf(item.content);
      if (item.role === "system") {
        if (text) system.push(text);
      } else if (text) push("user", { type: "text", text });
    } else if (item.type === "message" && item.kind === "output") {
      const text = textOf(item.content);
      if (text) push("assistant", { type: "text", text });
    } else if (item.type === "function_call") {
      const id = str(item.callId) || str(item.id);
      if (id && str(item.name)) push("assistant", { type: "tool_use", id, name: str(item.name), input: parseArgs(item.arguments) });
    } else if (item.type === "function_call_output") {
      const id = str(item.callId);
      if (id) push("user", { type: "tool_result", tool_use_id: id, content: str(item.output) || "(no output)" });
    }
    // Reasoning items and images are not sent back.
  }

  // Claude needs a result for every tool call in the very next user turn.
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const calls = m.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use").map((b) => b.id);
    if (!calls.length) continue;
    let next = messages[i + 1];
    if (!next || next.role !== "user") {
      next = { role: "user", content: [] };
      messages.splice(i + 1, 0, next);
    }
    const answered = new Set(next.content.filter((b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result").map((b) => b.tool_use_id));
    for (const id of calls) if (!answered.has(id)) next.content.push({ type: "tool_result", tool_use_id: id, content: "Not run.", is_error: true });
  }
  // Tool results must come before any text in a user turn; results for calls not in the previous turn are dropped.
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const prev = messages[i - 1];
    const asked = new Set(prev?.role === "assistant" ? prev.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use").map((b) => b.id) : []);
    const results = m.content.filter((b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result" && asked.has(b.tool_use_id));
    const rest = m.content.filter((b) => b.type !== "tool_result");
    m.content = [...results, ...rest];
  }
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].content.length === 0) messages.splice(i, 1);
  // Merge any same-role neighbours left by the removals.
  for (let i = messages.length - 1; i > 0; i--) {
    if (messages[i].role === messages[i - 1].role) {
      messages[i - 1].content.push(...messages[i].content);
      messages.splice(i, 1);
    }
  }

  // The model doesn't take a prefilled assistant turn; the workspace sometimes ends on one before it wants complete_task.
  if (messages.at(-1)?.role === "assistant") {
    messages.push({ role: "user", content: [{ type: "text", text: "Continue. If your task is finished, call complete_task with your summary." }] });
  }
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: [{ type: "text", text: "(continue)" }] });
  return { system, messages };
}

function toTools(tools: unknown): Anthropic.Tool[] {
  return asArray(tools)
    .filter((t) => /^[a-zA-Z0-9_-]{1,64}$/.test(str(t.name)))
    .map((t) => {
      const params = t.parameters as Json | undefined;
      return {
        name: str(t.name),
        description: str(t.description),
        input_schema: (params && params.type === "object" ? params : { type: "object", properties: {} }) as Anthropic.Tool.InputSchema,
      };
    });
}

/**
 * The workspace forces a tool ("required" or a named tool, for example
 * complete_task at the end of a delegated task). This model refuses forced
 * tool choice, so the request stays on auto and the system prompt says which
 * tool to call.
 */
function forcedTool(choice: unknown): { forced: string | null; choice?: Anthropic.ToolChoice } {
  if (choice === "required") return { forced: "one of your tools" };
  if (choice === "none") return { forced: null, choice: { type: "none" } };
  if (choice && typeof choice === "object" && str((choice as Json).name)) return { forced: `the tool \`${str((choice as Json).name)}\`` };
  return { forced: null };
}

export function toAnthropicRequest(turn: StudioTurn, opts: { model?: string; maxTokens?: number } = {}): Anthropic.MessageCreateParamsNonStreaming {
  if (!turn || typeof turn !== "object") throw new TurnShapeError("Expected a turn object.");
  const { system, messages } = toMessages(turn.input);
  if (str(turn.instructions)) system.unshift(str(turn.instructions));
  const format = turn.responseFormat as Json | undefined;
  if (format && (format.type === "json" || format.type === "json_schema")) {
    system.push(`Respond with JSON only, matching this schema:\n${JSON.stringify(format.schema ?? {})}`);
  }
  const tools = toTools(turn.tools);
  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: opts.model ?? STUDIO_MODEL,
    max_tokens: opts.maxTokens ?? STUDIO_MAX_TOKENS,
    messages,
  };
  if (tools.length) {
    body.tools = tools;
    const { forced, choice } = forcedTool(turn.toolChoice);
    if (forced) system.push(`You MUST respond now with a call to ${forced}. Do not reply with text only.`);
    if (choice) body.tool_choice = choice;
  }
  if (system.length) body.system = system.join("\n\n");
  return body;
}

export type ReplyBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

/** What the browser adapter needs back: content blocks, ids and usage, nothing else. */
export function toTurnReply(msg: Pick<Anthropic.Message, "id" | "model" | "content" | "stop_reason" | "usage">) {
  return {
    id: msg.id,
    model: msg.model,
    stop_reason: msg.stop_reason,
    content: msg.content.flatMap((b): ReplyBlock[] => (b.type === "text" ? [{ type: "text", text: b.text }] : b.type === "tool_use" ? [{ type: "tool_use", id: b.id, name: b.name, input: b.input }] : [])),
    usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
  };
}

/** A per-session budget of model calls in a rolling window, so the endpoint can't be used as a free model. */
export class CallBudget {
  private calls = new Map<string, number[]>();
  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}
  take(key: string, now = Date.now()): boolean {
    const recent = (this.calls.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.calls.set(key, recent);
      return false;
    }
    recent.push(now);
    this.calls.set(key, recent);
    if (this.calls.size > 5000) for (const [k, v] of this.calls) if (!v.some((t) => now - t < this.windowMs)) this.calls.delete(k);
    return true;
  }
}
