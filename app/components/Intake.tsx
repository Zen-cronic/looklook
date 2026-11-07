"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Sample } from "@/lib/app/samples";

const STEPS = ["Reading the post", "Finding it in the catalogue", "Checking your shelf, budget and the store's return policy"];

export function Intake({ samples }: { samples: Sample[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2600);
    return () => clearInterval(t);
  }, [busy]);

  async function send(form: FormData) {
    setStep(0);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/check", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work. Try again.");
      router.push(`/check/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function sendFile(file: File | undefined) {
    if (!file) return;
    const f = new FormData();
    f.set("image", file);
    void send(f);
  }

  if (busy) {
    return (
      <div className="card working" role="status" aria-live="polite">
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
        <strong>Add a screenshot</strong>
        <span className="muted">A creator post or a store page. PNG or JPEG, up to 5 MB.</span>
        <span className="btn outline small" aria-hidden>
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
