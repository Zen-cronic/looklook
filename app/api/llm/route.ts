import Anthropic from "@anthropic-ai/sdk";
import { handle, HttpError, sessionIdOrThrow } from "@/lib/app/http";
import { envInt, GlobalBudget, guardTurn, SERVER_SYSTEM } from "@/lib/studio/guard";
import { CallBudget, STUDIO_MAX_TOKENS, STUDIO_MODEL, toAnthropicRequest, toTurnReply, TurnShapeError, type StudioTurn } from "@/lib/studio/llm";

let client: Anthropic | undefined;
// One "Group my waits" run takes about 13 calls; this allows a few runs and the chat panel per session.
const perSession = new CallBudget(envInt("STUDIO_CALLS_PER_10_MIN", 80), 10 * 60 * 1000);
// Every session together: forged or fresh sessions can't add up to unlimited use.
const allSessions = new GlobalBudget(envInt("LLM_CALLS_PER_HOUR", 600), 60 * 60 * 1000);
const MAX_BODY = 400_000;
const BUSY = "The assistant is busy right now. Try again in a few minutes.";

/** One turn for the Decisions workspace's agents, answered by Claude. */
export async function POST(request: Request) {
  return handle(async () => {
    const sid = await sessionIdOrThrow();
    if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, "The assistant isn't set up on this server.");
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new HttpError(413, "That conversation is too long. Start a new chat.");
    let turn: StudioTurn;
    try {
      turn = JSON.parse(raw) as StudioTurn;
    } catch {
      throw new HttpError(400, "Expected a JSON body.");
    }
    let body;
    let guarded;
    try {
      guarded = guardTurn(turn);
      body = toAnthropicRequest(guarded.turn, { model: process.env.STUDIO_MODEL ?? STUDIO_MODEL, maxTokens: Math.min(envInt("LLM_MAX_TOKENS", STUDIO_MAX_TOKENS), STUDIO_MAX_TOKENS), serverSystem: SERVER_SYSTEM });
    } catch (e) {
      if (e instanceof TurnShapeError) throw new HttpError(400, e.message);
      throw e;
    }
    if (!perSession.take(sid)) throw new HttpError(429, "Too many assistant requests in the last few minutes. Try again shortly.");
    if (!allSessions.take()) throw new HttpError(429, BUSY);
    client ??= new Anthropic();
    const t0 = Date.now();
    try {
      const msg = await client.messages.create(body);
      console.log(`[studio-llm] ${msg.model} agent=${guarded.agent} ${Date.now() - t0}ms stop=${msg.stop_reason} tools=${body.tools?.length ?? 0}${guarded.dropped.length ? ` dropped=${guarded.dropped.join(",")}` : ""} out=${msg.content.map((b) => (b.type === "tool_use" ? `tool:${b.name}` : b.type)).join(",")} in=${msg.usage.input_tokens} outTok=${msg.usage.output_tokens}`);
      return Response.json(toTurnReply(msg));
    } catch (e) {
      if (e instanceof Anthropic.APIError) {
        console.error(`[studio-llm] ${e.status} ${Date.now() - t0}ms ${e.message.slice(0, 200)}`);
        throw new HttpError(502, "The assistant couldn't answer just now.", { status: e.status });
      }
      throw e;
    }
  });
}
