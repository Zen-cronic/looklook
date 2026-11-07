# LookLook

**Skip correctness: 55 of 65 skip decisions match answers written down before the engine ran** (skip precision 91.4%, recall 82.1%), on 65 real products against a fictional shopper's shelf. Every wrong and missed skip is listed in [`eval/skip-set/RESULTS.md`](eval/skip-set/RESULTS.md); `npm run eval:skip` recomputes it with no network calls.

Before you buy what you saw on your feed, LookLook checks it, and its most common answer is skip.

Work in progress. Payments run in the PayPal sandbox only.

## What works today

- **Verdicts** in `lib/verdict`: skip, wait, buy or ask, decided by twelve ordered rules that read only structured fields: the product and its category, shelf matches and their similarity scores, the store's return-once-opened policy, the budget left, the cleaned price band and run-out dates. Each verdict carries its evidence (the rule that fired, the shelf item, the policy URL, the price target). Anything that can't be resolved lands on ask or wait, never buy. The model never decides; it only writes the one-line reason after the verdict is set.
- **Screenshot reader** in `lib/vision`: Claude (`claude-sonnet-5-5`, structured output against a strict JSON schema) reads brand, product name, shade, size, price, store, whether it's a creator post or a store page, and key attributes. A catalogue text search follows and the best match is scored in code; a weak or tied match asks you to confirm.
- **Shelf** in `lib/shelf`: what you already own, with category, key attributes (active, finish, form, shade family), opened state and run-out date. Similarity is deterministic. Items come from manual add, the app's own orders, or PayPal activity (behind `SHELF_IMPORT_PAYPAL=1`; it needs the Transaction Search permission and falls back cleanly without it).
- **Return policies** in `data/return-policies.json`: whether Sephora, Ulta, Target, CVS, Walgreens and Kohl's take an item back once opened, with the window, conditions, source URL and the date checked. Unknown answers stay unknown and count as not returnable.
- **PayPal (sandbox)** in `lib/paypal`: checkout with the PayPal wallet or a card (Orders v2), saving a method for later (Vault v3 setup and payment tokens), a one-tap rebuy on the saved method after the buyer's yes (a customer-initiated payment, capped per rebuy), partial and full refunds, revoking a saved method, and webhook signature verification at `POST /api/webhooks/paypal`. Payment results are read from the capture status, because a declined card can still return a completed order. Every POST carries a `PayPal-Request-Id`; a rebuy's id is built from the item and the cycle, so two triggers for the same item and cycle charge once.
- **Product data** in `lib/channel3`: search, product detail, 90-day price history, and price-drop subscriptions. Histories are cleaned before any decision (junk points, one-day blips, and sizes or sellers mixed into one series), and listings of the same item are merged by normalised title.
- **Replay** in `lib/replay` and `scripts/replay`: tests the wait rule on real price histories against buying on the first price alert. The rule is fixed on days 1–60 and tested unchanged on days 61–90. Only timing is measured; a skipped purchase is never counted as money saved. The product list is frozen in `data/replay/products.json` and the latest result is in `data/replay/result.json`.

## Setup

Node 22 or later.

```bash
npm install
cp .env.example .env   # fill in sandbox PayPal keys and the product-data key
npm run dev
```

## Checks

```bash
npm run eval:skip        # skip correctness on the fixed test set (no network)
npm test                 # unit tests
npm run lint
npm run typecheck
npm run build

npm run replay               # recompute the replay from the local cache
npm run replay -- --fetch    # fetch any history not cached yet
npm run replay -- --select   # rebuild and freeze the product list (uses API calls)

PAYPAL_SMOKE=1 DEMO_NEGATIVE_TESTING=1 npm run smoke:paypal   # live sandbox run
CHANNEL3_SMOKE=1 npm run smoke:channel3                       # live product-data run
npm run spike:transaction-search    # does PayPal activity include item lines?
VISION_SMOKE=1 npm run smoke:vision -- screenshot.png          # live screenshot to verdict
npm run eval:skip:bands -- --fetch  # rebuild the test set's price bands (uses API calls)
```

`DEMO_NEGATIVE_TESTING=1` allows PayPal's sandbox failure simulation (for example a declined card on a rebuy). Without it the app never sends the simulation header.

Raw product-data responses are cached only under `data/cache/`, which is not committed.

## What we'll tell you before you find it

- The skip test set's shelf, budgets and expected answers are made up by one person for a fictional shopper. The products, prices and store policies are real.
- Ten of 65 skip decisions disagree with the written answers. The causes are listed in `eval/skip-set/RESULTS.md`: a second concealer, setting spray or lip oil whose finish or tint differs is not treated as a duplicate; earbuds score as overlapping with over-ear headphones; and a differently named listing of a product you already own is treated as a near-duplicate rather than a restock.
- 29 of the 65 test cases are at stores outside the policy table (brand sites and other retailers). Their opened-return policy is unknown and treated as not returnable, which decides 7 of the skips. Sephora's and Kohl's own returns pages blocked automated reading on the check date, so their entries cite other pages from the same companies.
- Price bands follow each catalogue listing's headline offer, not a single seller.

## Deploy

`render.yaml` describes a Render web service: `npm ci && npm run build`, then `npm start` (listens on `$PORT`), with a health check at `/api/health`.

## Licence

MIT
