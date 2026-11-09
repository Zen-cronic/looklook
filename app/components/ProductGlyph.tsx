/**
 * A small line drawing standing in for a product photo: a bottle for skincare
 * and hair, a slim tube for makeup, a box for kitchen and electronics. With a
 * letter, the bottle's label carries the brand's initial.
 */
export type GlyphShape = "bottle" | "tube" | "box";

const SHAPES: Record<GlyphShape, string> = {
  // A pump bottle
  bottle: "M17 5h6v3h-2v3h3.5a3 3 0 013 3V33a2.5 2.5 0 01-2.5 2.5h-10A2.5 2.5 0 0112.5 33V14a3 3 0 013-3H19V8h-2z",
  // A lipstick or mascara tube
  tube: "M16.5 4.5h7l1 7h-9zM14.5 11.5h11v22a2 2 0 01-2 2h-7a2 2 0 01-2-2z",
  // An appliance: a box with a dial
  box: "M9 8.5h22a2 2 0 012 2v22a2 2 0 01-2 2H9a2 2 0 01-2-2v-22a2 2 0 012-2zM7 15h26",
};

export function glyphFor(group: string): GlyphShape {
  if (group === "makeup") return "tube";
  if (group === "kitchen" || group === "electronics") return "box";
  return "bottle";
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
