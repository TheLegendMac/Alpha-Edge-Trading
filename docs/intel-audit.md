# `src/intel/` audit

Read-only audit of the 6 files in `src/intel/`. Recorded 2026-05-16.

## File-by-file

| File | LOC | External callers | Verdict |
|---|---|---|---|
| `alpha.js` | 1193 | 27 `window.alpha*` exports referenced across home, log-stats, trade-flow | **Keep, but trim.** Half the file is overlapping bucketing helpers (`alphaTimeBucket`, `alphaOrbDirectionBucket`, `alphaSpreadBucket`…). Folding the buckets into a single `buckets.js` would cut ~30%. Hard split because every consumer pulls the file's render functions, which fold the buckets into one render pass. |
| `rolling.js` | 19 | `home.js`, `stats.js`, `gates.js`, `alpha.js` | **Keep as-is.** Tiny, pure function, 4 consumers. Folding into `alpha.js` would only obscure the dependency. |
| `glossary.js` | 28 | `index.html` (click delegator), `main.js` (close handlers) | **Keep as-is.** Self-contained side-panel opener. Could move under `src/views/` since it owns DOM not analytics — minor naming nit. |
| `backtest.js` | 242 | `main.js` (import buttons) | **Keep as-is.** Pure feature — TOS report parser + UI card. Tied to `state.backtestReports` and `SYNC`. No overlap with other intel files. |
| `setup-scorecards.js` | 137 | `weekly-report.js`, `alpha.js` | **Keep as-is.** Two internal consumers, both legitimate. The current layout (compute fn in scorecards, render-html fn in alpha) is awkward but moving either side creates a circular import. |
| `weekly-report.js` | 153 | `main.js`, `index.html` (`#btn-weekly-report`) | **Keep as-is.** Distinct exporter; pulls `computeSetupScorecards` + closed trades, emits CSV. Different output channel from `alpha.js`. |

## Concrete recommendations

1. **`alpha.js` is not a god-file pretending to be one.** It's a real god-file — 27 named exports, ~1200 LOC. The biggest win is grouping the 9 "alpha*Bucket" helpers (`alphaTimeBucket`, `alphaSpreadBucket`, `alphaOrbDirectionBucket`, `alphaOrbRangeBucket`, `alphaVwapBucket`, `alphaConfluenceBias`, `alphaBreadthBias`, `alphaFrictionBucket`, `alphaFillQuality`) into `src/intel/buckets.js`. They share a pattern (closed-trade row → string label) and are independently testable.

2. **Glossary belongs in `src/views/`, not `src/intel/`.** It opens/closes a side panel — pure DOM. No analytics in the file. Renaming costs almost nothing; the file is 28 lines.

3. **Nothing is "dead enough" to delete.** All 6 files have live consumers; the smallest (rolling.js, 19 LOC) earns its keep through 4 callers. Don't merge for the sake of merging.

4. **`backtest.js` is the cleanest candidate for extraction**, but to `src/features/` rather than away — it's a standalone feature (TOS import). Not urgent.

## What I did NOT do

- No file moves, deletes, or merges. This is audit-only per request.
- Did not refactor `alpha.js`'s buckets into `buckets.js`. It's a meaningful change that touches every render path that uses these helpers (~15 callers). Should be its own branch with manual smoke testing of the Alpha Edge card.
