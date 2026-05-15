// Intraday trade flow steps 1-4 with mount handlers + paste import + utility helpers.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { DEFAULT_SETTINGS, newIntradayTicket, TRADE_INTRADAY_SETUPS, TRADE_ORB_TYPES, TRADE_CONFLUENCE_OPTIONS, TRADE_BREADTH_OPTIONS, TRADE_SETUP_TEMPLATES } from '../config/constants.js';

function tfFindIntradaySetup(id) {
  return TRADE_INTRADAY_SETUPS.find(s => s.id === id) || null;
}

function tfParseHumanNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).trim().replace(/,/g, '').match(/^([-+]?\d*\.?\d+)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') return n * 1000;
  if (suffix === 'M') return n * 1000000;
  if (suffix === 'B') return n * 1000000000;
  return n;
}

function tfReadKeyNumber(text, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    const re = new RegExp(`\\b${key}\\s*(?:=|:)\\s*([-+]?\\d[\\d,.]*\\s*[KMB]?)`, 'i');
    const m = text.match(re);
    if (m) return window.tfParseHumanNumber(m[1]);
  }
  return null;
}

function tfGradePasses(raw) {
  const g = String(raw || '').trim().toUpperCase();
  const order = { 'A+': 12, 'A': 11, 'A-': 10, 'B+': 9, 'B': 8, 'B-': 7, 'C+': 6, 'C': 5, 'C-': 4, 'D+': 3, 'D': 2, 'D-': 1, 'F': 0 };
  return order[g] !== undefined && order[g] >= order['B-'];
}

function tfParseIntradayPaste(text) {
  const out = {};
  const t = (text || '').toUpperCase();

  // Setup pattern (priority order matters: ORB matches first)
  if      (/ORB\s+UP[\s-]?BREAK/.test(t))   out.setup = 'orb-up-break';
  else if (/ORB\s+DN[\s-]?BREAK/.test(t))   out.setup = 'orb-dn-break';
  else if (/ABOVE\s+VWAP\s+UP/.test(t))     out.setup = 'above-vwap-up';
  else if (/BELOW\s+VWAP\s+DN/.test(t))     out.setup = 'below-vwap-dn';
  else if (/VWAP\s+MEAN[\s-]?RV/.test(t))   out.setup = 'vwap-mean-rv';

  // Confluence label (MAC_Intraday_VWAP_Confluence_v2)
  if      (/LONG\s+BIAS/.test(t))           out.confluence = 'long-bias';
  else if (/SHORT\s+BIAS/.test(t))          out.confluence = 'short-bias';
  else if (/INTRADAY:\s*MIXED/.test(t))     out.confluence = 'mixed';

  // Breadth label (MAC_Intraday_Breadth_Label_v2)
  if      (/BREADTH\s+UP/.test(t))          out.breadth = 'up';
  else if (/BREADTH\s+DOWN/.test(t))        out.breadth = 'down';
  else if (/BREADTH\s+FLAT/.test(t))        out.breadth = 'flat';

  // ORB cloud alert numbers — case-insensitive match against original text.
  const mHi  = text && text.match(/OR[_\s]HI\s*[=:]\s*([0-9.]+)/i);
  const mLo  = text && text.match(/OR[_\s]LO\s*[=:]\s*([0-9.]+)/i);
  const mRng = text && text.match(/\bRNG\s*[=:]\s*([0-9.]+)/i);
  if (mHi)  out.orHi  = parseFloat(mHi[1]);
  if (mLo)  out.orLo  = parseFloat(mLo[1]);
  if (mRng) out.orRng = parseFloat(mRng[1]);

  // VWAP price value (label: "VWAP: 486.50" or "VWAP=486.50")
  const mVwap = text && text.match(/\bVWAP\s*[=:]\s*([0-9.]+)/i);
  if (mVwap) out.vwapValue = parseFloat(mVwap[1]);

  // Ticker — explicit "TICKER=SPY" or "SYM=SPY" key. Handles TOS option formats and weird spacing.
  const mTk = text && text.match(/(?:TICKER|SYMBOL|SYM)\s*[=:]\s*([A-Z0-9.\s]+?)(?=\s*\||\s+[A-Z]+[=:]|$)/i);
  if (mTk) {
    let clean = mTk[1].replace(/\s+/g, '').toUpperCase();
    // If it's a TOS option ticker (e.g. .SPY260511C743), extract the base symbol
    const optMatch = clean.match(/^\.?([A-Z]+)\d/);
    if (optMatch) clean = optMatch[1];
    out.ticker = clean.slice(0, 6);
  }

  if (/\b(STOCK|SHARES?)\b/i.test(text || '')) out.instrument = 'stocks';
  if (/\b(OPTION|OPTIONS|CALL|PUT|CONTRACTS?)\b/i.test(text || '')) out.instrument = 'options';

  const entry = window.tfReadKeyNumber(text || '', ['ENTRY', 'ENT', 'PRICE', 'PX']);
  const stop = window.tfReadKeyNumber(text || '', ['STOP', 'STP']);
  const target = window.tfReadKeyNumber(text || '', ['TARGET', 'TGT']);
  const bid = window.tfReadKeyNumber(text || '', ['BID']);
  const ask = window.tfReadKeyNumber(text || '', ['ASK']);
  const mid = window.tfReadKeyNumber(text || '', ['MID']);
  const spread = window.tfReadKeyNumber(text || '', ['SPR', 'SPREAD']);
  const qty = window.tfReadKeyNumber(text || '', ['QTY', 'CONTRACTS', 'SHARES']);
  if (entry !== null) out.entry = entry;
  if (stop !== null) out.stop = stop;
  if (target !== null) out.target = target;
  if (bid !== null) out.bid = bid;
  if (ask !== null) out.ask = ask;
  if (mid !== null) out.mid = mid;
  if (spread !== null) out.spreadPct = spread;
  if (qty !== null) out.contracts = Math.max(1, Math.floor(qty));

  return out;
}

