# LookLook

*look twice before you buy*

For anyone who buys skincare and makeup they saw on their feed and ends up with a second of something they already own: LookLook checks the post against your shelf, your budget, the price history and the store's return policy before you pay.

<img src="docs/verdict-skip.png" alt="A skip verdict on a phone: you already own a sunscreen that does the same job, and CVS may refuse it once opened" width="320">

**60 of 65 skip decisions match answers written down before the engine ran.** Saying skip to everything gets 39 of 65; skipping anything in a category you already own gets 40 of 65. Of the 35 right skips, 28 rest on evidence (the shelf, or a cited store policy) and 7 on our default that an unknown opened-return policy counts as not returnable; together they avoid $2,481.21 of duplicate or hard-to-return buys. Every wrong and missed skip is in [`eval/skip-set/RESULTS.md`](eval/skip-set/RESULTS.md) and on the app's `/proof` page; `GET /api/eval/skip` and `npm run eval:skip` recompute it with no network calls.

PayPal's shopping tools help you buy what you saw. LookLook asks whether you should, and when it's a staple, PayPal Vault makes buying it again one yes.

Before you buy what you saw on your feed, LookLook checks it, and its most common answer is skip. Send it a screenshot of a creator post or a store link. It reads the product, finds it in the catalogue, and checks it against what you already own, this month's budget, the 90-day price history and whether the store takes it back once opened. Then it says **skip**, **wait**, **buy** or asks you to confirm, with the one-line reason and the evidence behind it, and lists the same product at other stores with what each store does with opened items. A wait says what it is waiting for: next month's budget (with a reminder), a lower price (with a price watch, the 90-day trend and the target), or the one you own running low.

The things you do buy again (a cleanser, a moisturizer) come back as one-tap rebuys: when a staple nears its run-out date or a watched price drops, you get an approval card, and only your yes charges the payment method you saved with PayPal.

## Try it

Open `/judge` on the running app for six short steps. Sandbox PayPal buyer login and test card: see the testing instructions on the project's submission page.

1. **Check a post.** Four sample posts (mock posts of real products) are on the Check page, or upload your own screenshot or paste a store link.
2. **Buy once and save PayPal for rebuys.** The checkout shows the save-for-later agreement and a per-rebuy cap, then the PayPal buttons and card fields.
3. **Rebuy with one yes.** On Rebuys, move the simulated date a week ahead; staples due within five days ask for your yes.
4. **See a decline and recover.** A labelled sandbox switch makes the next rebuy answer `INSTRUMENT_DECLINED`; the card asks you to approve another method.
5. **Wait for a lower price.** A wait verdict can start a real Channel3 price alert; a labelled test drop runs a price event through the same handler.
6. **See the events and the number.** `/events` lists every webhook and whether it verified; `/proof` re-runs the 65-case test.

## Sponsor technology

| Service | What it does here |
|---|---|
| PayPal JS SDK (Buttons and Card Fields) | The shopper approves the first purchase with the PayPal wallet or a card. |
| PayPal Orders v2 | Creates and captures every payment; success is read from the capture status, because a declined card can still return a completed order. |
| PayPal Vault v3 (save during purchase) | Saves the wallet or card for later under a short customer id, only when the shopper ticks the save box. |
| Customer-initiated charges on a saved method | Each rebuy is the shopper's yes on an approval card (`payment_initiator: CUSTOMER`, `usage: SUBSEQUENT`), capped per rebuy. |
| `PayPal-Request-Id` idempotency | One id per shopper, item and cycle, and saved method, so a repeated yes, or a price drop and a run-out date for the same item, charge once. |
| Payment token delete | Saved methods: remove a method and confirm PayPal no longer has it. |
| Refunds | A charge can be refunded in full from its receipt. |
| Webhooks + verify-webhook-signature | `/api/webhooks/paypal` verifies every delivery with PayPal, handles a repeated event id once, and confirms receipts and removed methods. |
| Negative testing | Behind `DEMO_NEGATIVE_TESTING=1`: the labelled switch that makes the next rebuy decline. |
| Channel3 search and URL lookup | Finds the catalogue product behind a screenshot (text search on what Claude read) or a pasted link. |
| Channel3 product detail and offers | The same product at other stores on a verdict, each joined with that store's opened-return policy; only the store, price and link are kept (cached for a day, never committed). |
| Channel3 price history | 90-day history, filtered to one size and steady points, gives the usual price, the low, the price to wait for and the weekly trend line. |
| Channel3 product subscriptions + webhooks | A wait verdict starts a price-drop subscription; `/api/webhooks/channel3` checks the signature, handles a repeated event once, and turns a drop to the target into an approval card. |
| Channel3 buy links | The product link on a verdict, with the commission notice next to it. |
| Claude (`claude-sonnet-5-5`) | Reads a screenshot or a listing into structured fields (strict JSON schema), and words the one-line reason after the verdict is decided. |
| Render | One web service runs the app, the API and both webhook endpoints (`render.yaml`). |

