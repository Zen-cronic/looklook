# Plain-model baseline on the held-out skip set

**The same model with no LookLook rules got it right 27 times out of 30, in each of 3 runs (median 27, range 27 to 27).** LookLook's scored run got 28. Skipping anything in a category you own gets 19; saying skip to everything gets 13.

| Way of deciding skip | Skip decisions correct | Skips made | Skips right |
|---|---|---|---|
| Always say skip | 13 of 30 | 30 | 13 |
| Skip whenever you own anything in the same category | 19 of 30 | 24 | 13 |
| Plain model, run 1 | 27 of 30 | 12 | 11 |
| Plain model, run 2 | 27 of 30 | 12 | 11 |
| Plain model, run 3 | 27 of 30 | 12 | 11 |
| LookLook, the scored run (`eval/holdout/RESULTS.md`) | 28 of 30 | 13 | 12 |

## What was run

- **Model:** `claude-sonnet-5-5`, the model the app reads posts and words reasons with. Every answer reports that model. Temperature, effort and thinking at the API defaults; at most 1,024 output tokens; no system prompt.
- **Prompt:** [`prompt.md`](prompt.md), sha256 `d6b57395d50c05be60fc5db32ddd980d6f0278af3ccdec8b1a7f0002c1ccf747`. It ends with the one question: "Should the shopper skip buying this because they already own something that does the same job? Answer SKIP or BUY, then one sentence why."
- **What each call gets:** the scenario's date (2026-11-07); the product as the engine gets it from the post (brand, name, category, key attributes, price or "not shown", store, and how sure the reader is about which product it is); and every item on the shopper's shelf as written in `eval/holdout/shelf.json`, with the case's patch if it has one: category, key attributes, size, opened or not, and when it runs out. No budgets, price history, return policies, LookLook rules, thresholds or examples from the answer key.
- **Scoring:** the first whole word SKIP or BUY is the answer (none was unclear). Right when it says skip exactly when `eval/holdout/cases.json` expects skip, the scorer the engine is held to.
- **Order of work:** the prompt, runner (`scripts/eval-baseline.ts`) and helpers (`lib/eval/baseline.ts`) were committed in `a350172` at 2026-11-11 16:03:51 EST, before the scored calls. The runner refuses to call the model while any of them has uncommitted changes. The three runs were on that commit, 2026-11-11 16:04:11 to 16:04:43 EST, 90 calls. Raw answers are in [`runs/`](runs/), one file per run, written as generated. The prompt was not changed after seeing results and no other prompt was run.
- **Earlier attempts, kept for the record:** the same prompt (same sha256) was first committed as `b776523` at 15:58:32 EST and run three times, 15:58:37 to 15:59:09 EST: 27, 27 and 27 of 30, with the same answer on every case as the runs above. Before the branch was first pushed, that commit was rebuilt as `a350172` to rename one internal function in the runner, a word the repo's wording check flags; nothing else changed. Those three files are in [`runs/first-attempt/`](runs/first-attempt/) and name the old commit. On `a350172`, a first try made 30 calls and stopped before writing anything, because the `runs/` folder didn't exist yet; its answers were never seen or scored. Then the three runs above.

Re-run: `npm run eval:baseline -- --run 4` (30 calls), then `npm run eval:baseline -- --score`. `npm run eval:baseline -- --show h01` prints a filled prompt without a call.

## Where each got it wrong

The plain model gave the same answer on every case in all three runs, so its misses are the same three each time.

| Case | What it is | Expected | Plain model (3 runs) | LookLook, scored run |
|---|---|---|---|---|
| h07 | A radiant liquid foundation; she owns a matte liquid foundation of the same coverage | skip | buy, buy, buy | skip |
| h10 | A matte setting spray; she owns a dewy setting spray | skip | buy, buy, buy | buy |
| h18 | A mineral body sunscreen; she owns a face sunscreen | buy | buy, buy, buy | skip |
| h24 | The same hair oil she already has open, lasting until March | wait (not needed yet) | skip, skip, skip | ask (hair oil was not a category the app had then) |

- **Plain model wrong, LookLook right:** h07 and h24.
- **LookLook wrong, plain model right:** h18.
- **Both wrong:** h10.

The other 26 cases agree with the expected answer for both.

## What the difference is and isn't

On skip alone, the plain model is one case behind LookLook's scored run (27 against 28), and two behind LookLook as the code is now (29, which is not a held-out number because these products shaped the change). With 30 products, a gap of one is small, and this should not be read as "LookLook's rules make the model much better at spotting duplicates". The plain model's three misses are defensible calls: twice it treats a different finish (radiant against matte, matte against dewy) as a different job, where the answer key says a different finish of the same kind is still the same job, and once it says skip to a second bottle of the exact hair oil she owns, where the key's rules answer wait, not needed yet, for the exact product already in use. The scored LookLook run got that hair-oil case right only because the app then had no hair-oil category and asked, and the inputs differ there: that run saw 14 of the 16 shelf items (lip balm and hair oil were left out), while the plain model saw all 16. The plain model also got the body sunscreen right, which the scored LookLook run got wrong. What LookLook adds is not a better guess on these 30. It decides with written rules in code, shows the shelf item and store policy each verdict used, can answer wait or ask instead of only skip or buy, and can be tested case by case when a rule changes. The plain model was asked a yes-or-no question about skip only, so its buys on the wait and ask cases are not counted against it.
