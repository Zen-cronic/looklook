/**
 * Generic names for filming mode. Every product, brand, store, creator handle
 * and product image the app can show from its bundled data has a neutral
 * stand-in here, so a recording shows how the app works without showing
 * anyone's trademark. Only what is displayed changes: verdicts, prices,
 * policies and payments are worked out from the real records first.
 */
import skipCases from "@/eval/skip-set/cases.json";
import skipShelf from "@/eval/skip-set/shelf.json";
import holdoutCases from "@/eval/holdout/cases.json";
import holdoutShelf from "@/eval/holdout/shelf.json";
import policies from "@/data/return-policies.json";
import { budgetGroupOf, CATEGORIES, type Category } from "../shelf/categories";

// Store labels

/**
 * How stores are named on screen: by kind ("Pharmacy", "Beauty store") or by
 * letter ("Store A"). Pick one before recording.
 */
export type StoreLabelStyle = "descriptive" | "letters";
export const STORE_LABEL_STYLE: StoreLabelStyle = "descriptive";

/** A store's kind, keyed by its domain without the ending (or its policy-table id). */
const STORE_KINDS: Record<string, string> = {
  sephora: "Beauty store",
  ulta: "Beauty chain",
  cvs: "Pharmacy",
  walgreens: "Drugstore",
  target: "Big-box store",
  kohls: "Department store",
  walmart: "Supercenter",
  samsclub: "Warehouse club",
  dollargeneral: "Discount store",
  macys: "Department store",
  nordstrom: "Department store",
  dillards: "Department store",
  boscovs: "Department store",
  bluemercury: "Beauty boutique",
  spacenk: "Beauty boutique",
  dermstore: "Skincare shop",
  sasa: "Beauty shop",
  stylevana: "Online beauty shop",
  ecosmetics: "Online beauty shop",
  skincareessentials: "Online skincare shop",
  fwrd: "Fashion site",
  modaoperandi: "Fashion site",
  qvc: "Shopping channel",
  bestbuy: "Electronics store",
  adorama: "Electronics store",
  williamssonoma: "Kitchen store",
  surlatable: "Kitchen store",
  amazon: "Online marketplace",
  ebay: "Online marketplace",
  brandsite: "Brand site",
  // Brands' own shops
  olehenriksen: "Brand site",
  lancomeusa: "Brand site",
  larocheposay: "Brand site",
  colorescience: "Brand site",
  maccosmetics: "Brand site",
  nyxcosmetics: "Brand site",
  rarebeauty: "Brand site",
  milanicosmetics: "Brand site",
  bangolufsen: "Brand site",
  pacificabeauty: "Brand site",
  diviofficial: "Brand site",
  lather: "Brand site",
  edifieronline: "Brand site",
};

/** Store names as they appear in text, mapped to their key above. */
const STORE_NAMES: Record<string, string> = {
  Sephora: "sephora",
  "Ulta Beauty": "ulta",
  Ulta: "ulta",
  "CVS Pharmacy": "cvs",
  CVS: "cvs",
  Walgreens: "walgreens",
  "Kohl's": "kohls",
  "Kohl’s": "kohls",
  Kohls: "kohls",
  Walmart: "walmart",
  "Sam's Club": "samsclub",
  "Dollar General": "dollargeneral",
  "Macy's": "macys",
  Nordstrom: "nordstrom",
  "Dillard's": "dillards",
  "Boscov's": "boscovs",
  Bluemercury: "bluemercury",
  "Space NK": "spacenk",
  Dermstore: "dermstore",
  QVC: "qvc",
  "Best Buy": "bestbuy",
  Adorama: "adorama",
  "Williams Sonoma": "williamssonoma",
  "Williams-Sonoma": "williamssonoma",
  "Sur La Table": "surlatable",
  Amazon: "amazon",
  "Brand site or other store": "brandsite",
  // "Target" is also an ordinary word in the app's own copy, so only the store's name in context.
  "at Target": "target",
};

