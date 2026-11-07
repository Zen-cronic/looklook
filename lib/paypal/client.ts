import { PAYPAL_API_BASE, credentialsFromEnv, negativeTestingEnabled, type PayPalCredentials } from "./config";
import { NegativeTestingDisabledError, PayPalApiError, classifyPayPalError, type PayPalIssue } from "./errors";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PayPalRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  /** A JSON value, or a pre-serialised string sent as is. */
  body?: unknown;
  /** Required on every POST. */
  requestId?: string;
  /** Sandbox negative testing code, for example INSTRUMENT_DECLINED. */
  mockApplicationCode?: string;
  headers?: Record<string, string>;
}

export interface PayPalResponse<T> {
  status: number;
  body: T;
  debugId?: string;
}

export interface PayPalClientOptions {
  credentials?: PayPalCredentials;
  fetch?: FetchLike;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

/** Refresh the token this long before PayPal says it expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export class PayPalClient {
  private readonly credentials: () => PayPalCredentials;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly env: NodeJS.ProcessEnv;
  private token?: { value: string; expiresAt: number };
  private pendingToken?: Promise<string>;

  constructor(options: PayPalClientOptions = {}) {
    this.env = options.env ?? process.env;
    const fixed = options.credentials;
    this.credentials = () => fixed ?? credentialsFromEnv(this.env);
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  /** OAuth client-credentials token, cached until shortly before expiry. */
  async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS) return this.token.value;
    if (!this.pendingToken) {
      this.pendingToken = this.fetchToken().finally(() => {
        this.pendingToken = undefined;
      });
    }
    return this.pendingToken;
  }

  invalidateToken(): void {
    this.token = undefined;
  }

  private async fetchToken(): Promise<string> {
    const { clientId, clientSecret } = this.credentials();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new PayPalApiError(res.status, "AUTHENTICATION_FAILURE", "Could not get a PayPal access token", [], res.headers.get("paypal-debug-id") ?? undefined);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expiresAt: this.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  async request<T>(req: PayPalRequest): Promise<PayPalResponse<T>> {
    if (req.method === "POST" && !req.requestId) {
      throw new Error(`PayPal-Request-Id is required on POST ${req.path}`);
    }
    if (req.mockApplicationCode && !negativeTestingEnabled(this.env)) {
      throw new NegativeTestingDisabledError();
    }
    const first = await this.send<T>(req);
    if (first.status !== 401) return this.finish(first);
    this.invalidateToken();
    return this.finish(await this.send<T>(req));
  }

  private async send<T>(req: PayPalRequest): Promise<PayPalResponse<T>> {
    const url = new URL(req.path, PAYPAL_API_BASE);
    if (url.origin !== PAYPAL_API_BASE) throw new Error("PayPal requests must go to the sandbox API");
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      Accept: "application/json",
      ...req.headers,
    };
    let body: string | undefined;
    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }
    if (req.requestId) headers["PayPal-Request-Id"] = req.requestId;
    if (req.mockApplicationCode) {
      headers["PayPal-Mock-Response"] = JSON.stringify({ mock_application_codes: req.mockApplicationCode });
    }
    const res = await this.fetchImpl(url.toString(), { method: req.method, headers, body });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 200) };
      }
    }
    return { status: res.status, body: parsed as T, debugId: res.headers.get("paypal-debug-id") ?? undefined };
  }

  private finish<T>(res: PayPalResponse<T>): PayPalResponse<T> {
    if (res.status >= 200 && res.status < 300) return res;
    const b = (res.body ?? {}) as { name?: string; message?: string; details?: PayPalIssue[]; debug_id?: string; error?: string };
    const err = new PayPalApiError(
      res.status,
      b.name ?? b.error ?? "UNKNOWN_ERROR",
      b.message ?? "PayPal request failed",
      Array.isArray(b.details) ? b.details : [],
      b.debug_id ?? res.debugId,
    );
    throw classifyPayPalError(err);
  }
}

let shared: PayPalClient | undefined;

/** Process-wide client so the OAuth token is reused across requests. */
export function getPayPalClient(): PayPalClient {
  shared ??= new PayPalClient();
  return shared;
}
