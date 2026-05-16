// Static configuration: storage keys, default settings, sector list,
// regime metadata, and the trade-flow setup catalogues.

export const STORAGE_KEY = 'mac_cockpit_v3_unified';
export const OLD_STORAGE_KEY = 'v2_cockpit_state_v5';

// ---------- Active modes (top-level tabs) ----------
// Single source of truth for state.activeMode. Legacy values from older state
// blobs are normalized to the canonical set on load.
export const ACTIVE_MODES = ['home', 'trade', 'log', 'stats', 'reference'];

const LEGACY_ACTIVE_MODES = {
  decision: 'trade',
  intraday: 'trade',
  swing: 'home',
};

export function normalizeActiveMode(name) {
  if (ACTIVE_MODES.includes(name)) return name;
  if (LEGACY_ACTIVE_MODES[name]) return LEGACY_ACTIVE_MODES[name];
  return 'home';
}

// ---------- DEFAULT SETTINGS ----------
export const DEFAULT_SETTINGS = {
  account: 10000,
  riskOn: 2.0,         // % per trade in RISK-ON
  riskNeutral: 1.0,    // % per trade in NEUTRAL
  riskOff: 0.5,        // % per trade in RISK-OFF
  stopPct: 50,         // % of premium = stop loss
  targetPct: 50,       // % of premium gain = profit target (legacy fallback)
  targetRMultiple: 2,  // default reward:risk ratio for auto targets (target distance = N × stop distance)
  minDaysToEarnings: 8, // minimum days before earnings for swing trades
  maxPositions: 5,
  longOnlyMode: false, // when true, hides spread recommendations and converts spread zones to "skip"
  // ---- INTRADAY ----
  intradayRiskPerTrade: 100, // $ at risk per intraday trade
  intradayMaxDailyLoss: 200, // hard daily loss cap for intraday
  intradayMaxSpreadPct: 5,
  intradayDefaultDelta: 0.65,
  // ---- ALPHA INTEL ----
  killSwitchDays: 30,    // window (in days) for kill-switch P/L computation
  killSwitchFloor: 7.0,  // rolling floor as % drawdown threshold (positive number = -X%)
  dailyMaxLossPct: 2.0,  // daily max loss as % of account
};

// ---------- Intraday setup library ----------
export const INTRADAY_SETUPS = [
  { id: 'orb-break',    name: 'ORB BREAK',    detail: 'Open range high/low' },
  { id: 'orb-retest',   name: 'ORB RETEST',   detail: 'Pullback to OR level' },
  { id: 'vwap-reclaim', name: 'VWAP RECLAIM', detail: 'Reclaim of VWAP' },
  { id: 'vwap-loss',    name: 'VWAP LOSS',    detail: 'Loss of VWAP' },
  { id: 'momo-edge',    name: 'MOMO EDGE',    detail: 'Edge Scan signal' },
  { id: 'trend-cont',   name: 'TREND CONT',   detail: 'EMA pullback / push' },
];

// Factory for a fresh intraday ticket — used by state init and reset flows.
export function newIntradayTicket() {
  return {
    instrument: 'options',
    structure: 'options',
    ticker: '', direction: 'long', setup: null,
    entry: null, stop: null, target: null,
    contracts: null, spreadPct: null,
    bid: null,
    ask: null,
    mid: null,
    orbType:   '30',
    orHi:      null,
    orLo:      null,
    orRng:     null,
    confluence: '',
    breadth:    '',
    vwapValue:  null,
    vwapRel: '',
    notes: '',
  };
}

// ---------- Sectors ----------
export const SECTORS = [
  { ticker: 'XLK',  name: 'Technology' },
  { ticker: 'XLF',  name: 'Financials' },
  { ticker: 'XLV',  name: 'Health Care' },
  { ticker: 'XLY',  name: 'Consumer Discretionary' },
  { ticker: 'XLC',  name: 'Communication Services' },
  { ticker: 'XLI',  name: 'Industrials' },
  { ticker: 'XLP',  name: 'Consumer Staples' },
  { ticker: 'XLE',  name: 'Energy' },
  { ticker: 'XLU',  name: 'Utilities' },
  { ticker: 'XLRE', name: 'Real Estate' },
  { ticker: 'XLB',  name: 'Materials' },
];