/** Letter order for the "Store A" style: the stores most likely to share a screen first. */
const LETTER_ORDER = ["cvs", "ulta", "sephora", "target", "walgreens", "kohls", "walmart", "brandsite", "macys", "nordstrom", "dermstore", "amazon", "dillards", "adorama"];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** "https://www.cvs.com/x" or "CVS" or "cvs" to the key used above. */
export function storeKey(store: string): string {
  const s = store.trim();
  if (STORE_NAMES[s]) return STORE_NAMES[s];
  const host = s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^es\./, "")
    .split(/[/?#]/)[0];
  const base = host.includes(".") ? host.slice(0, host.lastIndexOf(".")) : host;
  return base.replace(/[^a-z0-9]/g, "") || s;
}

function hashLetter(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LETTERS[LETTER_ORDER.length + (h % (LETTERS.length - LETTER_ORDER.length))];
}

/** The neutral label for a store, from its domain, name or policy-table id. */
export function storeLabel(store: string | null | undefined, style: StoreLabelStyle = STORE_LABEL_STYLE): string {
  if (!store) return style === "letters" ? "Store" : "Online store";
  const key = storeKey(store);
  if (style === "letters") {
    const i = LETTER_ORDER.indexOf(key);
    return `Store ${i >= 0 ? LETTERS[i] : hashLetter(key)}`;
  }
  return STORE_KINDS[key] ?? "Online store";
}

/** Labels for a list of stores shown together, numbered where two share a kind. */
export function uniqueStoreLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const l of labels) total.set(l, (total.get(l) ?? 0) + 1);
  return labels.map((l) => {
    if ((total.get(l) ?? 0) < 2) return l;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return n === 1 ? l : `${l} ${n}`;
  });
}

// Product names

interface ProductRow {
  id?: string;
  catalogId?: string;
  brand: string;
  name: string;
  category: string;
  attributes?: Record<string, unknown>;
}

/**
 * Hand-written names for everything in the sample week, the sample posts and
 * the sample shelf, keyed by catalogue product id or shelf item id. The rest
 * of the bundled products get a name built from their category below.
 */
const NAMED: Record<string, string> = {
  // The sample shelf
  "sh-niacinamide": "Niacinamide 10% Serum",
  "sh-vitc": "Daily Vitamin C Serum",
  "sh-ha": "Hyaluronic Acid 2% Serum",
  "sh-cream": "Moisturizing Cream",
  "sh-gel": "Water Gel Cream",
  "sh-lrp-milk": "Face Sunscreen Milk SPF 60",
  "sh-unseen": "Invisible Gel Sunscreen SPF 40",
  "sh-cleanser": "Hydrating Cleanser",
  "sh-foundation": "Matte Liquid Foundation",
  "sh-concealer": "Creamy Concealer",
  "sh-lipstick": "Matte Lipstick",
  "sh-lipoil": "Tinted Lip Oil",
  "sh-blush": "Liquid Blush",
  "sh-setting": "Long-Wear Setting Spray",
  "sh-mascara": "Washable Mascara",
  "sh-shampoo": "Bond Repair Shampoo",
  "sh-headphones": "Noise-Cancelling Headphones",
  "sh-blender": "Countertop Blender",
  "sh-coffee": "Single-Cup Pod Coffee Maker",
  // The staples' catalogue listings (what a rebuy pays for)
  m29GwjG: "Hydrating Cleanser",
  STrUbGm: "Hyaluronic Acid 2% Serum",
  j4VjFHh: "Moisturizing Cream",
  su2Of21: "Washable Mascara",
  // The sample week and the sample posts
  Fn4uWrP: "Wireless Earbuds",
  LxnNLye: "Drip Coffee Maker",
  UyKpygl: "Clarifying Shampoo",
  Av3BX6v: "Peptide Serum",
  TNq1quB: "Retinol Serum 0.3%",
  YjIg3Ci: "Renewing Vitamin C Serum",
  "8Z6ZLY7": "Oil-Free Face Sunscreen SPF 60",
};

