// Static configuration: storage keys, default settings, sector list,
// regime metadata, and the trade-flow setup catalogues.

export const STORAGE_KEY = 'mac_cockpit_v3_unified';
export const OLD_STORAGE_KEY = 'v2_cockpit_state_v5';

// ---------- DEFAULT SETTINGS ----------
export const DEFAULT_SETTINGS = {
  account: 10000,
  riskOn: 2.0,         // % per trade in RISK-ON
  riskNeutral: 1.0,    // % per trade in NEUTRAL
  riskOff: 0.5,        // % per trade in RISK-OFF
  stopPct: 50,         // % of premium = stop loss
  targetPct: 50,       // % of premium gain = profit target
  maxPositions: 5,
  maxPremiumPct: 20,   // max premium deployed as % of account
  maxRiskPct: 10,      // max total at risk as % of account
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
  { id: '21-EMA Pullback',  num: '01', desc: 'Stock in clear uptrend pulls back to its 21-day MA, then prints a green/up bar.' },
  { id: 'Base Breakout',    num: '02', desc: 'Trading flat in a tight range for 15+ days, then breaks above on 1.5×+ avg volume.' },
  { id: 'Breakout Retest',  num: '03', desc: 'Stock breaks out, pulls back to retest the breakout level, then bounces.' },
  { id: '9-EMA Reclaim',    num: '04', desc: 'Intraday wick below the 9-day MA closes back above by EOD — dip-buyers showed up.' },
  { id: 'Edge Reversal',    num: '05', desc: 'Counter-trend trade at trend exhaustion. HALF size — lower probability.', halfSize: true },
];

export const TRADE_STRUCTURES = [
  { id: 'stocks', label: 'Stock' },
  { id: 'options', label: 'Option' },
  { id: 'spread', label: 'Spread' },
];

// Intraday setups mirror the user's ThinkScript outputs exactly.
export const TRADE_INTRADAY_SETUPS = [
  { id: 'orb-up-break',  num: '01', name: 'ORB UP-BREAK',  desc: 'Break above the opening range high.', bias: 'long',  isOrb: true },
  { id: 'orb-dn-break',  num: '02', name: 'ORB DN-BREAK',  desc: 'Break below the opening range low.',  bias: 'short', isOrb: true },
  { id: 'above-vwap-up', num: '03', name: 'ABOVE VWAP UP', desc: 'Above VWAP, EMA stack bullish, momentum up.', bias: 'long' },
  { id: 'below-vwap-dn', num: '04', name: 'BELOW VWAP DN', desc: 'Below VWAP, EMA stack bearish, momentum down.', bias: 'short' },
  { id: 'vwap-mean-rv',  num: '05', name: 'VWAP MEAN-RV',  desc: 'Within 0.25% of VWAP — fade extremes back to mean.', bias: 'either' },
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
