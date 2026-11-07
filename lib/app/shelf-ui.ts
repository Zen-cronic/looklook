import type { Category } from "../shelf/categories";

export const CATEGORY_LABELS: Record<Category, string> = {
  serum: "Serum",
  moisturizer: "Moisturizer",
  sunscreen: "Sunscreen",
  cleanser: "Cleanser",
  foundation: "Foundation",
  concealer: "Concealer",
  lipstick: "Lipstick",
  "lip-oil": "Lip oil",
  blush: "Blush",
  "setting-spray": "Setting spray",
  mascara: "Mascara",
  shampoo: "Shampoo",
  conditioner: "Conditioner",
  "hair-oil": "Hair oil or serum",
  "lip-balm": "Lip balm",
  headphones: "Headphones",
  blender: "Blender",
  "coffee-maker": "Coffee maker",
  "air-fryer": "Air fryer",
  kettle: "Kettle",
  toaster: "Toaster",
};

/** The one detail asked for when adding by hand: the attribute that matters most for "does the same job". */
export const KEY_DETAIL: Record<Category, { key: string; label: string; placeholder: string }> = {
  serum: { key: "primaryActive", label: "Main active", placeholder: "vitamin C, retinol, niacinamide" },
  moisturizer: { key: "texture", label: "Texture", placeholder: "cream, gel cream, lotion" },
  sunscreen: { key: "filter", label: "Filter", placeholder: "chemical or mineral" },
  cleanser: { key: "form", label: "Form", placeholder: "cream, foam, gel" },
  foundation: { key: "finish", label: "Finish", placeholder: "matte, natural, dewy" },
  concealer: { key: "finish", label: "Finish", placeholder: "matte, radiant" },
  lipstick: { key: "shadeFamily", label: "Shade family", placeholder: "nude, red, berry" },
  "lip-oil": { key: "tint", label: "Tint", placeholder: "clear or tinted" },
  blush: { key: "shadeFamily", label: "Shade family", placeholder: "pink, peach, coral" },
  "setting-spray": { key: "finish", label: "Finish", placeholder: "matte, dewy" },
  mascara: { key: "effect", label: "Effect", placeholder: "volumizing, lengthening" },
  shampoo: { key: "purpose", label: "Purpose", placeholder: "bond repair, clarifying" },
  conditioner: { key: "purpose", label: "Purpose", placeholder: "hydrating, repair, volume" },
  "hair-oil": { key: "purpose", label: "Purpose", placeholder: "smoothing, shine, repair" },
  "lip-balm": { key: "tint", label: "Tint", placeholder: "clear or tinted" },
  headphones: { key: "style", label: "Style", placeholder: "over-ear, earbuds" },
  blender: { key: "type", label: "Type", placeholder: "full-size, personal" },
  "coffee-maker": { key: "type", label: "Type", placeholder: "drip, pod, espresso" },
  "air-fryer": { key: "type", label: "Type", placeholder: "basket, oven" },
  kettle: { key: "type", label: "Type", placeholder: "electric, stovetop" },
  toaster: { key: "type", label: "Type", placeholder: "pop-up, toaster oven" },
};

export function kebab(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
