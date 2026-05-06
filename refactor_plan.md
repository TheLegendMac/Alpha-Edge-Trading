# Alpha Edge Trading — Refactor Plan

## 1. Why this refactor

`index.html` is a 14,381-line single-file app (CSS lines 10–5355, HTML body 5357–6668, JavaScript 6670–14379). Every Claude Code session that touches this file pays the full token cost. After this refactor, agents can open just the slice that matters (e.g. only `src/trade-flow/swing-steps.js`) and leave the rest unread.

No code is moved by this document. This is the design only.

## 2. Target architecture

- **Vite** as build tool (`npm create vite@latest .` style scaffold, vanilla template, no framework).
- **Native ES modules** in source (`import`/`export`); Vite bundles them for production into `dist/`.
- **`index.html` stays at the project root** as the Vite entry HTML — Vite is HTML-first, so this is idiomatic.
- **Supabase v2** moves from CDN `<script>` to `npm i @supabase/supabase-js` and is imported as a module (`import { createClient } from '@supabase/supabase-js'`). Removes the `window.supabase` UMD global.
- **Inline `onclick=` strings** (~125 of them inside dynamically built innerHTML) reference functions by name, which resolve against `window`, not module scope. Two-stage fix:
  - Stage 1 (with the refactor): every module that owns an inline-referenced function ends with explicit `window.foo = foo` aliases. Greppable, zero behavior change.
  - Stage 2 (follow-up, optional): replace inline handlers with `data-action` attributes plus one delegated click listener. Removes all `window.*` aliases.

### New top-level layout

```
/index.html                       ~120 lines: <head>, <body> shell with all modal markup
/package.json                     vite + @supabase/supabase-js
/vite.config.js                   minimal: root='.', build.outDir='dist'
/refactor_plan.md                 this file
/README.md
/src/
  main.js                         entry: imports + DOMContentLoaded → init()
  config/
    constants.js
    supabase-config.js
  state/
    store.js
    persistence.js
  sync/
    supabase.js
    auth-modal.js
    merge.js
  models/
    trade.js
    position.js
    formatters.js
  market/
    regime.js
    context-panel.js
  views/
    home.js
    log.js
    sunday.js
    reference.js
    settings.js
  intel/
    alpha.js
    clt-card.js
    backtest.js
    glossary.js
    rolling.js
  modals/
    trade-modal.js
    position-editor.js
    toast.js
    import-export.js
  trade-flow/
    gates.js
    ticker-memory.js
    summary.js
    risk.js
    swing-sizing.js
    intraday-sizing.js
    stepper.js
    swing-steps.js
    intraday-steps.js
    intraday-helpers.js
  tabs.js
/styles/
  tokens.css                      :root variables, resets
  theme.css
  layout.css
  command-bar.css
  forms.css
  cards.css
  tables.css
  modals.css
  workflow.css
  panels.css
  utilities.css
  print.css
```

CSS is loaded via `import './styles/tokens.css'` (and friends) at the top of `src/main.js`. Vite handles CSS bundling; no `<link>` tags needed in `index.html`.

## 3. Section → file map (where each line goes)

### CSS (lines 10–5355) → 12 files in `/styles/`

| Target file              | Source lines        | Owns                                              |
|--------------------------|---------------------|---------------------------------------------------|
| tokens.css               | 11–85               | `:root` variables (35 tokens), resets             |
| command-bar.css          | 86–227              | sticky nav header                                 |
| layout.css               | 228–697             | main container, home grid, tab panels             |
| workflow.css             | 698–787, 3975–5350  | trade-flow stepper + step bodies + sizing widgets |
| forms.css                | 788–907, 2645–2714  | inputs, groups, validation, ticker autocomplete   |
| tables.css               | 908–1111            | trade log table + stats shell                     |
| cards.css                | 1112–1573, 2397–2528| CLT card, sector panel, generic card patterns     |
| modals.css               | 1574–2375           | modal base + trade modal + position editor        |
| panels.css               | 2376–2577, 2859–3082, 3486–3746, 3824–3974 | settings, sector reminder, sunday prep, reference, context panel, glossary |
| theme.css                | 2578–2644           | ticker bar + small theme bits                     |
| utilities.css            | 3083–3103, 3104–3485| toast, mobile/responsive                          |
| print.css                | 2820–2858           | `@media print`                                    |

