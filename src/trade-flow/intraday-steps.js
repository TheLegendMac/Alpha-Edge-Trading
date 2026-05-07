// Intraday trade flow steps 1-4 with mount handlers + paste import + utility helpers.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { TRADE_INTRADAY_SETUPS, TRADE_ORB_TYPES, TRADE_CONFLUENCE_OPTIONS, TRADE_BREADTH_OPTIONS, TRADE_SETUP_TEMPLATES } from '../config/constants.js';

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

  // Ticker — explicit "TICKER=SPY" or "SYM=SPY" key.
  const mTk = text && text.match(/(?:TICKER|SYMBOL|SYM)\s*[=:]\s*([A-Z]{1,6})/i);
  if (mTk) out.ticker = mTk[1].toUpperCase();

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
  const cards = TRADE_INTRADAY_SETUPS.map(s => {
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
          <div class="trade-section-subtitle">Paste your TOS alert text — auto-fills setup, OR levels, bid/ask, entry/stop/target. Cmd+V into the box.</div>
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

  return `
    ${smartPaste}
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">1.</span> Pick the setup</div>
          <div class="trade-section-subtitle">Mirrors your ThinkScript labels. Direction auto-aligns from the picked pattern's bias.</div>
        </div>
        <div class="trade-section-counter ${it.setup ? 'complete' : ''}">${it.setup ? '1 selected' : 'pick 1'}</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-setup-grid">${cards}</div>
        ${orbChips}
      </div>
    </div>
  `;
}

function tfMountIntradayStep1() {
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
  const lvlN = [filled(it.entry), filled(it.stop), filled(it.target)].filter(Boolean).length;
  const r = (it.entry && it.stop && it.target)
    ? Math.abs((Number(it.target) - Number(it.entry)) / (Number(it.entry) - Number(it.stop)))
    : null;
  const rText = r !== null && isFinite(r) ? `${r.toFixed(2)}R reward / risk` : '—';
  const rGood = r !== null && isFinite(r) && r >= 1.5;

  const setupDef = window.tfFindIntradaySetup(it.setup);
  const isOrb = !!(setupDef && setupDef.isOrb);
  const orFilledN = [filled(it.orHi), filled(it.orLo)].filter(Boolean).length;
  const rngText = (filled(it.orHi) && filled(it.orLo) && Number(it.orHi) >= Number(it.orLo))
    ? `RNG ${(+(Number(it.orHi) - Number(it.orLo)).toFixed(2))}`
    : 'RNG —';
  const levelsLetter = isOptions ? 'B.' : 'A.';
  const orLetter = isOptions ? 'C.' : 'B.';

  // ORB section is optional ("bypass if not shown" — only present when an
  // ORB pattern is the picked setup, and even then the user can leave it
  // empty without blocking GO). RNG auto-derives from HI − LO and renders
  // as a read-only badge — one fewer field to type.
  const orSection = isOrb ? `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">${orLetter}</span> Opening Range levels</div>
          <div class="trade-section-subtitle">From your ORB cloud alert: <code>OR_HI=… | OR_LO=…</code>. Optional — RNG auto-derives.</div>
        </div>
        <div class="trade-section-counter">${orFilledN} of 2 (optional)</div>
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

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">${levelsLetter}</span> Entry · stop · target</div>
          <div class="trade-section-subtitle">${isOptions ? 'Auto-filled from bid/ask mid. Edit only when your actual limit, stop, or target differs.' : 'Share-price bracket. ORB alerts can fill this automatically for stock trades.'}</div>
        </div>
        <div class="trade-section-counter ${lvlN === 3 ? 'complete' : ''}">${lvlN} of 3</div>
      </div>
      <div class="trade-section-body">
        <div class="trade-section-grid-2">
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">${isOptions ? 'Entry premium / mid $' : 'Entry price $'}</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-entry" value="${inputValue('entry')}" placeholder="${isOptions ? 'Auto from quote' : 'Share entry price'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">${isOptions ? 'Stop premium $' : 'Stop price $'}</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-stop" value="${inputValue('stop')}" placeholder="${isOptions ? 'Auto premium stop' : 'Invalidation price'}" />
          </div></div>
          <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
            <label class="input-label">${isOptions ? 'Target premium $' : 'Target price $'}</label>
            <input type="number" min="0" step="0.01" class="trade-input" id="tf-i-target" value="${inputValue('target')}" placeholder="${isOptions ? 'Auto premium target' : 'Target price'}" />
          </div></div>
        </div>
        <div id="tf-i-rmult" style="margin-top:10px; display:flex; align-items:center; gap:8px;">
          <span class="trade-bracket ${rGood ? 'high' : (r !== null && isFinite(r) ? 'mid' : 'low')}" style="font-size: 11px; padding: 5px 10px;">${rText}</span>
          <span class="input-help" style="margin:0;">Reward / risk · target ÷ stop distance.</span>
        </div>
      </div>
    </div>
    ${orSection}
  `;
}

function tfMountIntradayStep2() {
  const wire = (id, key, isInt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
      if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
      state.tradeFlow.intradayDraft[key] = e.target.value;
      const v = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
      state.intraday[key] = isNaN(v) ? null : v;
      saveState();
      window.tfRefreshHeaderOnly();
      if (key === 'entry' || key === 'stop' || key === 'target') {
        window.tfUpdateIntradayRMult();
        window.tfUpdateIntradaySizing();
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
  wire('tf-i-orHi', 'orHi');
  wire('tf-i-orLo', 'orLo');
}

// ----- Intraday plan — Size: options bid/ask spread or stock share count -----
function tfIntradayStep3() {
  const it = state.intraday || {};
  const isOptions = window.tfIntradayInstrument() !== 'stocks';
  const draft = (state.tradeFlow && state.tradeFlow.intradayDraft) || {};
  const inputValue = (key) => (draft[key] !== undefined && draft[key] !== '') ? draft[key] : (it[key] ?? '');
  const spread = window.tfDeriveIntradaySpread();
  const settings = state.settings || DEFAULT_SETTINGS;
  const sizeLetter = isOptions ? 'A.' : 'C.';

  const optionsSizing = `
    ${window.tfOptionBidAskInputsHtml({
      bidValue: inputValue('bid'),
      askValue: inputValue('ask'),
      bidAttrs: 'id="tf-i-bid"',
      askAttrs: 'id="tf-i-ask"',
      spread,
      spreadMax: settings.intradayMaxSpreadPct || 5,
    })}
    <div class="trade-templates" style="margin-top:10px;">
      <button type="button" class="trade-template-btn" id="tf-i-use-quote">Reset levels to quote</button>
      <span class="trade-templates-label">Sets entry to mid, then rebuilds stop and target.</span>
    </div>
    <div class="trade-section-grid-2">
      <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
        <label class="input-label">Contracts override</label>
        <input type="number" min="1" step="1" class="trade-input" id="tf-i-contracts" value="${inputValue('contracts')}" placeholder="Auto from risk, or override" />
        <div class="input-help">Blank uses the suggested risk-unit size.</div>
      </div></div>
    </div>`;

  const stockSizing = `
    <div class="trade-section-grid-2">
      <div class="trade-input-row" style="grid-template-columns: 1fr;"><div>
        <label class="input-label">Shares override</label>
        <input type="number" min="1" step="1" class="trade-input" id="tf-i-contracts" value="${inputValue('contracts')}" placeholder="Shares, or leave blank" />
        <div class="input-help">Blank uses the suggested risk-unit size.</div>
      </div></div>
    </div>`;

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">${sizeLetter}</span> ${isOptions ? 'Option quote & risk size' : 'Share risk size'}</div>
          <div class="trade-section-subtitle">${isOptions ? `Bid/ask creates the mid entry and spread check. Quantity is suggested from your $${settings.intradayRiskPerTrade || 100} risk unit.` : `Quantity is suggested from your $${settings.intradayRiskPerTrade || 100} risk unit.`}</div>
        </div>
      </div>
      <div class="trade-section-body">
        ${isOptions ? optionsSizing : stockSizing}
        <div id="tf-i-sizing-card">${window.tfRenderIntradaySizingHtml()}</div>
      </div>
    </div>
  `;
}

function tfMountIntradayStep3() {
  const updateOptionDerived = ({ forceBracket = false } = {}) => {
    const spread = window.tfDeriveIntradaySpread();
    window.tfAutoFillIntradayOptionBracket({ force: forceBracket });
    if (forceBracket) {
      if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
      if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
      ['entry', 'stop', 'target'].forEach(key => {
        state.tradeFlow.intradayDraft[key] = state.intraday[key] ?? '';
      });
    }
    ['entry', 'stop', 'target'].forEach(key => {
      const el = document.getElementById(`tf-i-${key}`);
      if (el && state.intraday[key] !== null && state.intraday[key] !== undefined) el.value = state.intraday[key];
    });
    window.tfUpdateIntradayRMult();
    window.tfUpdateIntradaySizing();
    const spreadRead = document.querySelector('#panel-trade #tf-i-bid')?.closest('.trade-section')?.querySelector('[data-tf-spread-read]');
    if (spreadRead) spreadRead.innerHTML = window.tfSpreadReadHtml(spread);
    const badge = document.querySelector('#panel-trade #tf-i-bid')?.closest('.trade-input-row')?.querySelector('.trade-bracket')
      || document.querySelector('#panel-trade .trade-bracket');
    if (badge) {
      const b = window.tfSpreadBracket(state.intraday.spreadPct);
      badge.className = `trade-bracket ${b.cls}`;
      badge.textContent = b.text;
    }
  };
  const wire = (id, key, isInt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      if (!state.tradeFlow) state.tradeFlow = { mode: 'intraday', step: 1, thesis: '', preMortem: '', moonshotR: 3 };
      if (!state.tradeFlow.intradayDraft) state.tradeFlow.intradayDraft = {};
      state.tradeFlow.intradayDraft[key] = e.target.value;
      const v = isInt ? parseInt(e.target.value) : parseFloat(e.target.value);
      state.intraday[key] = isNaN(v) ? null : v;
      if (key === 'bid' || key === 'ask') updateOptionDerived();
      saveState();
      window.tfRefreshHeaderOnly();
      window.tfUpdateIntradaySizing();
    });
  };
  wire('tf-i-bid', 'bid');
  wire('tf-i-ask', 'ask');
  wire('tf-i-contracts', 'contracts', true);
  const quoteBtn = document.getElementById('tf-i-use-quote');
  if (quoteBtn) {
    quoteBtn.addEventListener('click', () => {
      const spread = window.tfDeriveIntradaySpread();
      if (spread === null) {
        if (typeof toast === 'function') window.toast('Enter a valid bid and ask first.', true);
        return;
      }
      updateOptionDerived({ forceBracket: true });
      saveState();
      window.tfRefreshHeaderOnly();
    });
  }
  window.tfBindIntradayRiskSizeButton();
}

// ----- Intraday step 3 — Context: optional ThinkScript chips + guardrails -----
// Confluence + breadth chips capture what the user is reading off the chart
// (MAC_Intraday_VWAP_Confluence + MAC_Intraday_Breadth labels). They flow
// into the trade log; only an explicit confluence conflict blocks GO.
function tfIntradayStep4() {
  const it = state.intraday || {};
  const isOptions = window.tfIntradayInstrument() !== 'stocks';
  const settings = state.settings || DEFAULT_SETTINGS;
  const inWin = (typeof isInIntradayWindow === 'function') ? window.isInIntradayWindow() : true;
  const tov   = !!(state.intradayQuality && state.intradayQuality.timeOverride);
  const dayPL = window.tfComputeIntradayDayPL();
  const lossBudget = settings.intradayMaxDailyLoss + dayPL;
  const setupDef = window.tfFindIntradaySetup(it.setup);
  const spreadPct = isOptions ? window.tfDeriveIntradaySpread() : null;

  // Direction vs setup bias — explicit conflict (e.g. ORB UP-BREAK + Short).
  const dirSetupOk = !setupDef || setupDef.bias === 'either' || it.direction === setupDef.bias;

  // Direction vs confluence chip (LONG BIAS / SHORT BIAS / MIXED).
  const conf = (TRADE_CONFLUENCE_OPTIONS.find(c => c.id === it.confluence) || null);
  const dirConfOk = !conf || conf.bias === 'either' || it.direction === conf.bias;

  const checks = [
    { key: 'dir-setup', step: 1, name: 'Setup bias', ok: dirSetupOk,
      rule: setupDef ? `${setupDef.name} expects ${setupDef.bias === 'either' ? 'either direction' : setupDef.bias.toUpperCase()}.` : 'Pick a setup first.' },
    { key: 'dir-conf',  step: 3, name: 'VWAP confluence', ok: dirConfOk,
      rule: conf ? `Confluence chip is ${conf.label}.` : 'Optional — leave blank when you do not need it.' },
    { key: 'spread',    step: 2, name: isOptions ? `Spread ≤ ${settings.intradayMaxSpreadPct}%` : 'Spread not needed for stock', ok: !isOptions || (spreadPct !== null && spreadPct <= settings.intradayMaxSpreadPct),
      rule: isOptions ? 'Uses bid/ask from the quote section.' : 'Stock trades skip option-chain spread.' },
    { key: 'window',    step: 3, name: 'Entry window', ok: inWin || tov,
      rule: '09:35–11:30 or 14:00–15:30 local. Override for paper.' },
    { key: 'budget',    step: 3, name: 'Daily loss budget', ok: lossBudget > 0,
      rule: `Today: ${dayPL >= 0 ? '+$' : '-$'}${Math.abs(dayPL).toFixed(0)}. Cap: $${settings.intradayMaxDailyLoss}.` },
  ];
  const passed = checks.filter(c => c.ok).length;
  const total  = checks.length;
  const allGreen = passed === total;

  // Guardrails — compact pill row when ready, expanded list of failing rows
  // when not. Passing rows still appear as small badges so the user can see
  // what was checked, but only the failing rows get the full button treatment.
  const passingPills = checks.filter(c => c.ok).map(c => `
    <span class="trade-bracket low" style="font-size: 10px; padding: 4px 8px;">✓ ${c.name}</span>
  `).join('');
  const failingRows = checks.filter(c => !c.ok).map(c => `
    <button type="button" class="trade-row fail" data-tf-jump="${c.step}">
      <span class="trade-row-check"></span>
      <span class="trade-row-main">
        <span class="trade-row-name">${c.name}</span>
        <span class="trade-row-help">${c.rule}${c.key === 'window' && !inWin ? ` <span data-tf-i-tov style="margin-left:6px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 4px; cursor: pointer; color: var(--cyan); font-family: var(--mono); font-size: 10px;">${tov ? 'Override on — turn off' : 'Override (paper)'}</span>` : ''}</span>
      </span>
      <span class="trade-row-pill">FIX</span>
    </button>`).join('');

  const banner = allGreen
    ? `<div class="trade-output" style="border-color: var(--green-dim); background: linear-gradient(135deg, var(--green-bg), var(--bg) 70%); padding: 12px 14px;">
         <div class="trade-output-main" style="font-size: 14px;">All clear · ready to send</div>
         <div class="trade-output-rationale" style="font-size: 12px; margin-top: 2px;">Place the bracket in TOS, then GO.</div>
       </div>`
    : `<div class="trade-output" style="padding: 12px 14px;">
         <div class="trade-output-main" style="font-size: 14px;">${total - passed} blocking · ${passed}/${total} passed</div>
         <div class="trade-output-rationale" style="font-size: 12px; margin-top: 2px;">Tap a row to jump to the field that fixes it.</div>
       </div>`;

  // Context chips — confluence + breadth in a single condensed row. The
  // labels for confluence are long enough that we keep two visual rows on
  // narrow widths via flex-wrap.
  const confChips = TRADE_CONFLUENCE_OPTIONS.map(c => `
    <button type="button" class="tf-chip ${it.confluence === c.id ? 'selected ' + (c.bias || 'neutral') : ''}" data-tf-i-conf="${c.id}">${c.label}</button>
  `).join('');
  const breadthChips = TRADE_BREADTH_OPTIONS.map(b => `
    <button type="button" class="tf-chip ${it.breadth === b.id ? 'selected ' + (b.id === 'up' ? 'long' : b.id === 'down' ? 'short' : 'neutral') : ''}" data-tf-i-breadth="${b.id}">${b.label}</button>
  `).join('');
  const hasContext = it.confluence || it.breadth || it.vwapValue || it.notes;

  return `
    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">A.</span> Guardrails</div>
          <div class="trade-section-subtitle">${allGreen ? 'Setup bias, spread, time window, and loss budget all clear.' : 'Tap any failing check to jump to the field that fixes it.'}</div>
        </div>
        <div class="trade-section-counter ${allGreen ? 'complete' : ''}">${passed} of ${total}</div>
      </div>
      <div class="trade-section-body">
        ${banner}
        ${failingRows ? `<div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">${failingRows}</div>` : ''}
        ${passingPills ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:${failingRows ? '12px' : '12px'};">${passingPills}</div>` : ''}
      </div>
    </div>

    <div class="trade-section">
      <div class="trade-section-head">
        <div class="trade-section-head-stack">
          <div class="trade-section-title"><span class="trade-section-title-icon">B.</span> Context (optional)</div>
          <div class="trade-section-subtitle">${hasContext ? 'Captured to the trade log — only conflicting confluence blocks GO.' : 'Optional. Add chart context if it helps the journal.'}</div>
        </div>
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
          <div class="trade-input-row" style="grid-template-columns: 1fr;">
            <div>
              <label class="input-label">Trigger / invalidation</label>
              <textarea class="trade-textarea" id="tf-i-notes" rows="2" placeholder="Trigger, invalidation, context">${it.notes || ''}</textarea>
            </div>
          </div>
        </div>
      </div>
    </div>

    ${typeof window.buildTradeFlowEdgeIntel === 'function' ? window.buildTradeFlowEdgeIntel({
      mode: 'intraday',
      setup: it.setup,
      direction: it.direction,
      instrument: it.instrument,
    }) : ''}
  `;
}

function tfMountIntradayStep4() {
  // Time-window override toggle.
  document.querySelectorAll('#panel-trade [data-tf-i-tov]').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (!state.intradayQuality) state.intradayQuality = { timeOverride: false };
      state.intradayQuality.timeOverride = !state.intradayQuality.timeOverride;
      saveState();
      window.tfRefreshAll();
    });
  });
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
