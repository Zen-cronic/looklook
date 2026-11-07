"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ApiError {
  error: string;
  [k: string]: unknown;
}

/** POST/PATCH/DELETE JSON to our API, then refresh the server-rendered page. */
export function useApi() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function call<T = Record<string, unknown>>(key: string, url: string, method: string, body?: unknown, opts: { refresh?: boolean } = {}): Promise<T | null> {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ error: "Something went wrong.", ...data });
        if (opts.refresh !== false) router.refresh();
        return null;
      }
      if (opts.refresh !== false) router.refresh();
      return data as T;
    } catch {
      setError({ error: "Network error. Try again." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  return { call, busy, error, setError, router };
}