/** Shelf ids are reused between the two sample shelves, so the second shelf's names are kept apart. */
const HOLDOUT_SHELF_NAMED: Record<string, string> = {
  "sh-retinol": "Retinol 0.5% Serum",
  "sh-azelaic": "Azelaic Acid 10% Serum",
  "sh-lotion": "Daily Face Lotion",
  "sh-richcream": "Rich Repair Cream",
  "sh-sunscreen": "Light Face Sunscreen SPF 50+",
  "sh-cleanser": "Gentle Hydrating Cleanser",
  "sh-foundation": "Long-Wear Foundation",
  "sh-concealer": "Full-Coverage Concealer",
  "sh-lipstick": "Matte Lipstick",
  "sh-lipbalm": "Lip Butter Balm",
  "sh-setting": "Dewy Setting Spray",
  "sh-shampoo": "Hydrating Shampoo",
  "sh-hairoil": "Smoothing Hair Oil",
  "sh-earbuds": "Noise-Cancelling Earbuds",
  "sh-airfryer": "6-Quart Air Fryer",
  "sh-coffee": "8-Cup Coffee Maker",
};

const NOUNS: Record<Category, string> = {
  serum: "Serum",
  moisturizer: "Moisturizer",
  sunscreen: "Sunscreen",
  cleanser: "Cleanser",
  foundation: "Foundation",
  concealer: "Concealer",
  lipstick: "Lipstick",
  "lip-oil": "Lip Oil",
  blush: "Blush",
  "setting-spray": "Setting Spray",
  mascara: "Mascara",
  shampoo: "Shampoo",
  conditioner: "Conditioner",
  "hair-oil": "Hair Oil",
  "lip-balm": "Lip Balm",
  headphones: "Headphones",
  blender: "Blender",
  "coffee-maker": "Coffee Maker",
  "air-fryer": "Air Fryer",
  kettle: "Kettle",
  toaster: "Toaster",
};

const ACTIVE_WORDS: Record<string, string> = {
  "vitamin-c": "Vitamin C",
  "hyaluronic-acid": "Hydrating",
  "azelaic-acid": "Azelaic Acid",
  "copper-peptides": "Peptide",
  peptides: "Peptide",
};

const title = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** A plain name from what the product is: "Peptide Serum", "Drip Coffee Maker", "Wireless Earbuds". */
export function genericName(category: string | undefined, attributes: Record<string, unknown> = {}): string {
  const cat = (CATEGORIES as readonly string[]).includes(category ?? "") ? (category as Category) : undefined;
  if (!cat) return "Everyday Item";
  const a = (k: string) => {
    const v = attributes[k];
    return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "";
  };
  if (cat === "serum") {
    const active = a("primaryActive") || a("actives");
    return active ? `${ACTIVE_WORDS[active] ?? title(active)} Serum` : "Face Serum";
  }
  if (cat === "headphones") return a("style") === "earbuds" ? "Wireless Earbuds" : a("style") === "on-ear" ? "On-Ear Headphones" : "Over-Ear Headphones";
  if (cat === "sunscreen") return `${a("area") === "body" ? "Body" : "Face"} Sunscreen${a("spfBand") ? ` SPF ${a("spfBand")}` : ""}`;
  const word = a("finish") || a("texture") || a("type") || a("purpose") || a("form") || a("effect") || a("formula") || a("tint");
  return word && word !== "full-size" ? `${title(word)} ${NOUNS[cat]}` : NOUNS[cat];
}

const skipRows = (skipCases as unknown as { cases: ProductRow[] }).cases;
const holdoutRows = (holdoutCases as unknown as { cases: ProductRow[] }).cases;
const skipShelfRows = (skipShelf as unknown as { items: ProductRow[] }).items;
const holdoutShelfRows = (holdoutShelf as unknown as { items: ProductRow[] }).items;

function nameForRow(row: ProductRow, shelfNames?: Record<string, string>): string {
  if (shelfNames && row.id && shelfNames[row.id]) return shelfNames[row.id];
  if (row.catalogId && NAMED[row.catalogId]) return NAMED[row.catalogId];
  return genericName(row.category, row.attributes);
}

