import { preload } from "react-dom";
import { landingSample } from "@/lib/app/landing";
import { Eyebrow } from "../Eyebrow";
import { VerdictSummary } from "../VerdictSummary";
import s from "./HeroObject.module.css";

/**
 * The landing hero's object slot. Everything the hero shows on the right
 * lives in this folder (this file and HeroObject.module.css), so a different
 * hero object can replace it without touching the page: keep the export name
 * and fill the slot the page gives it (`.hero-slot` in landing.module.css).
 *
 * Now: the real skip verdict card, from the sample shelf and the same engine,
 * in a hairline frame over a white lotion texture, joined by a dotted line to
 * the item already on the shelf.
 */
const MATERIAL = {
  avif: "/media/lotion-640.avif 640w, /media/lotion-1200.avif 1200w",
  webp: "/media/lotion-640.webp 640w, /media/lotion-1200.webp 1200w",
  jpg: "/media/lotion-1200.jpg",
  sizes: "(min-width: 960px) 36rem, 100vw",
};

export function HeroObject({ film = false }: { film?: boolean }) {
  const x = landingSample(film);
  preload("/media/lotion-1200.avif", { as: "image", type: "image/avif", imageSrcSet: MATERIAL.avif, imageSizes: MATERIAL.sizes, fetchPriority: "high" });
  return (
    <div className={s.object}>
      <picture className={s.material}>
        <source type="image/avif" srcSet={MATERIAL.avif} sizes={MATERIAL.sizes} />
        <source type="image/webp" srcSet={MATERIAL.webp} sizes={MATERIAL.sizes} />
        <img src={MATERIAL.jpg} alt="" width={1200} height={1490} fetchPriority="high" decoding="async" />
      </picture>
      <div className={s.stage}>
        <div className={s.verdictFloat}>
          <div className={s.frame}>
            <article className={`verdict ${x.verdict} ${s.card}`} aria-label="An example verdict">
              <VerdictSummary verdict={x.verdict} reason={x.reason} brand={x.brand} name={x.name} imageUrl={x.imageUrl} storeName={x.storeName} priceLabel={x.priceLabel} />
            </article>
          </div>
        </div>
        <div className={s.shelfRow}>
          <span className={s.wire} aria-hidden="true">
            <span className={s.wireLabel}>
              {x.shelf.relation}, match {x.shelf.matchPercent}%
            </span>
          </span>
          <div className={s.shelfFloat}>
            <div className={s.shelfFrame}>
              <div className={s.shelfCard}>
                <Eyebrow icon="shelf" className={s.shelfTag}>
                  Already on your shelf
                </Eyebrow>
                <div className="brand-line">{x.shelf.brand}</div>
                <div className="name-line">{x.shelf.name}</div>
                <p className="small muted">
                  {x.shelf.opened ? "Opened. " : ""}Same {x.shelf.same.join(", ").replace(/, ([^,]+)$/, " and $1")}.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
