# LookLook

Before you buy what you saw on your feed, LookLook checks it, and its most common answer is skip.

Work in progress. Payments run in the PayPal sandbox only.

## What works today

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
```

`DEMO_NEGATIVE_TESTING=1` allows PayPal's sandbox failure simulation (for example a declined card on a rebuy). Without it the app never sends the simulation header.

Raw product-data responses are cached only under `data/cache/`, which is not committed.

## Deploy

`render.yaml` describes a Render web service: `npm ci && npm run build`, then `npm start` (listens on `$PORT`), with a health check at `/api/health`.

## Licence

MIT