/** Every bundled product, with the neutral name shown for it. */
export const PRODUCT_TABLE: Array<{ brand: string; name: string; neutral: string; ids: string[]; category: string }> = [
  ...skipShelfRows.map((r) => ({ brand: r.brand, name: r.name, neutral: nameForRow(r, NAMED), ids: [r.id!], category: r.category })),
  ...holdoutShelfRows.map((r) => ({ brand: r.brand, name: r.name, neutral: nameForRow(r, HOLDOUT_SHELF_NAMED), ids: [], category: r.category })),
  ...skipRows.map((r) => ({ brand: r.brand, name: r.name, neutral: nameForRow(r), ids: r.catalogId ? [r.catalogId] : [], category: r.category })),
  ...holdoutRows.map((r) => ({ brand: r.brand, name: r.name, neutral: nameForRow(r), ids: r.catalogId ? [r.catalogId] : [], category: r.category })),
];

/** Every brand in the bundled data. */
export const BRANDS: string[] = [...new Set(PRODUCT_TABLE.map((p) => p.brand))];

/**
 * Brand names that are also everyday words in the app's copy. They are only
 * replaced as part of a product's full name, never on their own.
 */
const COMMON_WORD_BRANDS = new Set(["Apple", "Fellow", "Lather", "Lush", "GE", "Versed", "Divi", "Braun", "Image Skincare", "Instant Pot", "OXO"]);

/**
 * Product-line words that identify a brand's product on their own (a reason
 * could say "your Anthelios"). Used to catch a name a model wrote freely.
 */
export const LINE_WORDS = ["Anthelios", "Hydro Boost", "Double Rewind", "Melt-in Milk", "Fit Me", "Lash Sensational", "Soft Pinch", "All Nighter", "Addict Lip", "K-Mini", "WH-1000XM5", "PureFlavor", "Skin Renewing", "Multi-Peptide", "Bond Maintenance", "No.4", "Toleriane", "Shape Tape", "Double Wear", "AirPods", "Relief Sun", "Vortex Plus", "Matte Revolution", "Make It Dewy", "Ultra Repair", "TruSkin", "Supergoop", "OLEHENRIKSEN", "theordinary"];

const BY_ID = new Map<string, string>();
for (const [id, n] of Object.entries(NAMED)) BY_ID.set(id, n);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const BY_TEXT = new Map<string, string>();
for (const p of PRODUCT_TABLE) {
  if (!BY_TEXT.has(norm(`${p.brand} ${p.name}`))) BY_TEXT.set(norm(`${p.brand} ${p.name}`), p.neutral);
  if (!BY_TEXT.has(norm(p.name))) BY_TEXT.set(norm(p.name), p.neutral);
}

/** The line above a product's name: its budget group instead of the brand. */
export function brandLine(category: string | undefined): string {
  const cat = (CATEGORIES as readonly string[]).includes(category ?? "") ? (category as Category) : undefined;
  if (!cat) return "Everyday";
  const group = budgetGroupOf(cat);
  return { skincare: "Skincare", makeup: "Makeup", haircare: "Hair care", kitchen: "Kitchen", electronics: "Electronics" }[group];
}

/** The neutral name for a product, by id first, then by its brand and name, then by what it is. */
export function productName(p: { brand?: string | null; name?: string | null; id?: string | null; category?: string | null; attributes?: Record<string, unknown> }): string {
  if (p.id && BY_ID.has(p.id)) return BY_ID.get(p.id)!;
  const name = p.name ?? "";
  const brand = p.brand ?? "";
  const hit = BY_TEXT.get(norm(`${brand} ${name}`)) ?? BY_TEXT.get(norm(name)) ?? (brand && norm(name).startsWith(norm(brand)) ? BY_TEXT.get(norm(name.slice(brand.length))) : undefined);
  if (hit) return hit;
  return genericName(p.category ?? undefined, p.attributes ?? {});
}

// Creator handles and sample posts

export const HANDLES: Record<string, string> = {
  "@lucia.routine": "@glowlist",
  "@noor.skin": "@morning.steps",
  "@jun.glow": "@night.shelf",
  "@femi.finds": "@serum.diary",
};