function tfApplyIntradayPaste(parsed) {
  if (!state.intraday) state.intraday = newIntradayTicket();
  const it = state.intraday;
  if (parsed.instrument) it.instrument = parsed.instrument;
  if (parsed.instrument) it.structure = parsed.instrument === 'stocks' ? 'stocks' : (it.structure === 'spread' ? 'spread' : 'options');
  if (parsed.ticker)     it.ticker = parsed.ticker;
  if (parsed.setup) {
    it.setup = parsed.setup;
    // Auto-align direction with setup's bias (long/short patterns only).
    const def = window.tfFindIntradaySetup(parsed.setup);
    if (def && def.bias === 'long')  it.direction = 'long';
    if (def && def.bias === 'short') it.direction = 'short';
  }
  if (parsed.confluence) it.confluence = parsed.confluence;
  if (parsed.breadth)    it.breadth = parsed.breadth;
  if (parsed.orHi  !== undefined) it.orHi  = parsed.orHi;
  if (parsed.orLo  !== undefined) it.orLo  = parsed.orLo;
  if (parsed.orRng !== undefined) it.orRng = parsed.orRng;
  // Derive RNG when only the two endpoints came in.
  if (parsed.orHi !== undefined && parsed.orLo !== undefined && parsed.orRng === undefined) {
    it.orRng = +(parsed.orHi - parsed.orLo).toFixed(2);
  }
  if (parsed.vwapValue !== undefined) it.vwapValue = parsed.vwapValue;
  ['entry', 'stop', 'target', 'bid', 'ask', 'mid', 'spreadPct', 'contracts'].forEach(k => {
    if (parsed[k] !== undefined && parsed[k] !== null) it[k] = parsed[k];
  });
  window.tfDeriveIntradaySpread();
  window.tfAutoFillIntradayOptionBracket();
  window.tfAutoFillIntradayStockFromOR();
  saveState();
}

