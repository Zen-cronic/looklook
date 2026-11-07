# Held-out skip set

30 real products the verdict engine has never been tuned on, with the verdict a careful friend would give, written down and committed before the engine saw any of them. It exists because the first set (`eval/skip-set/`) has been used to improve the matching code, so its score is partly fitted. This set gets scored once.

- `cases.json`: the products (brand, name, category, key attributes, store, the price shown) and the expected verdict, reasons and a one-line why. Same format as `eval/skip-set/cases.json`.
- `shelf.json`: the shelf and monthly budgets of **Priya, a fictional shopper**, different from Sam in the first set. Nothing in it is anyone's real shelf. The products on it are real; that she owns them, when she opened them and when they run out are invented. A case can patch one shelf item (`shelfPatch`).
- `price-bands.json`: derived price statistics (typical, low, high, latest) from each product's cleaned 90-day catalogue history. Raw histories are never committed.
- `price-bands.ts`: writes `price-bands.json` from the local cache (`npx tsx eval/holdout/price-bands.ts`, add `--fetch` to fill the cache).
- `RESULTS.md` and `results.json`: added by the single scored run, in a later commit.

## How it was built (2026-11-07)

1. **Products.** Picked from Channel3 catalogue searches with the existing client (`scripts/skip-set/candidates.ts`). No product in `eval/skip-set/cases.json` or either shelf is reused (checked by brand and name and by catalogue id). 22 are beauty and hair (serums, moisturizers, sunscreens, cleansers, foundation, concealer, lipstick, lip oil, setting spray, shampoo, conditioner, hair oil) and 8 are gadgets and kitchen (earbuds, over-ear headphones, a drip coffee maker, an air fryer, a personal blender, a kettle).
2. **Facts.** Product type, key actives, finish, coverage, form and size were checked against brand and retailer product pages (Tavily search on 2026-11-07) and the catalogue's own product text. Where a page didn't settle a detail, it was left out rather than guessed (for example the TIRTIR sunscreen's finish and the Cetaphil cleanser's actives). Raw search responses stay in `data/cache/` (gitignored).
3. **Prices.** `priceShown` is the product's latest catalogue price, as in the first set. Bands come from `priceBand` in `lib/channel3` over 90 days of history.
4. **Stores.** 13 cases are at stores in `data/return-policies.json` (Ulta, Sephora, Target, Kohl's, CVS) and 17 at stores outside it, where the opened-return policy is unknown.
5. **Expectations.** Written by hand from the facts, the shelf, the budgets, the store and the price band, using only the plain-language rules below.

## How expectations were written

Checked in this order; the first that applies decides.

1. **Ask** when the product can't be identified from the post (`identityConfidence` below 0.5) or the post shows no price.
2. **Skip** when the shopper already owns something that does the same job and it doesn't run out within 7 days. Same job means the same category and the same kind of thing: the same main active for serums, the same texture for moisturizers, a face sunscreen for a face sunscreen, the same shade family for lipstick, the same style for headphones, the same kind of appliance. A different finish of the same kind (sheer instead of dewy sunscreen, luminous instead of matte foundation, matte instead of dewy setting spray) is still the same job. An unopened one on the shelf counts. A store that takes opened beauty back doesn't turn a skip into a buy; a store that refuses opened items, or has no policy on file, adds `overlap-non-returnable` as a reason.
3. **Wait, not needed yet** when it is exactly the product already in use and that one isn't running out.
4. **Wait, over budget** when the price is more than the category has left this month.
5. **Wait, above usual price** when the price is clearly above the typical price of a usable band.
6. **Buy** when it replaces something of the same kind that runs out within 7 days (`replacing-run-out`), or nothing on the shelf does this job (`clear-to-buy`), and it fits the budget at or below its usual price.

Expected mix: 13 skip, 8 buy, 6 wait, 3 ask.

Hard cases on purpose:

- Same kind, different name: h01, h02, h04, h08, h09, h11, h12, h13, and h06 (the cleanser lasts until March in that scenario).
- Different finish of the same kind: h05, h07, h10.
- Skips at stores that take opened beauty back: h04 (Ulta), h05 (Sephora), h06 (Target), h08 and h10 (Kohl's).
- Same category, different job: h17 and h22 (vitamin C when the shelf has retinol and azelaic acid), h18 (body sunscreen, face one owned), h19 (berry lipstick, red owned), h21 and h25 (over-ear headphones, earbuds owned).
- Replacing a run-out with a different product: h14 (azelaic acid), h16 (shampoo); the same need over budget: h23.
- Buys at stores with unknown policies, where nothing overlaps: h16, h17, h18, h21.

## Blindness rules

Before the expectations were committed:

- Not read: the verdict engine and matching code (`lib/verdict/`, the shelf similarity code), the eval scorer (`lib/eval/`), their tests, and `eval/skip-set/results.json` and `RESULTS.md`.
- Not run: the engine, `npm run eval:skip`, the app.
- Read: `eval/skip-set/cases.json` and `shelf.json` (for the file format and to avoid reusing products), `eval/skip-set/README.md` (which includes a plain description of the similarity change made after the first run), the "How a verdict is decided" section of the top-level README, `data/return-policies.json`, and the catalogue client and price band code in `lib/channel3/`.

After the commit, a runner reusing the existing scorer runs once. Its output is committed as generated, and neither the expectations nor the engine are changed after seeing it.

## After later changes

The scored run in `results.json` and the top of `RESULTS.md` is the held-out result and is never rewritten. The runner refuses to overwrite it: once `history.json` records the scored run, `npm run eval:holdout -- --what "..."` runs the committed engine on the same cases and expectations, checks that `RESULTS.md` still starts with the scored run's text, rewrites only its "After later changes" section and adds the run to `history.json`. Those runs are on code that these products helped shape, so they are reported as after-change numbers, not held-out ones.
