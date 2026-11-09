import type { Category } from "@/lib/shelf/categories";

/**
 * A small line drawing standing in for a product photo, one per kind of
 * product: a dropper for serums, a squeeze tube for creams and cleansers, a
 * wand for concealer and mascara, a lipstick, a compact for blush, a pump
 * bottle for shampoo and liquids, an appliance for the kitchen and headphones
 * for electronics. With a letter, the bottle's label carries the brand's initial.
 */
export type GlyphShape = "bottle" | "dropper" | "tube" | "wand" | "lipstick" | "compact" | "box" | "device";

const SHAPES: Record<GlyphShape, string> = {
  // A pump bottle
  bottle: "M17 5h6v3h-2v3h3.5a3 3 0 013 3V33a2.5 2.5 0 01-2.5 2.5h-10A2.5 2.5 0 0112.5 33V14a3 3 0 013-3H19V8h-2z",
  // A dropper bottle: the bulb, the collar, the body
  dropper: "M17.5 8.5V6a2.5 2.5 0 015 0v2.5zM15.5 8.5h9v4h-9zM14.5 12.5h11a2 2 0 012 2V32a3.5 3.5 0 01-3.5 3.5h-8A3.5 3.5 0 0112.5 32V14.5a2 2 0 012-2zM12.5 20h15",
  // A squeeze tube standing on its cap, crimped at the top
  tube: "M12 5.5h16M13 5.5h14l-2.5 21h-9zM15.5 26.5h9v7.5a1.5 1.5 0 01-1.5 1.5h-6a1.5 1.5 0 01-1.5-1.5z",
  // A slim tube with its wand cap: concealer or mascara
  wand: "M16.5 4.5h7l1 7h-9zM14.5 11.5h11v22a2 2 0 01-2 2h-7a2 2 0 01-2-2z",
  // A lipstick: the angled bullet over its case
  lipstick: "M17 15.5V9l6-4v10.5zM15.5 15.5h9v6h-9zM14 21.5h12v12.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 0114 34z",
  // A round compact with its mirror and powder pan
  compact: "M20 8a12.5 12.5 0 110 25 12.5 12.5 0 010-25zM20 13.5a7 7 0 110 14 7 7 0 010-14zM20 5.5v2.5",
  // An appliance: a box with a dial
  box: "M9 8.5h22a2 2 0 012 2v22a2 2 0 01-2 2H9a2 2 0 01-2-2v-22a2 2 0 012-2zM7 15h26",
  // Headphones: the band and two cups
  device: "M9.5 25v-5a10.5 10.5 0 0121 0v5M7.5 23.5H12v10H9.5a2 2 0 01-2-2zM28 23.5h4.5v8a2 2 0 01-2 2H28z",
};

const BY_CATEGORY: Partial<Record<Category, GlyphShape>> = {
  serum: "dropper",
  "hair-oil": "dropper",
  moisturizer: "tube",
  cleanser: "tube",
  sunscreen: "tube",
  concealer: "wand",
  mascara: "wand",
  lipstick: "lipstick",
  "lip-oil": "lipstick",
  "lip-balm": "lipstick",
  blush: "compact",
  headphones: "device",
  blender: "box",
  "coffee-maker": "box",
  "air-fryer": "box",
  kettle: "box",
  toaster: "box",
};

/** The drawing for a shelf item's kind; a pump bottle for the rest (foundation, setting spray, shampoo). */
export function glyphFor(category: Category): GlyphShape {
  return BY_CATEGORY[category] ?? "bottle";
}

export function ProductGlyph(props: { shape: GlyphShape; letter?: string; className?: string }) {
  const letter = props.letter?.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase();
  return (
    <svg className={`glyph${props.className ? ` ${props.className}` : ""}`} viewBox="0 0 40 40" aria-hidden="true">
      <path d={SHAPES[props.shape]} />
      {props.shape === "box" && <circle cx="20" cy="25" r="4.5" />}
      {letter && props.shape === "bottle" && (
        <text x="20" y="27" textAnchor="middle">
          {letter}
        </text>
      )}
    </svg>
  );
}