// Section 1 — Setup picker (parallel to swing's setup step). Ticker, direction,
// and instrument all live in the sticky header; ORB range chips appear when an
// ORB variant is picked.
function tfIntradayStep1() {
  const it = state.intraday || {};
  const setupDef = window.tfFindIntradaySetup(it.setup);
  const isOrb = !!(setupDef && setupDef.isOrb);
  const dirKey = (it.direction || '').toString().toLowerCase().startsWith('s') ? 'short' : 'long';
  // Hide setups whose bias doesn't match the active direction (either always shows).
  const visible = TRADE_INTRADAY_SETUPS.filter(s => {
    const b = s.bias || 'either';
    return b === 'either' || b === dirKey;
  });
  const cards = visible.map(s => {
    const biasTag = s.bias === 'long'  ? '<span class="tf-bias-tag long">LONG</span>'
                  : s.bias === 'short' ? '<span class="tf-bias-tag short">SHORT</span>'
                                       : '<span class="tf-bias-tag neutral">EITHER</span>';
    return `
    <button class="trade-setup-card ${it.setup === s.id ? 'selected' : ''}" type="button" data-tf-i-setup="${s.id}">
      <span class="trade-setup-card-num">${s.num} · ${biasTag}</span>
      <span class="trade-setup-card-name">${s.name}</span>
      <span class="trade-setup-card-detail">${s.desc}</span>
    </button>`;
  }).join('');
  const emptyMsg = !visible.length
    ? `<div class="input-help">No setups match this direction. Switch direction in the header.</div>`
    : '';

  const orbChips = isOrb ? `
    <div class="tf-chip-row" id="tf-i-orb-chips" style="margin-top:12px;">
      <span class="tf-chip-row-label">Range:</span>
      ${TRADE_ORB_TYPES.map(o => `
        <button type="button" class="tf-chip ${(it.orbType || '30') === o.id ? 'selected' : ''}" data-tf-i-orb-type="${o.id}">${o.label}</button>
      `).join('')}
    </div>` : '';

  // Smart paste — top of the flow. The parser already understands the
  // ThinkScript alert format (TICKER, OR_HI/OR_LO/RNG, VWAP, BID/ASK,
  // ENTRY/STOP/TARGET, BREADTH/CONFLUENCE, setup name). Pasting (Cmd+V)
  // applies immediately; manual click works too.
  const smartPaste = `
    <div class="trade-section tf-smart-paste-section" id="tf-i-paste-panel" hidden>
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title" style="display:flex; align-items:center; gap:8px;">
            <span style="color: var(--cyan); font-size: 16px;">⚡</span> Smart paste
          </div>
          <div class="trade-section-subtitle">Paste TOS alert text to auto-fill fields.</div>
        </div>
      </div>
      <div class="trade-section-body" style="padding-top: 4px;">
        <div style="display:flex; gap:8px; align-items:stretch;">
          <textarea id="tf-i-paste" rows="2" class="trade-textarea" style="flex:1; min-height: 56px;" placeholder="Paste alert text here — auto-applies on paste"></textarea>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button type="button" id="tf-i-paste-apply" class="trade-template-btn" style="white-space:nowrap;">Apply</button>
          </div>
        </div>
        <div id="tf-i-paste-result" class="input-help" style="margin-top:6px; min-height:14px;"></div>
      </div>
    </div>`;

  // ORB levels — only when an ORB setup is selected. Otherwise hidden.
  const filled = (v) => v !== null && v !== undefined && v !== '';
  const inputValue = (key) => (it[key] ?? '');
  const orFilledN = [filled(it.orHi), filled(it.orLo)].filter(Boolean).length;
  const rngText = (filled(it.orHi) && filled(it.orLo) && Number(it.orHi) >= Number(it.orLo))
    ? `RNG ${(+(Number(it.orHi) - Number(it.orLo)).toFixed(2))}`
    : 'RNG —';
  const orSection = (it.setup && isOrb) ? `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> OR levels</div>
          <div class="trade-section-subtitle">From your ORB cloud alert. RNG auto-derives.</div>
        </div>
        <div class="trade-section-counter optional">optional</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">OR_HI $</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-orHi" value="${inputValue('orHi')}" placeholder="OR_HI from TOS alert" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">OR_LO $</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-orLo" value="${inputValue('orLo')}" placeholder="OR_LO from TOS alert" />
          </div></div>
        </div>
        <div style="margin-top:10px;">
          <span class="trade-bracket low" style="font-size: 11px; padding: 5px 10px;" id="tf-i-orRng-readout">${rngText}</span>
        </div>
      </div>
    </div>` : '';

  // Context chips — only after a setup is selected.
  const confChips = TRADE_CONFLUENCE_OPTIONS.map(c => `
    <button type="button" class="tf-chip ${it.confluence === c.id ? 'selected ' + (c.bias || 'neutral') : ''}" data-tf-i-conf="${c.id}">${c.label}</button>
  `).join('');
  const breadthChips = TRADE_BREADTH_OPTIONS.map(b => `
    <button type="button" class="tf-chip ${it.breadth === b.id ? 'selected ' + (b.id === 'up' ? 'long' : b.id === 'down' ? 'short' : 'neutral') : ''}" data-tf-i-breadth="${b.id}">${b.label}</button>
  `).join('');
  const hasContext = it.confluence || it.breadth || it.vwapValue || it.notes;
  const contextSection = it.setup ? `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">${isOrb ? 'C.' : 'B.'}</span> Context</div>
          <div class="trade-section-subtitle">Adds chart context to the journal.</div>
        </div>
        <div class="trade-section-counter optional">optional</div>
      </div>
      <div class="trade-section-body">
        <div class="tf-chip-row" style="row-gap:6px;">
          <span class="tf-chip-row-label">Confluence:</span>
          ${confChips}
        </div>
        <div class="tf-chip-row" style="margin-top:8px; row-gap:6px;">
          <span class="tf-chip-row-label">Breadth:</span>
          ${breadthChips}
        </div>
        <div class="trade-section-grid-2" style="margin-top:12px;">
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">VWAP value</label>
              <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-vwapValue" value="${it.vwapValue ?? ''}" placeholder="From VWAP label" />
            </div>
          </div>
        </div>
      </div>
    </div>` : '';

  return `
    ${smartPaste}
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Pick setup</div>
          <div class="trade-section-subtitle">Direction auto-aligns from setup bias.</div>
        </div>
        <div class="trade-section-counter required ${it.setup ? 'complete' : ''}">${it.setup ? '1 selected' : 'pick 1'}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-setup-grid">${cards}</div>
        ${emptyMsg}
        ${orbChips}
      </div>
    </div>
    ${orSection}
    ${contextSection}
  `;
}

