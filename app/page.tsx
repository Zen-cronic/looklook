import Link from "next/link";
import { baselineScore, heldOutHeadline, heldOutResult } from "@/lib/app/holdout";
import { landingSample } from "@/lib/app/landing";
import { SELLER_OF_RECORD } from "@/lib/app/payments";
import { APP_NAME } from "@/lib/brand";
import { WEEK_TAGLINE } from "@/lib/app/week";
import { Eyebrow } from "./components/Eyebrow";
import { productImage } from "@/lib/filming/neutral";
import { HeroObject } from "./components/hero-object/HeroObject";
import { Lotion } from "./components/stage/MaterialStage";
import { CountUp, LandingMotion } from "./components/landing/LandingMotion";
import s from "./landing.module.css";

/** What the yes section promises, word for word as FACTS.md lists them. */
const YES_POINTS = [
  {
    title: "Nothing is charged without your yes",
    lines: [
      "Each rebuy is charged only after you tap yes on it, at the price shown on that card.",
      "PayPal Vault saves the method only when you tick the box, and each rebuy is a charge you start with your tap.",
      "Only refunds happen without your yes; a price event never charges anything.",
    ],
  },
  { title: "A cap on every rebuy", lines: ["You set a cap for each rebuy when you save PayPal or a card; a rebuy above it is refused."] },
  { title: "Charged once", lines: ["Tap yes twice and you are charged once."] },
];

