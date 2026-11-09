"use client";

import { useState } from "react";
import { CATEGORY_LABELS, KEY_DETAIL, kebab } from "@/lib/app/shelf-ui";
import { CATEGORIES, type Category } from "@/lib/shelf/categories";
import { leave } from "./motion";
import { useApi } from "./useApi";

/** How soon an item runs out, as the row shows it: a big numeral when it is due soon. */
export interface DueLabel {
  kind: "soon" | "out" | "later" | "none";
  big?: string;
  label: string;
  title?: string;
}

/** One shelf item: the whole row opens its edit controls. */
export function ShelfRow(props: { id: string; brand: string; kind: string; name: string; sub: string; opened: boolean; runOutDate: string | null; due: DueLabel }) {
  const [editing, setEditing] = useState(false);
  const dueText = [props.due.big, props.due.label].filter(Boolean).join(" ");
  return (
    <>
      <button type="button" className="shelf-row" aria-expanded={editing} aria-label={`Edit ${props.name}${dueText ? `, ${dueText}` : ""}`} onClick={() => setEditing((e) => !e)}>
        <span className="swatch" aria-hidden="true">
          {props.brand.replace(/[^A-Za-z0-9]/g, "").charAt(0) || "?"}
        </span>
        <span className="shelf-text">
          <span className="sub">
            {props.brand}, {props.kind}
          </span>
          <span className="title">{props.name}</span>
          {props.sub && <span className="sub">{props.sub}</span>}
        </span>
        <span className={`due ${props.due.kind}`} title={props.due.title}>
          {props.due.big && <strong>{props.due.big}</strong>}
          {props.due.label && <span>{props.due.label}</span>}
        </span>
        <svg className="go row-go" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </button>
      {editing && <ShelfRowControls id={props.id} opened={props.opened} runOutDate={props.runOutDate} onDone={() => setEditing(false)} />}
    </>
  );
}

function ShelfRowControls({ id, opened, runOutDate, onDone }: { id: string; opened: boolean; runOutDate: string | null; onDone: () => void }) {
  const { call, busy, error } = useApi();
  const [date, setDate] = useState(runOutDate ?? "");
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
      <button className="btn outline small" onClick={onDone}>
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