function tfMountIntradayStep1() {
  // If the selected setup no longer matches the active direction, clear it.
  const it = state.intraday || {};
  if (it.setup) {
    const dirKey = (it.direction || '').toString().toLowerCase().startsWith('s') ? 'short' : 'long';
    const def = (typeof window.tfFindIntradaySetup === 'function') ? window.tfFindIntradaySetup(it.setup) : null;
    const bias = def ? (def.bias || 'either') : 'either';
    if (bias !== 'either' && bias !== dirKey) {
      it.setup = null;
      saveState();
    }
  }
  // Smart paste — applies on Cmd+V (paste event) or click of Apply button.
  // Counts only the meaningful keys (skips containers like `liquidity` /
  // `gates`) so the user gets a truthful "filled N fields" toast.
  const pasteEl = document.getElementById('tf-i-paste');
  const pasteBtn = document.getElementById('tf-i-paste-apply');
  const resultEl = document.getElementById('tf-i-paste-result');
  const applyPaste = (text) => {
    const raw = (text || '').trim();
    if (!raw) {
      if (resultEl) resultEl.textContent = '';
      return;
    }
    const parsed = window.tfParseIntradayPaste(raw) || {};
    const isFilled = (v) => v !== undefined && v !== null && v !== '';
    const meaningful = Object.entries(parsed).filter(([k, v]) => isFilled(v) && typeof v !== 'object');
    if (!meaningful.length) {
      if (resultEl) {
        resultEl.style.color = 'var(--amber)';
        resultEl.textContent = 'No recognized labels found.';
      }
      return;
    }
    window.tfApplyIntradayPaste(parsed);
    if (pasteEl) pasteEl.value = '';
    if (resultEl) {
      resultEl.style.color = 'var(--cyan)';
      resultEl.textContent = `Filled ${meaningful.length} field${meaningful.length === 1 ? '' : 's'}.`;
    }
    window.tfRefreshAll();
  };
  if (pasteEl) {
    // The paste event fires before the textarea's value updates, so read on
    // the next tick.
    pasteEl.addEventListener('paste', () => setTimeout(() => applyPaste(pasteEl.value), 30));
  }
  if (pasteBtn) {
    pasteBtn.addEventListener('click', () => applyPaste(pasteEl ? pasteEl.value : ''));
  }
  // Setup pattern — auto-align direction with bias on first pick.
  document.querySelectorAll('#panel-trade [data-tf-i-setup]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.tfISetup;
      if (!state.intraday) state.intraday = newIntradayTicket();
      state.intraday.setup = id;
      const def = window.tfFindIntradaySetup(id);
      if (def && def.bias === 'long')  state.intraday.direction = 'long';
      if (def && def.bias === 'short') state.intraday.direction = 'short';
      window.tfAutoFillIntradayStockFromOR();
      saveState();
      window.tfRefreshAll();
    });
  });

  // ORB range chips (only present when setup is an ORB variant).
  document.querySelectorAll('#panel-trade [data-tf-i-orb-type]').forEach(b => {
    b.addEventListener('click', () => {
      if (!state.intraday) state.intraday = newIntradayTicket();
      state.intraday.orbType = b.dataset.tfIOrbType;
      saveState();
      window.tfRefreshAll();
    });
  });
}

