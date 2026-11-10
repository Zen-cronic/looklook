import { landingSample } from "@/lib/app/landing";
import { VerdictSummary } from "../VerdictSummary";
import { ToyShelfStage } from "./ToyShelfStage";
import s from "./HeroObject.module.css";

/**
 * The landing hero's object slot. Everything the hero shows on the right
 * lives in this folder, so a different hero object can replace it without
 * touching the page: keep the export name and fill the slot the page gives it
 * (`.hero-slot` in landing.module.css).
 *
 * Now: the toy shelf. A new bottle drops in over a shelf of clay-white
 * products and hovers without finding a slot, its twin on the shelf turns
 * cobalt, a dotted line joins them, and the real skip verdict for the sample
 * shelf (the same engine, the same component as the verdict page) lands
 * underneath.
 */
export function HeroObject({ film = false }: { film?: boolean }) {
  const x = landingSample(film);
  return (
    <ToyShelfStage film={film} label="A shelf of white bottles, jars and tubes. A new bottle hovers above it while the same bottle on the shelf turns cobalt, joined to it by a dotted line.">
      <article className={`verdict ${x.verdict} ${s.card}`} aria-label="An example verdict">
        <VerdictSummary
          verdict={x.verdict}
          reason="Its twin is on your shelf."
          headNote={
            <p className={s.match}>
              {x.shelf.name}, match {x.shelf.matchPercent}%
            </p>
          }
          brand={x.brand}
          name={x.name}
          imageUrl={x.imageUrl}
          storeName={x.storeName}
          priceLabel={x.priceLabel}
        />
      </article>
    </ToyShelfStage>
  );
}
