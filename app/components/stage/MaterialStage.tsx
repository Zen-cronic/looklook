import Link from "next/link";
import type { ReactNode } from "react";
import { Eyebrow, type EyebrowIcon } from "../Eyebrow";
import s from "./stage.module.css";

/**
 * A material panel (a still of a white lotion) with the page's main card
 * floating on it in a hairline frame, an eyebrow above it, and optionally a
 * dotted line down to the item already on the shelf.
 */
export const LOTION = {
  avif: "/media/lotion-640.avif 640w, /media/lotion-1200.avif 1200w",
  webp: "/media/lotion-640.webp 640w, /media/lotion-1200.webp 1200w",
  jpg: "/media/lotion-1200.jpg",
};

const SIZES = "(min-width: 720px) 42rem, 100vw";

/** The lotion still, filling its positioned parent. */
export function Lotion(props: { className?: string; sizes?: string; eager?: boolean }) {
  return (
    <picture className={props.className}>
      <source type="image/avif" srcSet={LOTION.avif} sizes={props.sizes ?? SIZES} />
      <source type="image/webp" srcSet={LOTION.webp} sizes={props.sizes ?? SIZES} />
      <img src={LOTION.jpg} alt="" width={1200} height={1490} decoding="async" loading={props.eager ? undefined : "lazy"} fetchPriority={props.eager ? "high" : undefined} />
    </picture>
  );
}

export function MaterialStage(props: { tag?: string; icon?: EyebrowIcon; children: ReactNode; label?: string; className?: string }) {
  return (
    <section className={`${s.stage}${props.className ? ` ${props.className}` : ""}`} aria-label={props.label}>
      <Lotion className={s.material} eager />
      <div className={s.inner}>
        {props.tag && <Eyebrow icon={props.icon ?? "check"}>{props.tag}</Eyebrow>}
        {props.children}
      </div>
    </section>
  );
}

/** One hairline frame around the card. */
export function Frames({ children }: { children: ReactNode }) {
  return (
    <div className={s.float}>
      <div className={s.frame}>{children}</div>
    </div>
  );
}

/** The dotted line from the card above to the item already on the shelf. */
export function ShelfLink(props: { label: string; brand: string; name: string; note: string; href: string; tag?: string }) {
  return (
    <div className={s.shelfRow}>
      <span className={s.wire} aria-hidden="true">
        <span className={s.wireLabel}>{props.label}</span>
      </span>
      <div className={s.shelfFloat}>
        <div className={s.shelfFrame}>
          <Link className={s.shelfCard} href={props.href}>
            <Eyebrow as="span" icon="shelf" className={s.shelfTag}>
              {props.tag ?? "Already on your shelf"}
            </Eyebrow>
            <span className="brand-line">{props.brand}</span>
            <span className="name-line">{props.name}</span>
            <span className="small muted">{props.note}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
