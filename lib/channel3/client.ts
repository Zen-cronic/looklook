import { cacheKey, type ResponseCache } from "./cache";

export const CHANNEL3_API_BASE = "https://api.trychannel3.com";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class Channel3Error extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    detail: string,
  ) {
    super(`Channel3 ${status} on ${path}: ${detail}`);
    this.name = "Channel3Error";
  }
}

export class CallBudgetExceededError extends Error {
  constructor(readonly maxCalls: number) {
    super(`Channel3 call budget of ${maxCalls} reached`);
    this.name = "CallBudgetExceededError";
  }
}

export class CacheMissError extends Error {
  constructor(readonly path: string) {
    super(`No cached response for ${path} and network calls are off`);
    this.name = "CacheMissError";
  }
}

export interface Channel3ClientOptions {
  apiKey?: string;
  fetch?: FetchLike;
  /** Responses are read from and written to this cache when given. */
  cache?: ResponseCache;
  /** Stop after this many network calls (cache hits are free). */
  maxCalls?: number;
  /** When false, only cached responses are used. */
  network?: boolean;
}

export class Channel3Client {
  private readonly apiKey?: string;
  private readonly fetchImpl: FetchLike;
  private readonly cache?: ResponseCache;
  private readonly maxCalls: number;
  private readonly network: boolean;
  calls = 0;
  cacheHits = 0;

  constructor(options: Channel3ClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.CHANNEL3_API_KEY;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.cache = options.cache;
    this.maxCalls = options.maxCalls ?? Number.POSITIVE_INFINITY;
    this.network = options.network ?? true;
  }

  async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, opts: { cacheable?: boolean } = {}): Promise<T> {
    const cacheable = (opts.cacheable ?? method !== "DELETE") && this.cache !== undefined;
    const key = cacheKey(method, path, body);
    if (cacheable) {
      const hit = this.cache!.get(key);
      if (hit !== undefined) {
        this.cacheHits += 1;
        return hit as T;
      }
    }
    if (!this.network) throw new CacheMissError(path);
    if (!this.apiKey) throw new Error("CHANNEL3_API_KEY is not set");
    if (this.calls >= this.maxCalls) throw new CallBudgetExceededError(this.maxCalls);
    this.calls += 1;
    const res = await this.fetchImpl(`${CHANNEL3_API_BASE}${path}`, {
      method,
      headers: { "x-api-key": this.apiKey, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Channel3Error(res.status, path, text.slice(0, 200));
    const data = (text ? JSON.parse(text) : {}) as T;
    if (cacheable) this.cache!.set(key, data);
    return data;
  }
}