(Boundaries may shift ±2 lines — verify the section delimiter when slicing.)

### HTML body (5357–6668) → kept inside `index.html`

The HTML body is **not split**. All modal markup, tab panels, and the command bar stay where they are. Modules query the static DOM by `id`. Splitting modal markup into JS template literals would trade token cost for runtime complexity — wrong direction.

Result: `index.html` shrinks from 14,381 lines to ~1,400 (head + body + the `<script type="module" src="/src/main.js">`).

### JavaScript (6670–14379) → 38 files

| Target file                               | Source lines               | Owns                                                                 |
|-------------------------------------------|----------------------------|----------------------------------------------------------------------|
| `config/supabase-config.js`               | 5366–5371                  | `window.SUPABASE_CONFIG` block                                       |
| `config/constants.js`                     | 6675–6685, 7320–7400, 11081–11161, 9972–9981 | STORAGE_KEY, OLD_STORAGE_KEY, DEFAULT_SETTINGS, INTRADAY_SETUPS, SECTORS, REGIME_DATA, TRADE_SWING_SETUPS, TRADE_STRUCTURES, TRADE_INTRADAY_SETUPS, TRADE_SETUP_TEMPLATES, TRADE_INTRADAY_LEGACY_MAP, TRADE_ORB_TYPES, TRADE_CONFLUENCE_OPTIONS, TRADE_BREADTH_OPTIONS |
| `sync/supabase.js`                        | 6686–6735, 6777–6965, 7126–7140 | SYNC, getDeviceId, initSupabase, setSyncStatus, schedulePush, doPush, doPull |
| `sync/auth-modal.js`                      | 6981–7053, 7054–7125       | showAuthModal, hideAuthModal, showAuthError, clearAuthError, handleSkipAuth, showSyncMenu |
| `sync/merge.js`                           | 7227–7297, 7539–7572       | tradeFieldScore, tradeUpdatedTime, chooseTradeVersion, mergeDeletedTradeIds, mergeTradesArrays |
| `state/store.js`                          | 7426–7465, 7573–7581, 6966–6980 | the `state` object, refreshAllUI, getRiskPctForRegime          |
| `state/persistence.js`                    | 7466–7538                  | loadState, saveStateLocal, saveState, migration from OLD_STORAGE_KEY |
| `market/context-panel.js`                 | 7582–7670                  | openContextPanel, closeContextPanel, renderContextPanel, updateCtxSectorSummary, touchMarketContext |
| `market/regime.js`                        | 7671–7855                  | setRegime, renderRegime, getTodayLossCount, getOpenPositionsCount, renderPretradeCheck, togglePretradeCheck, getStrategyForIVR, deriveSpreadPct, liquidityOK |
| `models/formatters.js`                    | (extracted from 7857–8029) | _fmtMoney, _fmtMoneyPlain, _toneClass, formatDate, todayISO         |
| `models/trade.js`                         | 7401–7425, 7857–8029       | genTradeId, tradeInstrument, tradeMultiplier, tradeRiskDollars, tradeBias, isClosedTrade, calcPL, calcR, dateOffsetISO, normalizeProcessQuality, processQualityLabel, ratingToLabel, ratingToStatus |
| `models/position.js`                      | (extracted from 9753–10203) | POS, _posMultiplier, _posSign, _posSideLabel, _posQtyUnit, tradeQty, _posRealizedPL, _posOpenQty, _posUnrealizedPL, _backfillTagsFromTrade |
| `intel/rolling.js`                        | 8178–8189                  | computeRollingPL                                                     |
| `intel/glossary.js`                       | 8151–8177                  | openAIGlossary, closeAIGlossary                                      |
| `intel/alpha.js`                          | 8190–8743                  | alphaEsc, alphaMoney, alphaR, alphaDirectionKey, alphaIntradaySetupDef, alphaSetupBias, alphaConfluenceBias, alphaBreadthBias, alphaContextAlignment, alphaSpreadValue, alphaSpreadBucket, alphaFillQuality, alphaTimeBucket, alphaOrbDirectionBucket, alphaOrbRangeBucket, alphaVwapBucket, alphaFrictionScore, alphaFrictionBucket, alphaSummarizeRows, alphaGroupClosedRows, alphaRowsHtml, alphaSection, buildAlphaHighlightBullets, buildAlphaEdgeCard, buildAlphaIntel |
| `intel/clt-card.js`                       | 8934–9031                  | buildCltCard                                                         |
| `intel/backtest.js`                       | 9032–9066, 10793–10984     | buildBacktestCard, parseTOSBacktest, addBacktestReport, importBacktestFromFile, importBacktestFromPaste, deleteBacktestReport |
| `views/log.js`                            | 8744–8933, 9067–9169       | renderLogStats, renderLogTable, setLogSetupFilter, clearLogSetupFilter |
| `views/home.js`                           | 9175–9482                  | renderHome, renderUniversalSidebar                                   |
| `modals/trade-modal.js`                   | 9489–9752, 8030–8150       | closeTradeModal, _directionToBias, _biasToDirection, setTradeBias, saveTrade, deleteTrade, resetFlowSilent, addTestTrades, editTrade, reviewTrade |
| `modals/position-editor.js`               | 9753–10203                 | openPositionEditor, closePositionEditor, setPositionTab, renderPositionEditor, _renderExecLog, _renderPlaybookImage, _activeExecType, _execScale, _execExit, _delExec, _toggleTag, _savePositionEditor, _deletePositionEditor, _wirePositionEditor (plus its local `TAG_LABELS`) |
| `views/sunday.js`                         | 10204–10469                | renderSunday, renderSectors, computeTop3, computeAvoidList, updateSectorCardLive, updateSectorSummary, formatRatedAt, daysSinceSectorRating, isSectorRatingStale, clearSectors, renderSectorStatusMini, toggleSunday |
| `views/settings.js`                       | 10470–10614                | openSettings, closeSettings, saveSettings, resetSettingsToDefaults, clearAllTradesAndData |
| `views/reference.js`                      | 10615–10665                | renderReference                                                      |
| `modals/toast.js`                         | 10666–10676                | toast                                                                |
| `modals/import-export.js`                 | 10677–10792                | exportCSV, exportJSON, importJSON, checkStaleBackup, showStaleBackupNudge, hideStaleBackupNudge |
| `trade-flow/intraday-helpers.js`          | 7350–7377, 10985–11080     | newIntradayTicket, todayIntradayTrades, isInIntradayWindow, logIntradayTrade |
| `trade-flow/gates.js`                     | 11162–11328                | tfComputeRolling30dPL, tfEvaluateGates, tfComputeStatus, tfComputeIntradayDayPL, tfComputeStrategyLabel, tfIvrBracket |
| `trade-flow/ticker-memory.js`             | 11329–11447                | tfTickerHistory, tfTopTickers, tfTickerSuggestions, tfRenderTickerMemoryHtml, tfUpdateTickerMemory, _buildTickerHistory, rememberTicker |
| `trade-flow/summary.js`                   | 11448–11573                | tfEnsureSummaryControls, tfBindSummaryControls, tfUpdateSummaryStatus, tfRenderStrategyOutHtml, tfUpdateSwingStrategyPreview, tfCapitalDeployed |
| `trade-flow/risk.js`                      | 11574–11800                | tfMoneyText, tfPctText, tfSignedMoneyText, tfAbsMoneyText, tfOptionSpreadFromBidAsk, tfSpreadReadHtml, tfOptionBidAskInputsHtml, tfClampMoonshotR, tfFormatR, tfMoonshotR, tfRenderMoonshotSliderHtml, tfRiskLevelRows, tfRenderRiskTableHtml, tfRenderRiskProfileHtml, tfRiskArgsFromProfile, tfRefreshMoonshotProfile, tfBindMoonshotSliders |
| `trade-flow/swing-sizing.js`              | 11801–11990                | tfRenderSwingSizingHtml, tfSwingQuoteMid, tfCanAutoFillSwingPremium, tfAutoFillSwingPremiumFromQuote, tfSetSwingPremiumFromQuote, tfUpdateSwingSpreadLine, tfUpdateSwingSizing, tfInstrumentToggleHtml, tfStructureValue, tfSetSwingStructure, tfSetSwingInstrument |
| `trade-flow/intraday-sizing.js`           | 11991–12169                | tfSetIntradayStructure, tfSetIntradayInstrument, tfIntradayInstrument, tfDeriveIntradaySpread, tfAutoFillIntradayOptionBracket, tfAutoFillIntradayStockFromOR, tfRenderIntradaySizingHtml, tfComputeIntradayRiskSize, tfApplyIntradayRiskSize, tfBindIntradayRiskSizeButton, tfUpdateIntradaySizing, tfUpdateIntradayRMult, tfSpreadBracket |
| `trade-flow/stepper.js`                   | 12170–12465                | tfStepCount, tfStepNames, tfIsSingleScreen, tfStepCompletion, tfRenderStepper, tfBindHeaderScroll, tfRenderHeader, tfRenderActions, tfGoToStep, tfSetMode, tfReset, tfStepBody |
| `trade-flow/swing-steps.js`               | 12466–12995                | tfSwingStep1..4 + tfMountSwingStep1..4, tfSwingContractSpecHtml, tfMountSwingContractSpec |
| `trade-flow/intraday-steps.js`            | 12996–14052                | tfFindIntradaySetup, tfParseHumanNumber, tfReadKeyNumber, tfGradePasses, tfIntradayStep1..n + mounts |
| `tabs.js`                                 | 14053–14070                | setTab, attachTickerAutocomplete, _buildTickerHistory wiring         |
| `main.js`                                 | 14186–14378                | init() body (DOMContentLoaded wiring), CSS imports                   |

