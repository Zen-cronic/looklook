import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isCategory, type Attributes } from "./categories";
import type { ShelfItem, ShelfItemInput } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ShelfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShelfValidationError";
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Check and normalise one item (manual add, import, or a fixture). */
export function validateShelfItem(input: ShelfItemInput): ShelfItem {
  const name = input.name?.trim();
  const brand = input.brand?.trim() ?? "";
  if (!name) throw new ShelfValidationError("name is required");
  if (!isCategory(input.category)) throw new ShelfValidationError(`unknown category ${String(input.category)}`);
  if (typeof input.opened !== "boolean") throw new ShelfValidationError("opened must be true or false");
  if (input.runOutDate !== null && input.runOutDate !== undefined && !DATE.test(input.runOutDate)) throw new ShelfValidationError("runOutDate must be YYYY-MM-DD");
  const attributes: Attributes = {};
  for (const [k, v] of Object.entries(input.attributes ?? {})) {
    if (typeof v === "string" && v.trim()) attributes[k] = v.trim();
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) attributes[k] = v.map((x) => x.trim()).filter(Boolean);
  }
  return {
    id: input.id ?? randomUUID(),
    name,
    brand,
    category: input.category,
    attributes,
    opened: input.opened,
    runOutDate: input.runOutDate ?? null,
    ...(input.size ? { size: input.size } : {}),
    source: input.source ?? "manual",
    addedOn: input.addedOn ?? today(),
  };
}

export interface ShelfStore {
  list(): ShelfItem[];
  get(id: string): ShelfItem | undefined;
  add(input: ShelfItemInput): ShelfItem;
  update(id: string, patch: Partial<Omit<ShelfItem, "id">>): ShelfItem;
  remove(id: string): boolean;
}

/** In-memory shelf (tests, the demo shopper). */
export class MemoryShelfStore implements ShelfStore {
  protected items: ShelfItem[];

  constructor(items: ShelfItemInput[] = []) {
    this.items = items.map(validateShelfItem);
  }

  list(): ShelfItem[] {
    return this.items.map((i) => ({ ...i }));
  }

  get(id: string): ShelfItem | undefined {
    const i = this.items.find((x) => x.id === id);
    return i && { ...i };
  }

  add(input: ShelfItemInput): ShelfItem {
    const item = validateShelfItem(input);
    if (this.items.some((x) => x.id === item.id)) throw new ShelfValidationError(`item ${item.id} already exists`);
    this.items.push(item);
    this.persist();
    return { ...item };
  }

  update(id: string, patch: Partial<Omit<ShelfItem, "id">>): ShelfItem {
    const idx = this.items.findIndex((x) => x.id === id);
    if (idx < 0) throw new ShelfValidationError(`no item ${id}`);
    const next = validateShelfItem({ ...this.items[idx], ...patch, id });
    this.items[idx] = next;
    this.persist();
    return { ...next };
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    if (this.items.length !== before) this.persist();
    return this.items.length !== before;
  }

  protected persist(): void {}
}

/** Shelf kept in one JSON file, written atomically. */
export class JsonShelfStore extends MemoryShelfStore {
  constructor(private readonly file: string) {
    super(existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { items: ShelfItemInput[] }).items : []);
  }

  protected persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ items: this.items }, null, 2));
    renameSync(tmp, this.file);
  }
}
