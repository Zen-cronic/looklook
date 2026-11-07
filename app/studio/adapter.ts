import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from "ag-studio";

/** What one model turn did, for the progress line. */
export interface TurnInfo {
  ms: number;
  tools: string[];
  ok: boolean;
}

interface ReplyBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface Reply {
  id: string;
  model: string;
  content: ReplyBlock[];
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

/**
 * The workspace's agents ask for one model turn at a time. This sends each
 * turn to our own /api/llm (Claude, key on the server) and hands the answer
 * back as the events and output items the workspace expects.
 */
export function claudeAdapter(endpoint: string, onTurn?: (t: TurnInfo) => void): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options?: { signal?: AbortSignal }): AgLlmResponseHandler {
      let resolve!: (r: AgLlmResponse) => void;
      let reject!: (e: Error) => void;
      const complete = new Promise<AgLlmResponse>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      complete.catch(() => undefined);

      async function* run(): AsyncGenerator<AgAiEvent> {
        const t0 = performance.now();
        try {
          const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: options?.signal });
          const json = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as Reply;
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
          const output: AgAiOutputItem[] = [];
          for (const block of json.content ?? []) {
            if (block.type === "text" && block.text) {
              const messageId = `${json.id}-t${output.length}`;
              yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" } as AgAiEvent;
              yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: block.text } as AgAiEvent;
              yield { type: "TEXT_MESSAGE_END", messageId } as AgAiEvent;
              output.push({ id: messageId, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: block.text, annotations: [] }] });
            } else if (block.type === "tool_use" && block.id && block.name) {
              const args = JSON.stringify(block.input ?? {});
              yield { type: "TOOL_CALL_START", toolCallId: block.id, toolCallName: block.name } as AgAiEvent;
              yield { type: "TOOL_CALL_ARGS", toolCallId: block.id, delta: args } as AgAiEvent;
              yield { type: "TOOL_CALL_END", toolCallId: block.id } as AgAiEvent;
              output.push({ id: block.id, kind: "output", type: "function_call", callId: block.id, name: block.name, arguments: args, status: "completed" });
            }
          }
          onTurn?.({ ms: performance.now() - t0, tools: (json.content ?? []).filter((b) => b.type === "tool_use").map((b) => b.name ?? ""), ok: true });
          resolve({
            id: json.id,
            createdAt: Date.now(),
            status: "completed",
            output,
            model: json.model,
            usage: json.usage ? ({ inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens } as AgLlmResponse["usage"]) : undefined,
          });
        } catch (e) {
          onTurn?.({ ms: performance.now() - t0, tools: [], ok: false });
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
      const it = run();
      return { stream: { [Symbol.asyncIterator]: () => it }, complete };
    },
  };
}