// ---------- Regime ----------
// longPct values are computed dynamically from settings via getRiskPctForRegime()
export const REGIME_DATA = {
  'risk-on': {
    text: 'RISK-ON',
    rulesTemplate: '<strong>Full size {pct}%</strong> &nbsp;•&nbsp; Long-biased &nbsp;•&nbsp; Set from your TOS MAC_MacroRegime label',
    shortAllowed: false,
    bannerClass: 'risk-on',
  },
  'neutral': {
    text: 'NEUTRAL',
    rulesTemplate: '<strong>Half size {pct}%</strong> &nbsp;•&nbsp; Both directions allowed &nbsp;•&nbsp; Prefer debit spreads',
    shortAllowed: true,
    bannerClass: 'neutral',
  },
  'risk-off': {
    text: 'RISK-OFF',
    rulesTemplate: '<strong>Reduced size {pct}%</strong> &nbsp;•&nbsp; Long blocked, puts only on red sectors',
    shortAllowed: true,
    bannerClass: 'risk-off',
  },
};

// ---------- Trade-flow catalogues ----------
export const TRADE_SWING_SETUPS = [
  { id: '21-EMA Pullback',  num: '01', name: 'Pullback Buy',    desc: 'Stock in an uptrend dips to its 21-day moving average, then turns green. Buy the dip.', bias: 'long' },
  { id: 'Base Breakout',    num: '02', name: 'Range Breakout',  desc: 'Stock trades flat for 15+ days, then breaks above the range on heavy volume.', bias: 'long' },
  { id: 'Breakout Retest',  num: '03', name: 'Breakout Retest', desc: 'After a breakout, price pulls back to the broken level and bounces off it.', bias: 'long' },
  { id: '9-EMA Reclaim',    num: '04', name: 'Bounce-Back',     desc: 'Intraday dip under the 9-day moving average closes back above by end of day. Dip buyers showed up.', bias: 'long' },
  { id: 'Edge Reversal',    num: '05', name: 'Trend Reversal',  desc: 'Counter-trend trade at trend exhaustion. Half size — lower-odds play.', halfSize: true, bias: 'either' },
];

export const TRADE_STRUCTURES = [
  { id: 'stocks', label: 'Stock' },
  { id: 'options', label: 'Option' },
  { id: 'spread', label: 'Spread' },
];

// Intraday setups mirror the user's ThinkScript outputs exactly.
export const TRADE_INTRADAY_SETUPS = [
  { id: 'orb-up-break',  num: '01', name: 'Range Break Up',   desc: 'Price breaks above the opening range high on volume. Buy the move.', bias: 'long',  isOrb: true },
  { id: 'orb-dn-break',  num: '02', name: 'Range Break Down', desc: 'Price breaks below the opening range low on volume. Short the move.', bias: 'short', isOrb: true },
  { id: 'above-vwap-up', num: '03', name: 'VWAP Uptrend',     desc: 'Price holding above VWAP with EMAs stacked bullish. Buy the trend.', bias: 'long' },
  { id: 'below-vwap-dn', num: '04', name: 'VWAP Downtrend',   desc: 'Price holding below VWAP with EMAs stacked bearish. Short the trend.', bias: 'short' },
  { id: 'vwap-mean-rv',  num: '05', name: 'VWAP Fade',        desc: 'Price hugging VWAP within ~0.25%. Fade the extremes back to the mean.', bias: 'either' },
];