/** Unbranded copies of the four sample posts (same product, price and store kind). */
export const FILM_SAMPLES: Record<string, { image: string; label: string; alt: string }> = {
  "spf-cvs": { image: "/filming/posts/sunscreen.png", label: "Sunscreen, Pharmacy", alt: "A creator post about an oil-free face sunscreen SPF 60, bought at a pharmacy for $29.99" },
  "vitc-ulta": { image: "/filming/posts/vitamin-c.png", label: "Vitamin C serum, Beauty chain", alt: "A creator post about a renewing vitamin C serum, bought at a beauty chain for $28.99" },
  "retinol-brand": { image: "/filming/posts/retinol.png", label: "Retinol serum, brand site", alt: "A creator post about a 0.3% retinol serum for $72 on the brand's site" },
  "peptide-sephora": { image: "/filming/posts/peptide.png", label: "Peptide serum, Beauty store", alt: "A creator post about a peptide serum at a beauty store for $32" },
};

// Product images

/** Unbranded product photos, by the kind of container. */
const PRODUCT_IMAGES: Partial<Record<Category, string>> = {
  serum: "/filming/products/serum.png",
  sunscreen: "/filming/products/sunscreen.png",
  cleanser: "/filming/products/cleanser.png",
  moisturizer: "/filming/products/cream.png",
  shampoo: "/filming/products/bottle.png",
  conditioner: "/filming/products/bottle.png",
  "hair-oil": "/filming/products/bottle.png",
  "setting-spray": "/filming/products/bottle.png",
};
export const GENERIC_PRODUCT_IMAGE = "/filming/products/generic.png";

/** Every image filming mode can show in place of a real one. */
export const FILM_IMAGES = [...new Set([...Object.values(PRODUCT_IMAGES), GENERIC_PRODUCT_IMAGE, ...Object.values(FILM_SAMPLES).map((s) => s.image)])];

/** An unbranded stand-in for a product photo or a sample post. */
export function productImage(url: string | null | undefined, category?: string | null): string | undefined {
  if (!url) return url ?? undefined;
  if (url.startsWith("/filming/") || url.startsWith("/media/")) return url;
  const sample = url.match(/^\/samples\/([^/.]+)\.png$/);
  if (sample && FILM_SAMPLES[sample[1]]) return FILM_SAMPLES[sample[1]].image;
  return PRODUCT_IMAGES[(category ?? "") as Category] ?? GENERIC_PRODUCT_IMAGE;
}

// Payment details

const CARD_NETWORKS = ["American Express", "Mastercard", "MasterCard", "Visa", "Amex", "Discover", "Jcb", "JCB", "Diners", "Maestro", "Unionpay", "UnionPay"];

/** "…43G": the end of a PayPal id, enough to tell two apart on screen. The real id stays in the record. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "";
  return id.length > 6 ? `…${id.slice(-3)}` : id;
}

// Text

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildTerms(): Array<[string, string]> {
  const terms = new Map<string, string>();
  for (const p of PRODUCT_TABLE) {
    // The sample shelf comes first in the table, so its names win over a catalogue listing with the same name.
    for (const k of [`${p.brand} ${p.name}`, `${p.brand}'s ${p.name}`, p.name]) if (!terms.has(k)) terms.set(k, p.neutral);
  }
  // A bare name that is already generic stays as it is.
  for (const generic of ["Vitamin C Serum", "Moisturizing Cream", "Matte Lipstick", "Wireless Earbuds", "Hydrating Shampoo", "Hair Oil"]) terms.delete(generic);
  for (const [name, key] of Object.entries(STORE_NAMES)) terms.set(name, name.startsWith("at ") ? `at ${storeLabel(key)}` : storeLabel(key));
  for (const r of (policies as { retailers: Array<{ id: string; name: string; domains: string[] }> }).retailers) {
    terms.set(r.name, storeLabel(r.id));
    for (const d of r.domains) {
      terms.set(d, storeLabel(d));
      terms.set(`www.${d}`, storeLabel(d));
    }
  }
  for (const row of [...skipRows, ...holdoutRows]) {
    const store = (row as unknown as { store?: string }).store;
    if (store && store.includes(".")) {
      terms.set(store, storeLabel(store));
      terms.set(`www.${store}`, storeLabel(store));
    }
  }
  for (const store of ["walmart.com", "boscovs.com", "amazon.com", "ulta.com", "cvs.com"]) terms.set(store, storeLabel(store));
  for (const b of BRANDS) if (!COMMON_WORD_BRANDS.has(b)) terms.set(b, "");
  for (const [h, n] of Object.entries(HANDLES)) terms.set(h, n);
  for (const n of CARD_NETWORKS) terms.set(n, "Card");
  terms.set("#theordinary", "#serum");
  return [...terms.entries()].sort((a, b) => b[0].length - a[0].length);
}

const TERMS = buildTerms();
const TERM_MAP = new Map(TERMS);
const TERM_RE = new RegExp(`(?<![A-Za-z0-9])(?:${TERMS.map(([t]) => escape(t)).join("|")})(?![A-Za-z0-9])`, "g");

/** A PayPal order or capture id (17 capitals and digits) or a webhook event id. */
const PAYPAL_ID_RE = /\b(?=[0-9A-Z]{17}\b)(?=[0-9A-Z]*\d)(?=[0-9A-Z]*[A-Z])[0-9A-Z]{17}\b|\bWH-[0-9A-Z-]{10,}\b/g;