/** The landing page. `film` shows it as filming mode does: generic names and images (served at /filming). */
export default function LandingPage({ film = false }: { film?: boolean }) {
  const held = heldOutResult();
  const x = landingSample(film);
  const bars = [
    { label: APP_NAME, value: held.skipCorrect, mine: true },
    { label: "Skipping anything in a category you own", value: baselineScore(held, "same-category") },
    { label: "Saying skip to everything", value: baselineScore(held, "always-skip") },
  ];
  return (
    <main className={s.landing}>
      <LandingMotion />

      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroCopy}>
          <Eyebrow icon="post">For skincare and makeup you saw on your feed</Eyebrow>
          <h1 className={s.title}>Already own one? Don&apos;t buy it twice.</h1>
          <p className={s.lede}>
            Send {APP_NAME} the post before you pay. It checks what&apos;s already on your shelf, your budget, the price history and the store&apos;s return policy, then tells you to skip it, wait or buy.
          </p>
          <div className={s.ctas}>
            <Link className="btn" href="/week">
              Hand it your week
            </Link>
            <Link className="btn outline" href="/check">
              Check a post
            </Link>
          </div>
          <p className={s.startHere}>
            {WEEK_TAGLINE} New here? <Link href="/judge">Start here</Link>.
          </p>
        </div>
        <div className={s.heroSlot}>
          <HeroObject film={film} />
        </div>
      </section>

      {/* Proof */}
      <section className={`${s.proof} lit-sheen`} aria-labelledby="proof-title" data-reveal>
        <div className={s.proofHead}>
          <Eyebrow as="h2" icon="chart" id="proof-title" className={s.proofEyebrow}>
            How often skip is right
          </Eyebrow>
          <p className={s.proofFigure} aria-hidden="true">
            <CountUp value={held.skipCorrect} />
            <span className={s.proofOf}>/{held.n}</span>
          </p>
          <p className={s.proofText}>{heldOutHeadline(held)}</p>
          <Link className={`btn outline ${s.onField}`} href="/proof">
            Every case and every miss
          </Link>
        </div>
        <ul className={s.bars} aria-label={`Right skips out of ${held.n}`}>
          {bars.map((b) => (
            <li key={b.label} className={b.mine ? s.barMine : undefined}>
              <span className={s.barLabel}>{b.label}</span>
              <span className={s.barTrack}>
                <span className={s.barFill} style={{ width: `${(b.value / held.n) * 100}%` }} />
              </span>
              <span className={s.barValue}>
                <CountUp value={b.value} />
              </span>
            </li>
          ))}
          <li className={s.scale} aria-hidden="true">
            <span>0</span>
            <span>{held.n} products</span>
          </li>
        </ul>
      </section>

      {/* How it works */}
      <section className={s.how} aria-labelledby="how-title">
        <h2 id="how-title" className={s.sectionTitle}>
          How it works
        </h2>
        <div className={s.chainPanel}>
          <Lotion className={s.chainMaterial} sizes="(min-width: 960px) 72rem, 100vw" />
          <ol className={s.steps}>
            <li className={s.step} data-reveal>
              <Eyebrow icon="post">The post</Eyebrow>
              <div className={s.stepCard} aria-hidden="true">
                <div className={s.post}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={film ? productImage("/samples/spf-cvs.png") : "/samples/spf-cvs.png"} alt="" width={600} height={900} loading="lazy" />
                </div>
              </div>
              <h3>Send the post</h3>
              <p>Upload a screenshot of the post or paste the store link.</p>
            </li>
            <li className={s.step} data-reveal>
              <Eyebrow icon="check">The verdict</Eyebrow>
              <div className={s.stepCard} aria-hidden="true">
                <div className={`card ${s.evidenceCard}`}>
                  <p className={s.miniVerdict}>
                    <span className="chip skip">Skip</span>
                  </p>
                  <dl className="evidence">
                    <dt>On your shelf</dt>
                    <dd>
                      {film ? x.shelf.name : `${x.shelf.brand} ${x.shelf.name}`}: {x.shelf.relation} (match {x.shelf.matchPercent}%).
                    </dd>
                    {x.returns && (
                      <>
                        <dt>Returns</dt>
                        <dd>{x.returns}</dd>
                      </>
                    )}
                    <dt>Price</dt>
                    <dd>{x.priceLine}</dd>
                  </dl>
                </div>
              </div>
              <h3>It checks, then answers</h3>
              <p>Your shelf, your budget, the price history and the store&apos;s return policy decide skip, wait or buy, with the reason in one line.</p>
            </li>
            <li className={s.step} data-reveal>
              <Eyebrow icon="yes">Your yes</Eyebrow>
              <div className={s.stepCard} aria-hidden="true">
                <div className={`card ${s.buyCard}`}>
                  <div className="brand-line">{x.buy.brand}</div>
                  <div className="name-line">{x.buy.name}</div>
                  <span className={`btn block ${s.fakeBtn}`}>Buy for {x.buy.priceLabel} with PayPal</span>
                  <p className="small muted">Sold by {SELLER_OF_RECORD}.</p>
                </div>
              </div>
              <h3>You decide</h3>
              <p>Skip it, wait for a better price or next month&apos;s budget, or buy it with PayPal.</p>
            </li>
          </ol>
        </div>
        <div className={s.studio} data-reveal>
          <p>
            <strong>On a laptop:</strong> the dashboard puts your verdicts, rebuys, shelf and budgets in one AG Studio workspace, and pays a due rebuy from inside it.
          </p>
          <Link className="btn outline small" href="/studio">
            Open the dashboard
          </Link>
        </div>
      </section>

      {/* The yes stays yours */}
      <section className={s.yes} aria-labelledby="yes-title">
        <div className={s.yesCopy}>
          <h2 id="yes-title" className={s.sectionTitle}>
            The yes stays yours
          </h2>
          <p className={s.yesLede}>
            Spending limits decide how much an AI shopping agent may spend; {APP_NAME} decides whether to buy at all. For the things you buy again, like a cleanser, a rebuy card asks you first.
          </p>
          <ul className={s.points}>
            {YES_POINTS.map((p) => (
              <li key={p.title} data-reveal>
                <h3>{p.title}</h3>
                {p.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </li>
            ))}
          </ul>
        </div>
        <div className={s.yesPanel} data-reveal>
          <Lotion className={s.yesMaterial} sizes="(min-width: 960px) 32rem, 100vw" />
          <div className={s.yesFrame} aria-hidden="true">
            <article className={`approval ${s.approval}`}>
              <div className="approval-head">
                <div>
                  <div className="brand-line">{x.staple.brand}</div>
                  <h3>{x.staple.name}</h3>
                  <p className="small muted">
                    Runs out in {x.staple.daysLeft} {x.staple.daysLeft === 1 ? "day" : "days"}. Last bought at {x.staple.store}.
                  </p>
                </div>
                <div className="amount">{x.staple.amountLabel}</div>
              </div>
              <div className={s.approvalActions}>
                <span className={`btn ${s.fakeBtn}`}>Yes, rebuy for {x.staple.amountLabel}</span>
                <span className={`btn outline ${s.fakeBtn}`}>Pay another way</span>
              </div>
              <p className="small muted">Charged to PayPal only when you tap yes. Your cap is {x.staple.capLabel} per rebuy.</p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
