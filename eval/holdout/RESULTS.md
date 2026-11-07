# Held-out skip correctness

Generated once by `npm run eval:holdout` at 2026-11-07 00:19:52 EST. Do not edit by hand.

**28 of 30 skip decisions correct.** Skip precision 92.3% (12 of 13 skips were right), recall 92.3% (12 of 13 expected skips caught).

| Way of deciding skip | Skip decisions correct | Skips made | Skips right |
|---|---|---|---|
| Always say skip | 13 of 30 | 30 | 13 |
| Skip whenever you own anything in the same category | 19 of 30 | 24 | 13 |
| The verdict engine | 28 of 30 | 13 | 12 |

- Of the 12 correct skips, 10 were decided on evidence (the shelf, or a cited policy that refuses opened returns or takes them only on conditions) and 2 needed the default that counts an unknown opened-return policy as not returnable.
- Duplicate or non-returnable spending avoided on correct skips: $470.25 (sum of the prices shown; $312.26 on evidence, $157.99 on the unknown-policy default).
- Wrong skips (skipped when it shouldn't): 1
- Missed skips (should have skipped): 1
- Near-duplicates caught: 9
- Full verdict agreement (skip, wait, buy, ask): 76.7%; deciding reason matches an expected one in 95.7% of agreeing cases.

Test set: 30 real products not in the first skip set, Priya (fictional) with her own shelf and budgets, the scenario's "today" set to 2026-11-07, and expected verdicts written by hand and committed before the engine saw them. See `README.md` in this folder.

## Order of work

| Step | Commit | When (US Eastern) |
|---|---|---|
| Engine and scorer as last changed before the expectations | 4fbf420 | 2026-11-06 22:28:30 EST |
| Expectations, shelf and price bands committed | effe79b | 2026-11-07 00:17:29 EST |
| This run, on the code at | effe79b | 2026-11-07 00:19:52 EST |

No engine or scorer file changed between the expectations commit and this run, and none had uncommitted changes. The results are committed in the commit after effe79b; the expectations are not changed after this run.

Runner and fixture changes needed for a clean run: The first attempt stopped before deciding any case: the shelf check rejected the category `lip-balm`, because the app knows 16 categories. The runner now leaves out shelf items in categories the app can't hold (sh-lipbalm, lip-balm; sh-hairoil, hair-oil) and passes cases in such categories with no category, as the app does for a catalogue category it doesn't map (h20, conditioner; h24, hair-oil; h27, kettle; h29, conditioner); the engine's first rule then asks. Expectations and engine are unchanged. Both baselines use the same inputs as the engine; on the shelf and categories as written, the same-category baseline would score 18 of 30.

Engine settings: identity confidence at least 0.7, lead time 14 days, urgent within 3 days, price tolerance 0.05, minimum depth 0.03, well above typical at +10%.

## Wrong skips

| Case | Product | Store | Expected | Engine (rule that fired) | Evidence |
|---|---|---|---|---|---|
| h18 | Lather Daily Defense Mineral SPF 50 Body Sunscreen | lather.com | buy (clear-to-buy) | skip (overlap-non-returnable) | closest: Beauty of Joseon Relief Sun: Rice + Probiotics SPF50+ (overlap, 0.64); Brand site or other store: opened unknown |

## Missed skips

| Case | Product | Store | Expected | Engine (rule that fired) | Evidence |
|---|---|---|---|---|---|
| h10 | Anastasia Beverly Hills Impeccable 24hr Blurring Matte Setting Spray | kohls | skip (owns-similar) | buy (clear-to-buy) | closest: Milani Make It Dewy Setting Spray (overlap, 0.60); Kohl's: opened yes |

## Other disagreements (not about skip)

| Case | Product | Store | Expected | Engine (rule that fired) | Evidence |
|---|---|---|---|---|---|
| h14 | The INKEY List SuperSolutions 10% Azelaic Acid Serum | ulta | buy (replacing-run-out) | wait (above-usual-price) | no other shelf item in this category; replaces The Ordinary Azelaic Acid Suspension 10% (5 days left); Ulta Beauty: opened yes |
| h15 | La Roche-Posay Toleriane Hydrating Gentle Cleanser | ulta | buy (replacing-run-out) | wait (above-usual-price) | no other shelf item in this category; replaces La Roche-Posay Toleriane Hydrating Gentle Cleanser (6 days left); Ulta Beauty: opened yes |
| h20 | Lush Glory Conditioner | ulta | buy (clear-to-buy) | ask (identity-unconfirmed) | no other shelf item in this category;  |
| h24 | OUAI Hair Oil | kohls | wait (not-needed-yet) | ask (identity-unconfirmed) | no other shelf item in this category;  |
| h27 | Fellow Corvo EKG Pro Electric Kettle | bestbuy.com | wait (over-budget) | ask (identity-unconfirmed) | no other shelf item in this category;  |

## Confusion (rows expected, columns engine)

| | skip | wait | buy | ask |
|---|---|---|---|---|
| skip | 12 | 0 | 1 | 0 |
| wait | 0 | 4 | 0 | 2 |
| buy | 1 | 2 | 4 | 1 |
| ask | 0 | 0 | 0 | 3 |

## Every case

| Case | Product | Store | Expected | Engine (rule that fired) | Evidence |
|---|---|---|---|---|---|
| h01 | MD Solar Sciences Evening Retinol Serum | dermstore.com | skip (owns-similar, overlap-non-returnable) | skip (overlap-non-returnable) | closest: The Ordinary Retinol 0.5% in Squalane (overlap, 0.63); Brand site or other store: opened unknown |
| h02 | Pacifica Vegan Ceramide Barrier Face Lotion | pacificabeauty.com | skip (owns-similar, overlap-non-returnable) | skip (owns-similar) | closest: Vanicream Daily Facial Moisturizer (near-duplicate, 1.00); Brand site or other store: opened unknown |
| h03 | L'Occitane Shea Ultra Rich Comforting Face Cream | skincareessentials.com | skip (owns-unopened, owns-similar, overlap-non-returnable) | skip (owns-similar) | closest: First Aid Beauty Ultra Repair Cream (near-duplicate, 1.00); Brand site or other store: opened unknown |
| h04 | TIRTIR Hydro UV Shield Sunscreen SPF 50+ | ulta | skip (owns-similar) | skip (owns-similar) | closest: Beauty of Joseon Relief Sun: Rice + Probiotics SPF50+ (near-duplicate, 0.96); Ulta Beauty: opened yes |
| h05 | Innisfree Daily UV Defense Sunscreen | sephora | skip (owns-similar) | skip (owns-similar) | closest: Beauty of Joseon Relief Sun: Rice + Probiotics SPF50+ (near-duplicate, 0.96); Sephora: opened yes |
| h06 | Cetaphil Hydrating Gentle Skin Cleanser | target | skip (owns-similar) | skip (owns-similar) | closest: La Roche-Posay Toleriane Hydrating Gentle Cleanser (near-duplicate, 0.90); Target: opened yes |
| h07 | Fenty Beauty Soft'Lit Naturally Luminous Longwear Foundation | spacenk.com | skip (owns-similar, overlap-non-returnable) | skip (owns-similar) | closest: Estée Lauder Double Wear Stay-in-Place Foundation (near-duplicate, 0.80); Brand site or other store: opened unknown |
| h08 | NARS Soft Matte Complete Concealer | kohls | skip (owns-similar) | skip (owns-similar) | closest: Tarte Shape Tape Full Coverage Concealer (near-duplicate, 0.95); Kohl's: opened yes |
| h09 | NYX Professional Makeup Fat Matte Smooth Color Lipstick (a red shade) | cvs | skip (owns-similar, overlap-non-returnable) | skip (owns-similar) | closest: Charlotte Tilbury Matte Revolution Lipstick (near-duplicate, 0.90); CVS Pharmacy: opened no |
| h10 | Anastasia Beverly Hills Impeccable 24hr Blurring Matte Setting Spray | kohls | skip (owns-similar) | buy (clear-to-buy) | closest: Milani Make It Dewy Setting Spray (overlap, 0.60); Kohl's: opened yes |
| h11 | JBL Tune Flex 2 True Wireless Noise Cancelling Earbuds | nordstrom.com | skip (owns-similar, overlap-non-returnable) | skip (owns-similar) | closest: Apple AirPods Pro 2 (near-duplicate, 0.90); Brand site or other store: opened unknown |
| h12 | GE 12 Cup Drip Coffee Maker with Adjustable Keep Warm Plate | target | skip (owns-similar, overlap-non-returnable) | skip (overlap-non-returnable) | closest: OXO Brew 8-Cup Coffee Maker (overlap, 0.75); Target: opened no |
| h13 | Chefman TurboFry Touch 6-Quart Air Fryer | samsclub.com | skip (owns-similar, overlap-non-returnable) | skip (overlap-non-returnable) | closest: Instant Pot Vortex Plus 6-Quart Air Fryer (overlap, 0.75); Brand site or other store: opened unknown |
| h14 | The INKEY List SuperSolutions 10% Azelaic Acid Serum | ulta | buy (replacing-run-out) | wait (above-usual-price) | no other shelf item in this category; replaces The Ordinary Azelaic Acid Suspension 10% (5 days left); Ulta Beauty: opened yes |
| h15 | La Roche-Posay Toleriane Hydrating Gentle Cleanser | ulta | buy (replacing-run-out) | wait (above-usual-price) | no other shelf item in this category; replaces La Roche-Posay Toleriane Hydrating Gentle Cleanser (6 days left); Ulta Beauty: opened yes |
| h16 | Divi Hydrating Shampoo | diviofficial.com | buy (replacing-run-out) | buy (replacing-run-out) | no other shelf item in this category; replaces Moroccanoil Hydrating Shampoo (7 days left); Brand site or other store: opened unknown |
| h17 | Timeless Skin Care 10% Vitamin C + E Ferulic Acid Serum | macys.com | buy (clear-to-buy) | buy (clear-to-buy) | no other shelf item in this category; Brand site or other store: opened unknown |
| h18 | Lather Daily Defense Mineral SPF 50 Body Sunscreen | lather.com | buy (clear-to-buy) | skip (overlap-non-returnable) | closest: Beauty of Joseon Relief Sun: Rice + Probiotics SPF50+ (overlap, 0.64); Brand site or other store: opened unknown |
| h19 | M·A·C Lustreglass Sheer-Shine Lipstick (a berry shade) | ulta | buy (clear-to-buy) | buy (clear-to-buy) | closest: Charlotte Tilbury Matte Revolution Lipstick (different, 0.50); Ulta Beauty: opened yes |
| h20 | Lush Glory Conditioner | ulta | buy (clear-to-buy) | ask (identity-unconfirmed) | no other shelf item in this category;  |
| h21 | Edifier W820NB Plus Gen 2 Wireless Over-ear Noise Cancelling Headphones | edifier-online.com | buy (clear-to-buy) | buy (clear-to-buy) | closest: Apple AirPods Pro 2 (different, 0.40); Brand site or other store: opened unknown |
| h22 | SkinCeuticals C E Ferulic | stylevana.com | wait (over-budget) | wait (over-budget) | no other shelf item in this category; Brand site or other store: opened unknown |
| h23 | Oribe Supershine Hydrating Shampoo | modaoperandi.com | wait (over-budget) | wait (over-budget) | no other shelf item in this category; replaces Moroccanoil Hydrating Shampoo (7 days left); Brand site or other store: opened unknown |
| h24 | OUAI Hair Oil | kohls | wait (not-needed-yet) | ask (identity-unconfirmed) | no other shelf item in this category;  |
| h25 | Bose QuietComfort 45 SE Wireless Over-Ear Noise Cancelling Headphones | adorama.com | wait (over-budget) | wait (over-budget) | closest: Apple AirPods Pro 2 (different, 0.40); Brand site or other store: opened unknown |
| h26 | Nutribullet nutribullet Personal Blender | williams-sonoma.com | wait (above-usual-price) | wait (above-usual-price) | no other shelf item in this category; Brand site or other store: opened unknown |
| h27 | Fellow Corvo EKG Pro Electric Kettle | bestbuy.com | wait (over-budget) | ask (identity-unconfirmed) | no other shelf item in this category;  |
| h28 | Rare Beauty Soft Pinch Tinted Lip Oil | ecosmetics.com | ask (identity-unconfirmed) | ask (identity-unconfirmed) | no other shelf item in this category;  |
| h29 | OUAI Thick Hair Conditioner | ulta | ask (price-unknown) | ask (identity-unconfirmed) | no other shelf item in this category;  |
| h30 | Edifier ES850NB Wireless Noise-Canceling Over-Ear Headphones | bestbuy.com | ask (identity-unconfirmed) | ask (identity-unconfirmed) | no other shelf item in this category;  |