(Boundaries may shift ±2 lines — confirm at slice time.)

## 4. Coupling issues that will make this non-trivial

### A. The `state` god-object (~538 references)

`state` is read and written from every render and handler. Don't try to encapsulate it. `state/store.js` exports a single mutable object:

```js
export const state = { /* … */ };
export function saveState() { /* … */ }
```

Every consumer does `import { state, saveState } from '../state/store.js'`. Behavior is identical to today.

### B. Inline `onclick=` handlers (~125)

Functions named in inline `onclick="…"` strings inside dynamically built innerHTML must live on `window`. Each module ends with explicit aliases:

```js
window.editTrade = editTrade;
window.openAIGlossary = openAIGlossary;
// …
```

Audit list (regenerate with `grep -oE 'onclick="[a-zA-Z_][a-zA-Z0-9_]*' index.html | sort -u`):
`editTrade`, `reviewTrade`, `setTab`, `openAIGlossary`, `closeAIGlossary`, `setLogSetupFilter`, `clearLogSetupFilter`, `deleteBacktestReport`, plus all `tf*` handlers referenced by step-body innerHTML (~40 names).

### C. DOM-by-id assumption — keep it

~297 `getElementById`/`querySelector` calls hit IDs that exist statically in `index.html`. Don't change this. Modules don't own DOM; they query by id. This is why the HTML body stays unsplit.