// ----- Intraday plan — Levels (entry/stop/target + optional ORB OR levels) -----
function tfIntradayStep2() {
  const it = state.intraday || {};
  const isOptions = window.tfIntradayInstrument() !== 'stocks';
  const draft = (state.tradeFlow && state.tradeFlow.intradayDraft) || {};
  const filled = (v) => v !== null && v !== undefined && v !== '';
  const inputValue = (key) => (draft[key] !== undefined && draft[key] !== '') ? draft[key] : (it[key] ?? '');
  const entryOk = filled(it.entry);
  const qtyOk = filled(it.contracts);
  const reqN = [entryOk, qtyOk].filter(Boolean).length;

  const levelsLetter = 'A.';
  const sizingHtml = (typeof window.tfRenderIntradaySizingHtml === 'function')
    ? window.tfRenderIntradaySizingHtml()
    : '';

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">${levelsLetter}</span> Entry, stop & limit</div>
          <div class="trade-section-subtitle">Set prices and size.</div>
        </div>
        <div class="trade-section-counter required ${reqN === 2 ? 'complete' : ''}" id="tf-i-lvl-counter">${reqN === 2 ? 'ready' : `${reqN} of 2`}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">Entry Price $</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-entry" value="${inputValue('entry')}" placeholder="${isOptions ? 'Fill price' : 'Share entry'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">
              <span>Stop price $</span>
              <button type="button" class="tf-auto-chip" id="tf-i-Smart-Stop">Smart-Stop</button>
            </label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-stop" value="${inputValue('stop')}" placeholder="${isOptions ? 'Take-loss fill' : 'Invalidation price'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">
              <span>Limit Price $</span>
              <button type="button" class="tf-auto-chip" id="tf-i-Smart-Target">Smart-Limit</button>
            </label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-target" value="${inputValue('target')}" placeholder="${isOptions ? 'Take-profit fill' : 'Take-profit price'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">
              <span>${isOptions ? 'Contracts' : 'Shares'}</span>
              <button type="button" class="tf-auto-chip" id="tf-i-Smart-Size">Smart-Size</button>
            </label>
            <input type="number" min="1" step="1" class="trade-input" id="tf-i-contracts" value="${inputValue('contracts')}" placeholder="Blank = auto from risk" />
          </div></div>
        </div>
        <div id="tf-i-sizing-card" style="margin-top:14px;">${sizingHtml}</div>
      </div>
    </div>
  `;
}

function tfUpdateIntradayLvlCounter() {
  const counter = document.getElementById('tf-i-lvl-counter');
  if (!counter) return;
  const f = (v) => v !== null && v !== undefined && v !== '';
  const it = state.intraday || {};
  const n = [f(it.entry), f(it.contracts)].filter(Boolean).length;
  counter.textContent = n === 2 ? 'ready' : `${n} of 2`;
  counter.classList.toggle('complete', n === 2);
}

function tfMountIntradayStep2() {
  const wire = (id, key, isInt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '' };
      if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
      state.tradeFlow.intradayDraft[key] = e.target.value;
      const v = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
      state.intraday[key] = isNaN(v) ? null : v;
      saveState();
      window.tfRefreshHeaderOnly();
      if (key === 'entry' || key === 'stop' || key === 'target' || key === 'contracts') {
        window.tfUpdateIntradayRMult();
        window.tfUpdateIntradaySizing();
        tfUpdateIntradayLvlCounter();
      }
      // RNG is derived (no input field) — recompute on every HI/LO edit.
      // The readout badge below the inputs reflects the live value.
      if (key === 'orHi' || key === 'orLo') {
        const hi = Number(state.intraday.orHi);
        const lo = Number(state.intraday.orLo);
        const readout = document.getElementById('tf-i-orRng-readout');
        if (hi > 0 && lo > 0 && hi >= lo) {
          state.intraday.orRng = +(hi - lo).toFixed(2);
          if (readout) readout.textContent = `RNG ${state.intraday.orRng}`;
          window.tfAutoFillIntradayStockFromOR();
          saveState();
        } else {
          state.intraday.orRng = null;
          if (readout) readout.textContent = 'RNG —';
        }
      }
      if (key === 'orHi' || key === 'orLo' || key === 'orRng') {
        window.tfAutoFillIntradayStockFromOR();
        ['entry', 'stop', 'target'].forEach(levelKey => {
          const levelEl = document.getElementById(`tf-i-${levelKey}`);
          if (levelEl && state.intraday[levelKey] !== null && state.intraday[levelKey] !== undefined) {
            levelEl.value = state.intraday[levelKey];
          }
        });
        window.tfUpdateIntradayRMult();
        window.tfUpdateIntradaySizing();
        saveState();
      }
    });
  };
  wire('tf-i-entry', 'entry');
  wire('tf-i-stop', 'stop');
  wire('tf-i-target', 'target');
  wire('tf-i-contracts', 'contracts', true);
  wire('tf-i-orHi', 'orHi');
  wire('tf-i-orLo', 'orLo');

  // AUTO stop — settings.stopPct × regime multiplier (tightens in neutral / risk-off).
  const autoStopBtn = document.getElementById('tf-i-Smart-Stop');
  if (autoStopBtn) {
    autoStopBtn.addEventListener('click', () => {
      const it = state.intraday || {};
      const entry = Number(it.entry);
      if (!(entry > 0)) {
        if (typeof window.toast === 'function') window.toast('Enter the entry first.', true);
        return;
      }
      const baseStopPct = ((state.settings && state.settings.stopPct) || 50) / 100;
      const regimeMult  = (typeof window.getRegimeRiskMultiplier === 'function') ? window.getRegimeRiskMultiplier(state.regime) : 1;
      const stopPct = baseStopPct * regimeMult;
      const dir = (it.direction || 'long').toLowerCase();
      const isShort = dir.startsWith('s');
      const stop = +(isShort ? entry * (1 + stopPct) : entry * (1 - stopPct)).toFixed(2);
      state.intraday.stop = stop;
      if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '' };
      if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
      state.tradeFlow.intradayDraft.stop = String(stop);
      const el = document.getElementById('tf-i-stop');
      if (el) el.value = stop;
      saveState();
      window.tfUpdateIntradayRMult();
      window.tfUpdateIntradaySizing();
      tfUpdateIntradayLvlCounter();
      window.tfRefreshHeaderOnly();
    });
  }
  // AUTO limit — entry ± N × stop distance (N = settings.targetRMultiple, default 2).
  const autoTargetBtn = document.getElementById('tf-i-Smart-Target');
  if (autoTargetBtn) {
    autoTargetBtn.addEventListener('click', () => {
      const it = state.intraday || {};
      const entry = Number(it.entry);
      const stop  = Number(it.stop);
      if (!(entry > 0 && stop > 0)) {
        if (typeof window.toast === 'function') window.toast('Fill entry and stop first.', true);
        return;
      }
      const targetR = Number(state.settings && state.settings.targetRMultiple) > 0
        ? Number(state.settings.targetRMultiple)
        : 2;
      const isOptions = window.tfIntradayInstrument() !== 'stocks';
      const isShort = (it.direction || 'long').toLowerCase().startsWith('s');
      const stopDist = Math.abs(entry - stop);
      const target = isOptions
        ? +(entry + targetR * stopDist).toFixed(2)
        : +(isShort ? entry - targetR * stopDist : entry + targetR * stopDist).toFixed(2);
      state.intraday.target = target;
      if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '' };
      if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
      state.tradeFlow.intradayDraft.target = String(target);
      const el = document.getElementById('tf-i-target');
      if (el) el.value = target;
      saveState();
      window.tfUpdateIntradayRMult();
      window.tfUpdateIntradaySizing();
      tfUpdateIntradayLvlCounter();
      window.tfRefreshHeaderOnly();
    });
  }
  // AUTO size — fill contracts/shares from risk-unit ÷ stop distance.
  const autoSizeBtn = document.getElementById('tf-i-Smart-Size');
  if (autoSizeBtn) {
    autoSizeBtn.addEventListener('click', () => {
      const qty = window.tfApplyIntradayRiskSize();
      if (!qty) {
        if (typeof window.toast === 'function') window.toast('Fill entry and stop first.', true);
        return;
      }
      const el = document.getElementById('tf-i-contracts');
      if (el) el.value = qty;
      saveState();
      window.tfUpdateIntradayRMult();
      window.tfUpdateIntradaySizing();
      tfUpdateIntradayLvlCounter();
      window.tfRefreshHeaderOnly();
    });
  }
}

// Sizing now lives inline inside step 2 (Entry · stop · limit). Kept as a
// stub so the stepper can still concatenate the two without changes.
function tfIntradayStep3() {
  return '';
}

function tfMountIntradayStep3() {
  // Sizing card renders inline inside step 2. Bind the sliders so the
  // initial render (before any input change) is interactive.
  if (typeof window.tfBindPriceLevelSliders === 'function') window.tfBindPriceLevelSliders();
  if (typeof window.tfBindIntradayRiskSizeButton === 'function') window.tfBindIntradayRiskSizeButton();
}

// ----- Intraday step 3 — Review summary -----
// Clean confirmation card. Context inputs and ORB levels now live in Step 1.
// Guardrails removed per design — GO still respects the underlying status logic.
function tfIntradayStep4() {
  const it = state.intraday || {};
  const isOptions = window.tfIntradayInstrument() !== 'stocks';
  const setupDef = window.tfFindIntradaySetup(it.setup);
  const setupName = setupDef ? setupDef.name : '—';
  const tickerStr = it.ticker || '—';
  const dirStr = it.direction ? it.direction.toUpperCase() : '—';
  const entryStr = it.entry ? `$${Number(it.entry).toFixed(2)}` : '—';
  const stopStr  = it.stop  ? `$${Number(it.stop).toFixed(2)}`  : '—';
  const tgtStr   = it.target ? `$${Number(it.target).toFixed(2)}` : '—';
  const auto = (typeof window.tfComputeIntradayRiskSize === 'function') ? window.tfComputeIntradayRiskSize() : null;
  const qty = Number(it.contracts) || (auto ? auto.qty : 0);
  const qtyLabel = isOptions ? 'contracts' : 'shares';
  const riskBudget = auto ? auto.riskBudget : 0;

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Review &amp; log</div>
          <div class="trade-section-subtitle">Verify the plan, then GO.</div>
        </div>
      </div>
      <div class="trade-section-body">
        <div class="trade-output" style="padding:14px 16px;">
          <div class="trade-output-main" style="font-size:14px;">
            <span style="color:var(--cyan);">${tickerStr}</span> · ${dirStr} · ${setupName}
          </div>
          <div class="trade-output-rationale" style="font-size:12px; margin-top:6px; line-height:1.6;">
            Entry <strong>${entryStr}</strong> · Stop <strong>${stopStr}</strong> · Target <strong>${tgtStr}</strong><br/>
            Size <strong>${qty || '—'} ${qtyLabel}</strong>${riskBudget ? ` · Budget <strong>$${riskBudget}</strong>` : ''}
          </div>
        </div>
        <div class="trade-input-row" style="grid-template-columns: 1fr; margin-top:14px;">
          <div>
            <label class="input-label">Notes</label>
            <textarea class="trade-textarea" id="tf-i-notes" rows="3" placeholder="Trigger, invalidation, anything to remember">${it.notes || ''}</textarea>
          </div>
        </div>
      </div>
    </div>
  `;
}

function tfMountIntradayStep4() {
  // Jump-to-fix on each failing check.
  document.querySelectorAll('#panel-trade [data-tf-jump]').forEach(el => {
    el.addEventListener('click', () => {
      const target = parseInt(el.dataset.tfJump, 10);
      if (target) window.tfGoToStep(target);
    });
  });
  // Confluence chip — toggle on/off.
  document.querySelectorAll('#panel-trade [data-tf-i-conf]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.tfIConf;
      state.intraday.confluence = (state.intraday.confluence === id) ? '' : id;
      saveState();
      window.tfRefreshAll();
    });
  });
  // Breadth chip — toggle on/off.
  document.querySelectorAll('#panel-trade [data-tf-i-breadth]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.tfIBreadth;
      state.intraday.breadth = (state.intraday.breadth === id) ? '' : id;
      saveState();
      window.tfRefreshAll();
    });
  });
  // VWAP value input — informational, no header refresh needed.
  const v = document.getElementById('tf-i-vwapValue');
  if (v) {
    v.addEventListener('input', e => {
      const n = parseFloat(e.target.value);
      state.intraday.vwapValue = isNaN(n) ? null : n;
      saveState();
    });
  }
  const t = document.getElementById('tf-i-notes');
  if (t) {
    t.addEventListener('input', e => {
      state.intraday.notes = e.target.value;
      saveState();
    });
  }
}