const DAY_RE = "(?:[A-Z][a-z]{2}, )?[A-Z][a-z]{2} \\d{1,2}(?:, \\d{4})?";

/**
 * One way of saying "simulated" on screen: the date, then "(simulated)", or
 * "(date, simulated)" where the date is already in brackets. The label stays;
 * only its wording is shortened.
 */
export function compactSimulated(s: string): string {
  return s
    .replace(new RegExp(`\\((counted (?:on|from) )?the simulated date (${DAY_RE})\\)`, "g"), "($1$2, simulated)")
    .replace(new RegExp(`(counted (?:on|from) )?the simulated date (${DAY_RE})`, "g"), "$1$2 (simulated)")
    .replace(new RegExp(`simulated date (${DAY_RE})`, "g"), "$1 (simulated)")
    .replace(/\(simulated date\)/g, "(simulated)");
}

export interface TextOptions {
  /** Shorten PayPal ids in the text to their last three characters. */
  shortIds?: boolean;
}

/** The same text with every known product, brand, store, handle and card network named generically. */
export function neutralText(s: string, opts: TextOptions = {}): string {
  if (!s) return s;
  let out = s.replace(TERM_RE, (m) => TERM_MAP.get(m) ?? m);
  if (out !== s) {
    out = out
      .replace(/ {2,}/g, " ")
      .replace(/ ([,.:;)])/g, "$1")
      .replace(/\( /g, "(")
      .replace(/^ /, "")
      .replace(/\b(a|an|the|your|Your|A|An|The) (a|an|the) /g, "$1 ");
  }
  out = compactSimulated(out);
  if (opts.shortIds) out = out.replace(PAYPAL_ID_RE, (m) => shortId(m));
  return out;
}

/** Every store domain in the bundled data. */
export const STORE_DOMAINS: string[] = [
  ...new Set([
    ...(policies as { retailers: Array<{ domains: string[] }> }).retailers.flatMap((r) => r.domains),
    ...[...skipRows, ...holdoutRows].map((r) => (r as unknown as { store?: string }).store ?? "").filter((d) => d.includes(".")),
    "walmart.com",
    "boscovs.com",
    "amazon.com",
  ]),
];

const RESIDUE_RE = new RegExp(`(?<![A-Za-z0-9])(?:${[...BRANDS.filter((b) => !COMMON_WORD_BRANDS.has(b)), ...LINE_WORDS, ...Object.keys(HANDLES), ...Object.keys(STORE_NAMES).filter((n) => !n.startsWith("at ")), ...CARD_NETWORKS, ...STORE_DOMAINS].map(escape).join("|")})(?![A-Za-z0-9])`);

/** Does this text still name a known brand, product line, store, handle or card network? */
export function namesABrand(s: string): string | null {
  return s.match(RESIDUE_RE)?.[0] ?? null;
}
