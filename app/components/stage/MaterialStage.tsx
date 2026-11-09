import Link from "next/link";
import type { ReactNode } from "react";
import s from "./stage.module.css";

/**
 * A material panel (a still of a cream or a gel) with the page's main card
 * floating on it in nested hairline frames, an eyebrow tag in the corner, and
 * optionally a dotted line down to the item already on the shelf.
 */
const MATERIALS = {
  cream: {
    avif: "/media/hero-cream-640.avif 640w, /media/hero-cream-1200.avif 1200w",
    webp: "/media/hero-cream-640.webp 640w, /media/hero-cream-1200.webp 1200w",
    jpg: "/media/hero-cream-1200.jpg",
  },
  gel: {
    avif: "/media/yes-gel-640.avif 640w, /media/yes-gel-1200.avif 1200w",
    webp: "/media/yes-gel-640.webp 640w, /media/yes-gel-1200.webp 1200w",
    jpg: "/media/yes-gel-1200.jpg",
  },
};

const SIZES = "(min-width: 720px) 42rem, 100vw";

export function MaterialStage(props: { material?: keyof typeof MATERIALS; tag: string; children: ReactNode; label?: string }) {
  const m = MATERIALS[props.material ?? "cream"];
  return (
    <section className={s.stage} aria-label={props.label}>
      <picture className={s.material}>
        <source type="image/avif" srcSet={m.avif} sizes={SIZES} />
        <source type="image/webp" srcSet={m.webp} sizes={SIZES} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.jpg} alt="" width={1200} height={1490} decoding="async" />
      </picture>
      <div className={s.inner}>
        <p className={s.tag}>
          <span className={s.tagDot} aria-hidden="true" />
          {props.tag}
        </p>
        {props.children}
      </div>
    </section>
  );
}

/** Two hairline frames around the card. */
export function Frames({ children }: { children: ReactNode }) {
  return (
    <div className={s.float}>
      <div className={s.frameOuter}>
        <div className={s.frameInner}>{children}</div>
      </div>
    </div>
  );
}

/** The dotted line from the card above to the item already on the shelf. */
export function ShelfLink(props: { label: string; brand: string; name: string; note: string; href: string }) {
  return (
    <div className={s.shelfRow}>
      <span className={s.wire} aria-hidden="true">
        <span className={s.wireLabel}>{props.label}</span>
      </span>
      <div className={s.shelfFloat}>
        <div className={s.shelfFrame}>
          <Link className={s.shelfCard} href={props.href}>
            <span className={s.shelfTag}>
              <span className={s.shelfDot} aria-hidden="true" />
              Already on your shelf
            </span>
            <span className="brand-line">{props.brand}</span>
            <span className="name-line">{props.name}</span>
            <span className="small muted">{props.note}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
