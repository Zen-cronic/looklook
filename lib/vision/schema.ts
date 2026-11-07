import { CATEGORIES, type Attributes, type Category } from "../shelf/categories";

/** What the reader pulls out of a screenshot. Every field is structured; nothing is free text for the policy. */
export interface ScreenshotFields {
  /** False when the image doesn't show a product at all. */
  isProduct: boolean;
  brand: string | null;
  productName: string | null;
  /** Shade, colour, scent or model variant shown. */
  variant: string | null;
  /** Size as printed, e.g. "30 ml", "1.7 fl oz". */
  size: string | null;
  price: { amount: number; currency: string } | null;
  source: "creator-post" | "store-page" | "other";
  /** Store name or domain if one is visible. */
  store: string | null;
  category: Category | "other";
  attributes: ReaderAttributes;
  /** 0..1: how legible and unambiguous the product identity is in the image. */
  legibility: number;
}

/** Key attributes the reader may fill; an empty string means not visible or not applicable. */
export interface ReaderAttributes {
  primaryActive: string;
  actives: string[];
  texture: string;
  filter: "chemical" | "mineral" | "";
  area: "face" | "body" | "face-body" | "";
  spfBand: "under-30" | "30-49" | "50+" | "";
  finish: string;
  form: string;
  use: "rinse-out" | "leave-in" | "mask" | "";
  coverage: "sheer" | "light" | "medium" | "full" | "";
  shadeFamily: string;
  tint: "clear" | "tinted" | "";
  effect: string;
  formula: string;
  purpose: string;
  style: "over-ear" | "on-ear" | "earbuds" | "";
  noiseCancelling: "yes" | "no" | "";
  type: string;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const str = { type: "string" };
const nstr = nullable(str);
/** Attributes use "" for "not shown" rather than null: structured output limits how many fields may be unions. */
const astr = (description: string) => ({ type: "string", description: `${description}. Empty string if not shown.` });
const aenum = (values: string[]) => ({ type: "string", enum: [...values, ""] });

const ATTRIBUTE_PROPS = {
  primaryActive: astr("Main active ingredient in kebab-case, e.g. vitamin-c, niacinamide, retinol, hyaluronic-acid, peptides"),
  actives: { type: "array", items: str, description: "All named actives, kebab-case; empty if none shown" },
  texture: astr("Moisturizer texture: cream, gel-cream, lotion, balm"),
  filter: aenum(["chemical", "mineral"]),
  area: { ...aenum(["face", "body", "face-body"]), description: "Where a sunscreen is for. Empty string if not shown." },
  spfBand: aenum(["under-30", "30-49", "50+"]),
  finish: astr("matte, natural, radiant, dewy, sheer, satin"),
  form: astr("cream, foam, gel, liquid, stick, powder, oil, serum"),
  use: aenum(["rinse-out", "leave-in", "mask"]),
  coverage: aenum(["sheer", "light", "medium", "full"]),
  shadeFamily: astr("nude, pink, red, berry, peach, coral, brown, clear"),
  tint: aenum(["clear", "tinted"]),
  effect: astr("Mascara effect: volumizing, lengthening, curling"),
  formula: astr("washable, waterproof"),
  purpose: astr("Shampoo, conditioner or hair oil purpose: clarifying, bond-repair, hydrating, smoothing, volume, shine"),
  style: aenum(["over-ear", "on-ear", "earbuds"]),
  noiseCancelling: aenum(["yes", "no"]),
  type: astr("Appliance type: full-size or personal blender, drip or pod or espresso coffee maker, basket or oven air fryer, electric or stovetop kettle, pop-up or toaster-oven toaster"),
};

/** JSON schema for structured output. All properties are required; absent values are null. */
export const SCREENSHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isProduct", "brand", "productName", "variant", "size", "price", "source", "store", "category", "attributes", "legibility"],
  properties: {
    isProduct: { type: "boolean" },
    brand: nstr,
    productName: { ...nstr, description: "Product name without the brand, size or shade" },
    variant: nstr,
    size: nstr,
    price: nullable({
      type: "object",
      additionalProperties: false,
      required: ["amount", "currency"],
      properties: { amount: { type: "number" }, currency: { type: "string", description: "ISO 4217 code" } },
    }),
    source: { type: "string", enum: ["creator-post", "store-page", "other"] },
    store: nstr,
    category: { type: "string", enum: [...CATEGORIES, "other"] },
    attributes: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(ATTRIBUTE_PROPS),
      properties: ATTRIBUTE_PROPS,
    },
    legibility: { type: "number", description: "0 to 1: how clearly the brand and product name can be read" },
  },
} as const;

export class ReaderOutputError extends Error {
  constructor(message: string) {
    super(`Screenshot reader: ${message}`);
    this.name = "ReaderOutputError";
  }
}

const isStrOrNull = (v: unknown) => v === null || typeof v === "string";

/** Check the model's JSON against the shape we rely on. Throws ReaderOutputError on anything off. */
export function parseScreenshotFields(raw: unknown): ScreenshotFields {
  const r = raw as ScreenshotFields;
  if (!r || typeof r !== "object") throw new ReaderOutputError("not an object");
  if (typeof r.isProduct !== "boolean") throw new ReaderOutputError("isProduct");
  for (const k of ["brand", "productName", "variant", "size", "store"] as const) if (!isStrOrNull(r[k])) throw new ReaderOutputError(k);
  if (r.price !== null && !(r.price && typeof r.price.amount === "number" && Number.isFinite(r.price.amount) && typeof r.price.currency === "string")) throw new ReaderOutputError("price");
  if (!["creator-post", "store-page", "other"].includes(r.source)) throw new ReaderOutputError("source");
  if (r.category !== "other" && !(CATEGORIES as readonly string[]).includes(r.category)) throw new ReaderOutputError("category");
  if (typeof r.legibility !== "number" || !(r.legibility >= 0 && r.legibility <= 1)) throw new ReaderOutputError("legibility");
  if (!r.attributes || typeof r.attributes !== "object" || !Array.isArray(r.attributes.actives)) throw new ReaderOutputError("attributes");
  return r;
}

/** Reader attributes as shelf attributes: nulls and empty lists dropped. */
export function toAttributes(a: ReaderAttributes): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim().toLowerCase();
    else if (Array.isArray(v) && v.length) out[k] = v.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  }
  return out;
}
