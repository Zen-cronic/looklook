"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import type { Sample } from "@/lib/app/samples";
import type { SharedInput } from "@/lib/app/share";

const STEPS = ["Reading the post", "Finding it in the catalogue", "Checking your shelf, budget and the store's return policy"];

/**
 * The check form. `shared` comes from a phone's share sheet (/check?url=…,
 * ?text=…, ?shared=…): a link or a shared screenshot is checked at once,
 * with the same request, limits and error messages as the form.
 */
export function Intake({ samples, shared }: { samples: Sample[]; shared?: SharedInput }) {
  const router = useRouter();
  const autoStart = shared && shared.kind !== "error" ? shared : undefined;
  const [busy, setBusy] = useState(Boolean(autoStart));
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(shared?.kind === "error" ? shared.message : null);
  const started = useRef(false);
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2600);
    return () => clearInterval(t);
  }, [busy]);

  function send(form: FormData) {
    setStep(0);
    setBusy(true);
    setError(null);
    void post(form);
  }

  /** Ask for the check and open its verdict; the busy state is already showing. */
  async function post(form: FormData) {
    try {
      const res = await fetch("/api/check", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work. Try again.");
      // Leave the busy state with the navigation, so Back shows the form again, not a spinner.
      startTransition(() => {
        router.push(`/check/${data.id}`);
        setBusy(false);
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Clear the share from the address bar, so a reload or Back doesn't check it again.
    if (shared) window.history.replaceState(null, "", "/check");
    if (!autoStart) return;
    const f = new FormData();
    if (autoStart.kind === "url") f.set("url", autoStart.url);
    else f.set("shared", autoStart.token);
    // Busy from the first render, so only the request is left to start.
    void post(f);
    // Runs once, for the share this page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sendFile(file: File | undefined) {
    if (!file) return;
    const f = new FormData();
    f.set("image", file);
    void send(f);
  }

  if (busy) {
    return (
      <div className="card working" role="status" aria-live="polite" data-testid={autoStart ? "shared-check" : undefined}>
        <span className="spinner" aria-hidden />
        <span>{STEPS[step]}…</span>
      </div>
    );
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <label
        className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          sendFile(e.dataTransfer.files[0]);
        }}
      >
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => sendFile(e.target.files?.[0])} />
        <svg className="drop-icon" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
          <rect x="11" y="4" width="22" height="36" rx="5" />
          <path d="M17 31l4.5-6 3.5 4 2.5-3 3.5 5" />
          <circle cx="18.5" cy="15.5" r="2" />
        </svg>
        <strong>Add a screenshot</strong>
        <span className="hint">A post or store page. PNG or JPEG, up to 5&nbsp;MB.</span>
        <span className="btn" aria-hidden>
          Choose image
        </span>
      </label>
      <div className="or">or paste a store link</div>
      <form
        className="link-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData();
          f.set("url", url);
          void send(f);
        }}
      >
        <input type="url" inputMode="url" placeholder="https://www.ulta.com/p/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Store link" required />
        <button className="btn" type="submit">
          Check
        </button>
      </form>
      <div className="stack-sm">
        <h2>Or try a post</h2>
        <div className="samples">
          {samples.map((s) => (
            <button
              key={s.id}
              type="button"
              className="sample"
              onClick={() => {
                const f = new FormData();
                f.set("sample", s.id);
                void send(f);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/samples/${s.file}`} alt={s.alt} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
