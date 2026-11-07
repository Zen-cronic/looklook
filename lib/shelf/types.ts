import type { Attributes, Category } from "./categories";

export type ShelfSource = "manual" | "app-order" | "paypal-activity";

export interface ShelfItem {
  id: string;
  name: string;
  brand: string;
  category: Category;
  /** Key attributes for this category (actives, finish, form, shade family...). */
  attributes: Attributes;
  opened: boolean;
  /** When the user expects to run out (YYYY-MM-DD); null when unknown or not a consumable. */
  runOutDate: string | null;
  size?: string;
  source: ShelfSource;
  addedOn: string;
}

/** What a user (or an importer) supplies; id, source and date are filled in. */
export type ShelfItemInput = Omit<ShelfItem, "id" | "source" | "addedOn"> & Partial<Pick<ShelfItem, "id" | "source" | "addedOn">>;