// Dev utility — populate the intraday flow with realistic random data so
// the rest of the UI can be exercised without typing every field.
function tfDemoFillIntraday() {
  const tickers = ['SPY','QQQ','AAPL','TSLA','NVDA','AMD','META','MSFT'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rand = (min, max, dec = 2) => +(min + Math.random() * (max - min)).toFixed(dec);
  const setupDef = pick(TRADE_INTRADAY_SETUPS);
  const dir = setupDef.bias === 'either' ? (Math.random() < 0.5 ? 'long' : 'short') : setupDef.bias;
  const isOptions = Math.random() < 0.7;
  if (!state.intraday) state.intraday = newIntradayTicket();
  const it = state.intraday;
  it.ticker = pick(tickers);
  it.setup = setupDef.id;
  it.direction = dir;
  it.instrument = isOptions ? 'options' : 'stocks';
  it.structure = isOptions ? 'options' : 'stocks';
  if (isOptions) {
    const mid = rand(2.5, 7.5, 2);
    const half = +(mid * rand(0.006, 0.022, 3) / 2).toFixed(2);
    it.bid = +(mid - half).toFixed(2);
    it.ask = +(mid + half).toFixed(2);
    it.mid = mid;
    it.entry = mid;
    it.stop = +(mid * 0.55).toFixed(2);
    it.target = +(mid * 1.6).toFixed(2);
  } else {
    const px = rand(80, 480, 2);
    it.entry = px;
    it.stop = +(px * (dir === 'long' ? 0.985 : 1.015)).toFixed(2);
    it.target = +(px * (dir === 'long' ? 1.03 : 0.97)).toFixed(2);
  }
  if (setupDef.isOrb) {
    const center = it.entry;
    const rng = rand(0.5, 4, 2);
    it.orHi = +(center + rng/2).toFixed(2);
    it.orLo = +(center - rng/2).toFixed(2);
    it.orRng = rng;
    it.orbType = pick(['5','15','30']);
  }
  it.confluence = dir === 'long' ? 'long-bias' : 'short-bias';
  it.breadth = dir === 'long' ? 'up' : 'down';
  it.vwapValue = rand(80, 480, 2);
  window.tfDeriveIntradaySpread();
  saveState();
  if (typeof window.toast === 'function') window.toast('Demo intraday filled');
  window.renderTrade();
}

window.tfDemoFillIntraday = tfDemoFillIntraday;
window.tfFindIntradaySetup = tfFindIntradaySetup;
window.tfParseHumanNumber = tfParseHumanNumber;
window.tfReadKeyNumber = tfReadKeyNumber;
window.tfGradePasses = tfGradePasses;
window.tfParseIntradayPaste = tfParseIntradayPaste;
window.tfApplyIntradayPaste = tfApplyIntradayPaste;
window.tfIntradayStep1 = tfIntradayStep1;
window.tfMountIntradayStep1 = tfMountIntradayStep1;
window.tfIntradayStep2 = tfIntradayStep2;
window.tfMountIntradayStep2 = tfMountIntradayStep2;
window.tfIntradayStep3 = tfIntradayStep3;
window.tfMountIntradayStep3 = tfMountIntradayStep3;
window.tfIntradayStep4 = tfIntradayStep4;
window.tfMountIntradayStep4 = tfMountIntradayStep4;
