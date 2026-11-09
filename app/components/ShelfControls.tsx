"use client";

import { useState } from "react";
import { CATEGORY_LABELS, KEY_DETAIL, kebab } from "@/lib/app/shelf-ui";
import { CATEGORIES, type Category } from "@/lib/shelf/categories";
import { leave } from "./motion";
import { useApi } from "./useApi";

export function ShelfRowControls({ id, opened, runOutDate }: { id: string; opened: boolean; runOutDate: string | null }) {
  const { call, busy, error } = useApi();
  const [date, setDate] = useState(runOutDate ?? "");
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div className="controls">
        <button className="btn outline small" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  }
  return (
    <div className="controls">
      <button className="btn outline small" disabled={!!busy} onClick={() => call("open", `/api/shelf/${id}`, "PATCH", { opened: !opened })}>
        {opened ? "Mark unopened" : "Mark opened"}
      </button>
      <label className="small" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        Runs out
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => date !== (runOutDate ?? "") && call("date", `/api/shelf/${id}`, "PATCH", { runOutDate: date || null })} />
      </label>
      {date !== (runOutDate ?? "") && (
        <button className="btn small" disabled={!!busy} onClick={() => call("date", `/api/shelf/${id}`, "PATCH", { runOutDate: date || null })}>
          Save date
        </button>
      )}
      <button
        className="btn danger small"
        disabled={!!busy}
        onClick={async (e) => {
          const undo = await leave(e.currentTarget.closest("li"));
          if (!(await call("remove", `/api/shelf/${id}`, "DELETE"))) undo();
        }}
      >
        Remove
      </button>
      <button className="btn outline small" onClick={() => setEditing(false)}>
        Done
      </button>
      {error && <span className="error small">{error.error}</span>}
    </div>
  );
}

export function AddShelfItem() {
  const { call, busy, error } = useApi();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("serum");
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [opened, setOpened] = useState(true);
  const [runOut, setRunOut] = useState("");
  const [price, setPrice] = useState("");
  const key = KEY_DETAIL[category];

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Add something you own
      </button>
    );
  }

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await call("add", "/api/shelf", "POST", {
          brand,
          name,
          category,
          opened,
          runOutDate: runOut || null,
          price: price ? Number(price) : undefined,
          attributes: detail ? { [key.key]: kebab(detail) } : {},
        });
        if (ok) {
          setBrand("");
          setName("");
          setDetail("");
          setRunOut("");
          setPrice("");
          setOpen(false);
        }
      }}
    >
      <h2>Add to your shelf</h2>
      {error && <p className="error">{error.error}</p>}
      <div className="field-row">
        <label className="field">
          Brand
          <input type="text" value={brand} onChange={(e) => setBrand(e.target.value)} required />
        </label>
        <label className="field">
          Product
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {key.label}
          <input type="text" placeholder={key.placeholder} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          Runs out around
          <input type="date" value={runOut} onChange={(e) => setRunOut(e.target.value)} />
        </label>
        <label className="field">
          Price you pay (USD)
          <input type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={opened} onChange={(e) => setOpened(e.target.checked)} />
        Already opened
      </label>
      <div className="actions">
        <button className="btn" disabled={!!busy}>
          {busy ? "Adding…" : "Add to shelf"}
        </button>
        <button type="button" className="btn outline" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function BudgetEditor({ group, label, limit }: { group: string; label: string; limit: number | null }) {
  const { call, busy, error } = useApi();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(limit === null ? "" : String(limit));
  if (!editing) {
    return (
      <button className="btn small on-field" onClick={() => setEditing(true)} aria-label={`Change the ${label} budget`}>
        Change
      </button>
    );
  }
  return (
    <form
      style={{ display: "flex", gap: "0.4rem", gridColumn: "1 / -1" }}
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await call("budget", "/api/budgets", "PUT", { group, limit: value === "" ? null : Number(value) });
        if (ok) setEditing(false);
      }}
    >
      <input type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`${label} monthly budget in dollars`} placeholder="No limit" />
      <button className="btn small on-field fill" disabled={!!busy}>
        Save
      </button>
      {error && <span className="error small">{error.error}</span>}
    </form>
  );
}