### D. The `tf*` family — no closure prison

Every `tf*` is a top-level `function` declaration; trade-flow state lives on `state.tradeFlow`. Splitting is mechanical (add imports). One real risk: circular imports between `stepper.js` ↔ `swing-steps.js` ↔ `intraday-steps.js`. ES modules tolerate cycles when neither side reads the other's exports at module-evaluation time, only at call time — which is true here. If a cycle does bite, register step handlers via a small registry in `stepper.js`.

### E. `init()` order

```js
// src/main.js
import './styles/tokens.css';
import './styles/theme.css';
import './styles/layout.css';
// … all other CSS

import './config/supabase-config.js';   // side-effect: window.SUPABASE_CONFIG
import { state, loadState } from './state/store.js';
import { initSupabase } from './sync/supabase.js';
import { init } from './tabs.js';
import './modals/trade-modal.js';       // side-effect: window.editTrade etc.
// … other side-effect imports for window.* aliases

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  init();
});
```

The current `init()` body (14186–14377) wires `addEventListener` against static IDs — keep the body intact, just import the handlers it references.

### F. Supabase: use the npm package

Replace the CDN `<script>` tag with `npm i @supabase/supabase-js` and `import { createClient } from '@supabase/supabase-js'` inside `sync/supabase.js`. No more `window.supabase` UMD global.

## 5. Phased migration order

Each phase ends with the page fully working (checked in browser via `npm run dev`). Test by exercising auth, adding a trade, walking the swing flow, walking the intraday flow, importing/exporting, every tab.