export const TRADE_SETUP_TEMPLATES = {
  // swing
  '21-EMA Pullback':  { thesis: 'Pullback to rising 21-EMA in confirmed uptrend; expecting bounce + trend resumption.', preMortem: 'Loses if it closes back below the 21-EMA on volume — trend is broken.' },
  'Base Breakout':    { thesis: 'Breakout from a multi-week base on 1.5×+ volume; expecting expansion to next resistance.', preMortem: 'Loses if it falls back inside the base — failed breakout.' },
  'Breakout Retest':  { thesis: 'Retest of broken resistance now acting as support; expecting continuation higher.', preMortem: 'Loses if support level fails on volume — base is broken.' },
  '9-EMA Reclaim':    { thesis: 'Reclaim of 9-EMA after intraday wick; dip-buyers defended — expecting trend resumption.', preMortem: 'Loses if it closes below 9-EMA again — dip-buyers gave up.' },
  'Edge Reversal':    { thesis: 'Counter-trend reversal at trend exhaustion; HALF size — playing for mean reversion.', preMortem: 'Loses if trend continues against me — counter-trend trades fail more often.' },
  // intraday — aligned with ThinkScript labels
  'orb-up-break':  { thesis: 'Break above opening range high on volume; expecting day-trend continuation.', preMortem: 'Loses on a fade back inside the range — false break.' },
  'orb-dn-break':  { thesis: 'Break below opening range low on volume; expecting day-trend continuation lower.', preMortem: 'Loses on a fade back inside the range — false break.' },
  'above-vwap-up': { thesis: 'Above VWAP with EMA9 > EMA21 and momentum up — long bias confirmed.', preMortem: 'Loses if it gives back VWAP — buyers lose control.' },
  'below-vwap-dn': { thesis: 'Below VWAP with EMA9 < EMA21 and momentum down — short bias confirmed.', preMortem: 'Loses if it reclaims VWAP — sellers lose control.' },
  'vwap-mean-rv':  { thesis: 'Price within 0.25% of VWAP — fading the extreme back to the mean.', preMortem: 'Loses if it breaks away from VWAP on volume — trend overrides mean reversion.' },
};

// Old intraday setup ids → migrate the current draft to the closest new id;
// historical trade records keep their original setup names.
export const TRADE_INTRADAY_LEGACY_MAP = {
  'orb-break':    'orb-up-break',
  'orb-retest':   'orb-up-break',
  'vwap-reclaim': 'above-vwap-up',
  'vwap-loss':    'below-vwap-dn',
  'momo-edge':    'above-vwap-up',
  'trend-cont':   'above-vwap-up',
};

// Breakout-type chips for ORB patterns.
export const TRADE_ORB_TYPES = [
  { id: '5',  label: '5-min' },
  { id: '15', label: '15-min' },
  { id: '30', label: '30-min' },
];

// Confluence chip values.
export const TRADE_CONFLUENCE_OPTIONS = [
  { id: 'long-bias',  label: 'LONG BIAS',  bias: 'long' },
  { id: 'mixed',      label: 'MIXED',      bias: 'either' },
  { id: 'short-bias', label: 'SHORT BIAS', bias: 'short' },
];

// Breadth chip values.
export const TRADE_BREADTH_OPTIONS = [
  { id: 'up',   label: 'BREADTH UP' },
  { id: 'flat', label: 'BREADTH FLAT' },
  { id: 'down', label: 'BREADTH DOWN' },
];

// Bridge to legacy.js (regular <script>): expose every constant as a window global
// so unmoved code in legacy.js keeps resolving identifiers.
window.STORAGE_KEY = STORAGE_KEY;
window.OLD_STORAGE_KEY = OLD_STORAGE_KEY;
window.ACTIVE_MODES = ACTIVE_MODES;
window.normalizeActiveMode = normalizeActiveMode;
window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
window.INTRADAY_SETUPS = INTRADAY_SETUPS;
window.newIntradayTicket = newIntradayTicket;
window.SECTORS = SECTORS;
window.REGIME_DATA = REGIME_DATA;
window.TRADE_SWING_SETUPS = TRADE_SWING_SETUPS;
window.TRADE_STRUCTURES = TRADE_STRUCTURES;
window.TRADE_INTRADAY_SETUPS = TRADE_INTRADAY_SETUPS;
window.TRADE_SETUP_TEMPLATES = TRADE_SETUP_TEMPLATES;
window.TRADE_INTRADAY_LEGACY_MAP = TRADE_INTRADAY_LEGACY_MAP;
window.TRADE_ORB_TYPES = TRADE_ORB_TYPES;
window.TRADE_CONFLUENCE_OPTIONS = TRADE_CONFLUENCE_OPTIONS;
window.TRADE_BREADTH_OPTIONS = TRADE_BREADTH_OPTIONS;