## How a verdict is decided

The model observes; code decides. Claude turns the screenshot into fields (brand, name, price, store, key attributes); a catalogue match is scored in code, and a weak or tied match asks you to confirm. Twelve ordered rules then decide from structured fields only: shelf similarity, run-out dates, the store's cited return-once-opened policy, the budget left and the cleaned price band. Anything unresolved lands on ask or wait, never buy. Money moves only after your tap, on a method you saved, under the cap you set.

Most big beauty stores take opened beauty back (Sephora, Ulta, Target and Kohl's do; CVS may refuse it; Walgreens leaves it to the manager), so the return line is usually reassurance ("Ulta Beauty takes opened beauty back within 30 days, so trying it is low risk") and a reason to skip only where the cited policy refuses opened items or no policy was found.

## Run it

Node 22 or later.

```bash
npm install
cp .env.example .env   # sandbox PayPal keys, Channel3 key, Anthropic key
npm run dev            # or: npm run build && npm start
```

Each browser gets its own session (a cookie) with the sample shelf. Sessions, the webhook event log and caches are written under `.data/` (`APP_DATA_DIR`).

## Checks

```bash
npm run eval:skip        # skip correctness on the fixed test set (no network)
npm test                 # unit tests
npm run lint
npm run typecheck
npm run build

npm run replay               # wait-timing replay from the local cache
PAYPAL_SMOKE=1 DEMO_NEGATIVE_TESTING=1 npm run smoke:paypal   # live sandbox run of the payment library
CHANNEL3_SMOKE=1 npm run smoke:channel3                       # live product-data run
VISION_SMOKE=1 npm run smoke:vision -- screenshot.png          # live screenshot to verdict
```

## Real and sandbox

- Real: the product catalogue, prices, 90-day price histories and price alerts (Channel3), the screenshot and listing reading (Claude), and the store return policies, each with its source page and the date checked.
- Sandbox: every PayPal payment. Money goes to a PayPal sandbox merchant account presented as "LookLook Test Store"; no real money moves.
- Simulated, and labelled in the app: the date control on Rebuys, the test price drop, and the forced decline.

## What we'll tell you before you find it

- **Who sells what.** Checkout and rebuys inside LookLook are sold by "LookLook Test Store (PayPal sandbox)", a PayPal sandbox merchant, not by the retailer in the post; the store names on a verdict are links to the retailers, and we may earn a commission when you buy through them.
- **PayPal activity import is off.** Filling the shelf from PayPal activity needs the Transaction Search permission on the PayPal app, which this sandbox app doesn't have yet (403). The shelf comes from manual adds and purchases made in the app.
- **Waiting saves little on beauty.** In the wait-timing replay (28 purchases, real price histories), waiting by our rule paid $58.56 (1.7%) less than buying on the first price alert, and only $1.07 of that was beauty. For beauty the value is in the skip, not the wait.
- The skip test set's shopper, shelf, budgets and expected answers are made up by one person. Five of 65 skip decisions disagree with them; the causes are listed in `eval/skip-set/RESULTS.md`. 29 of the 65 cases are at stores outside the policy table, where an unknown policy counts as not returnable; 7 of the 35 right skips depend on that default.
- The first scored run was 55 of 65. Since then the similarity rule changed once (product type, actives, finish and form compared with half credit for neighbouring values; see `eval/skip-set/provenance.json`); the expected answers were not touched. A first version of that change scored 58 of 65 before its actives rule was replaced; both runs are recorded in `eval/skip-set/README.md`.
- Dates: receipts, notices, refunds and event times are real, in US Eastern time. The Rebuys date control moves only run-out dates and this month's budgets, and every page that uses it says "Simulated date".
- The four sample posts are mock creator posts we drew; the products and prices in them are real.
- Two sandbox behaviours we design around: two simultaneous order requests with the same `PayPal-Request-Id` created two orders (sequential repeats return the first), so same-key payment calls are merged in the app before they reach PayPal; and a payment token deleted seconds after it was saved came back a few seconds later, so removal repeats the delete until two checks find nothing. Both are handled inside one process: run a single instance.
- PayPal's sandbox Orders API rejects a `PayPal-Request-Id` of about 70 characters or more with a bare 422, so longer ids are hashed to at most 64.
- On Render's free plan the disk is reset on each deploy and restart, which clears sessions and the event log.
- Price bands follow each catalogue listing's headline offer, not a single seller.

## Deploy

`render.yaml` describes one Render web service: `npm ci && npm run build`, then `npm start` on `$PORT`, health check `/api/health`, auto-deploy off. Secrets are entered in the Render dashboard. After the first deploy, register `https://<service>.onrender.com/api/webhooks/paypal` in the PayPal app (copy its webhook ID to `PAYPAL_WEBHOOK_ID`) and `https://<service>.onrender.com/api/webhooks/channel3` in the Channel3 dashboard (copy its signing secret to `CHANNEL3_WEBHOOK_SECRET`).

## Licence

MIT