- **Phase 0 — Scaffold.** `npm create vite@latest .` (vanilla template, no framework). `npm i @supabase/supabase-js`. Add `vite.config.js`. Take a known-good snapshot of `index.html` for diffing.
- **Phase 1 — CSS extract.** Pull lines 10–5355 into `styles/*.css` along the 12-file split. Add `import './styles/tokens.css'` etc. at the top of an empty `src/main.js`. Change `<style>…</style>` in `index.html` to nothing (Vite injects CSS automatically). Visually verify all tabs and modals.
- **Phase 2 — Wire up the module entry.** Change `<script>…</script>` (line 6670 onward) to `<script type="module" src="/src/main.js">`. Move all JS to a single big file `src/legacy.js` and `import './legacy.js'` from `main.js`. Confirm `window.foo` references still resolve. Replace the Supabase CDN script with an npm import.
- **Phase 3 — Pure utilities.** Extract `models/formatters.js`, `models/trade.js` (pure parts), `intel/rolling.js`, `intel/glossary.js`. These have no `state` deps — easiest to verify.
- **Phase 4 — Constants and state.** `config/constants.js`, `config/supabase-config.js`, `state/persistence.js`, `state/store.js`. Temporarily re-expose `window.state = state` so any line still in `legacy.js` keeps working.
- **Phase 5 — Sync.** `sync/supabase.js`, `sync/auth-modal.js`, `sync/merge.js`. Test online/offline, sign in/out, conflict on a second device.
- **Phase 6 — Market & regime.** `market/regime.js`, `market/context-panel.js`. Test regime banner + context panel.
- **Phase 7 — Intel cards.** `intel/alpha.js`, `intel/clt-card.js`, `intel/backtest.js`. Test home dashboard, log stats, backtest import.
- **Phase 8 — Views.** `views/home.js`, `views/log.js`, `views/sunday.js`, `views/reference.js`, `views/settings.js`. Test each tab.
- **Phase 9 — Modals & toast & I/O.** `modals/trade-modal.js`, `modals/position-editor.js`, `modals/toast.js`, `modals/import-export.js`. Test edit/review trade, position editor with executions, CSV/JSON export and re-import.
- **Phase 10 — Trade flow (biggest piece).** Order: `gates.js` → `risk.js` → `summary.js` → `ticker-memory.js` → `swing-sizing.js` → `intraday-sizing.js` → `stepper.js` → `swing-steps.js` → `intraday-steps.js` → `intraday-helpers.js`. Test full swing flow steps 1–4, full intraday flow, sizing widgets, gate failures.
- **Phase 11 — Bootstrap.** Move `init()` and `setTab` to `tabs.js` + `main.js`. Delete `legacy.js`.
- **Phase 12 — Drop the `window.state` shim.** Audit: `grep -nE "onclick=\"[a-zA-Z_]+"` and confirm every name has a corresponding `window.foo = foo` in some module.
- **Phase 13 (optional) — Replace inline `onclick=` with `data-action` + delegation.** Single global click delegate dispatches by `data-action`. Removes all `window.*` aliases. Defer until something else forces it.

## 6. What NOT to split

- **The HTML body (5357–6668).** All modal markup stays in `index.html`. Modules query by id.
- **Tiny one-line helpers** (`_biasToDirection`, `_toneClass`, `tradeMultiplier`, `_posMultiplier`). They live next to their primary user. No `helpers.js` grab-bag.
- **Single-consumer constants.** `TAG_LABELS` (only used by `position-editor.js`) stays inside that module.
- **`refreshAllUI()`.** 14-line function, lives in `state/store.js` next to `saveState`.
- **`window.SUPABASE_CONFIG`.** Stays a side-effect module.

## 7. Verification checklist (post-implementation)

- `grep -oE 'onclick="[a-zA-Z_][a-zA-Z0-9_]*' index.html src/**/*.js | sort -u` — every hit has a matching `window.X = X` somewhere.
- `grep -rn "^let state\|^var state" src/` — exactly one match in `state/store.js`, and that line is `export const state = {…}`.
- `npm run dev` boots cleanly. DevTools shows zero console errors and zero `404`s.
- Manual smoke test: every tab, every modal, full swing trade flow, full intraday trade flow, sign-in/out, import, export, regime change, sector ratings, backtest import.
- `npm run build` produces a working `dist/` (open `dist/index.html` in a browser via `npm run preview`).

## 8. Files this plan touches (none yet)

This document does not move any code. Implementation is the next conversation. The starting points are:

- `index.html` — the source being decomposed
- `README.md` — needs a dev-server / build instruction once Phase 0 lands
- `.claude/` — the place to record new file conventions for future agent sessions
