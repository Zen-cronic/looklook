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
  /** What the shopper last paid, used for rebuys (dollars). */
  price?: number;
  /** Catalogue product id, when known. */
  productId?: string;
  /** Where it was last bought. */
  store?: string;
  /** Roughly how many days one unit lasts; a rebuy moves the run-out date on by this. */
  cycleDays?: number;
  /** YYYY-MM-DD of the last restock through the app. */
  lastRestockedOn?: string;
}

/** What a user (or an importer) supplies; id, source and date are filled in. */
export type ShelfItemInput = Omit<ShelfItem, "id" | "source" | "addedOn"> & Partial<Pick<ShelfItem, "id" | "source" | "addedOn">>;
