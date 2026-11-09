import type { ReactNode } from "react";
import type { Verdict } from "@/lib/verdict/types";
import { ProductGlyph } from "./ProductGlyph";
import { VERDICT_WORD } from "./VerdictChip";

/**
 * The top of a verdict card: the verdict word and its one-line reason, then
 * the product. The verdict page and the landing page both render it inside
 * an `article.verdict`.
 */
export function VerdictSummary(props: {
  verdict: Verdict;
  reason: string;
  headNote?: ReactNode;
  brand: string;
  name: string;
  imageUrl?: string | null;
  storeName?: string;
  priceLabel?: string | null;
  returns?: { tone: string; text: string } | null;
}) {
  return (
    <>
      <div className="verdict-head">
        <div className="verdict-word">{VERDICT_WORD[props.verdict]}</div>
        <p className="verdict-reason">{props.reason}</p>
        {props.headNote}
      </div>
      <div className="product-row">
        {props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={props.imageUrl} alt="" />
        ) : (
          <span className="thumb empty">
            <ProductGlyph shape="bottle" letter={props.brand} />
          </span>
        )}
        <div className="meta">
          <div className="brand-line">{props.brand || "Brand not shown"}</div>
          <div className="name-line">{props.name || "Product not readable"}</div>
          {props.storeName && <div className="small muted">at {props.storeName}</div>}
        </div>
        {props.priceLabel && <div className="price-line">{props.priceLabel}</div>}
      </div>
      {props.returns && <p className={`returns ${props.returns.tone}`}>{props.returns.text}</p>}
    </>
  );
}
