// Settings — full-page overlay open/close/save.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { DEFAULT_SETTINGS, createDefaultState } from '../config/constants.js';

// ── helpers ──────────────────────────────────────────────────────────
function fmt$(n) { return '$' + Math.abs(Math.round(n)).toLocaleString(); }

function updateLiveHints() {
  const el = (id) => document.getElementById(id);
  const acct  = parseFloat(el('set-account')?.value) || 50000;
  
  // read from regime slider
  let rOn   = parseFloat(el('set-risk-on-r')?.value) || 0.5;
  let rNeu  = parseFloat(el('set-risk-neutral-r')?.value) || 0.25;
  let rOff  = parseFloat(el('set-risk-off-r')?.value) || 0.15;

  // Enforce cascade hierarchy: Risk-On >= Neutral >= Risk-Off
  if (rNeu > rOn) {
    rNeu = rOn;
    if (el('set-risk-neutral-r')) el('set-risk-neutral-r').value = rNeu;
    if (el('sett-sl-neutral')) el('sett-sl-neutral').value = rNeu;
  }
  if (rOff > rNeu) {
    rOff = rNeu;
    if (el('set-risk-off-r')) el('set-risk-off-r').value = rOff;
    if (el('sett-sl-off')) el('sett-sl-off').value = rOff;
  }

  const maxPos = parseInt(el('set-max-positions')?.value, 10) || 4;

  if (el('sett-live-equity'))      el('sett-live-equity').textContent      = '$' + acct.toLocaleString();
  if (el('sett-live-base1r'))      el('sett-live-base1r').textContent      = fmt$(acct * rOn / 100);
  if (el('sett-live-base1r-sub'))  el('sett-live-base1r-sub').textContent  = `${rOn.toFixed(2)}% of equity`;
  if (el('sett-live-cap'))         el('sett-live-cap').textContent         = String(maxPos);
  if (el('sett-live-cap-sub'))     el('sett-live-cap-sub').textContent     = `max open position${maxPos === 1 ? '' : 's'}`;
  if (el('sett-hint-base1r'))      el('sett-hint-base1r').textContent      = `= ${fmt$(acct * rOn / 100)} · 1R`;

  // Regime equiv labels
  if (el('sett-eqv-on'))      el('sett-eqv-on').textContent      = `= ${fmt$(acct * rOn / 100)}`;
  if (el('sett-eqv-neutral')) el('sett-eqv-neutral').textContent = `= ${fmt$(acct * rNeu / 100)}`;
  if (el('sett-eqv-off'))     el('sett-eqv-off').textContent     = `= ${fmt$(acct * rOff / 100)}`;

  // Slider fill
  syncSlider('sett-sl-on',      rOn,   0.1, 100, 'on');
  syncSlider('sett-sl-neutral', rNeu,  0.1, 100, 'neutral');
  syncSlider('sett-sl-off',     rOff,  0.1, 100, 'off');
  syncSlider('sett-sl-pos',     maxPos, 1, 20, 'cap');
  // Mobile list view values
  updateMobileView(acct, rOn);
}

function updateMobileView(acct, rOn) {
  const el = (id) => document.getElementById(id);
  if (!el('sett-mv')) return;
  const a = acct || parseFloat(el('set-account')?.value) || 50000;
  const r = rOn  || parseFloat(el('set-risk-on-r')?.value) || 0.5;
  const rNeu = parseFloat(el('set-risk-neutral-r')?.value) || 0.25;
  const rOff = parseFloat(el('set-risk-off-r')?.value) || 0.15;
  const maxPos  = parseInt(el('set-max-positions')?.value) || 4;
  const f$ = (n) => '$' + Math.abs(Math.round(n)).toLocaleString();

  const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  set('smv-equity', '$' + a.toLocaleString());
  set('smv-1r',     f$(a * r / 100));
  set('smv-s01',    `$${a.toLocaleString()} · ${maxPos} max open`);
  set('smv-s-rOn',  r.toFixed(2) + '%');
  set('smv-s-rNeu', rNeu.toFixed(2) + '%');
  set('smv-s-rOff', rOff.toFixed(2) + '%');
}

function syncSlider(sliderId, val, min, max, kind) {
  const sl = document.getElementById(sliderId);
  if (!sl) return;
  sl.value = val;
  const pct = ((val - min) / (max - min) * 100).toFixed(1);
  const colorMap = { on: 'var(--green-bright)', neutral: '#f59e0b', off: 'var(--red-bright)', cap: 'var(--cyan)', kill: '#f59e0b' };
  const c = colorMap[kind] || 'var(--cyan)';
  sl.style.background = `linear-gradient(90deg, ${c} ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
}


function wireSliderInput(sliderId, inputId, min, max, kind, linkedInputId) {
  const sl = document.getElementById(sliderId);
  const inp = document.getElementById(inputId);
  if (!sl || !inp) return;

  sl.addEventListener('input', () => {
    inp.value = sl.value;
    if (linkedInputId) {
      const li = document.getElementById(linkedInputId);
      if (li) li.value = sl.value;
    }
    syncSlider(sliderId, parseFloat(sl.value), min, max, kind);
    updateLiveHints();
  });
  inp.addEventListener('input', () => {
    sl.value = inp.value;
    if (linkedInputId) {
      const li = document.getElementById(linkedInputId);
      if (li) li.value = inp.value;
    }
    syncSlider(sliderId, parseFloat(inp.value), min, max, kind);
    updateLiveHints();
  });
}

// ── open ─────────────────────────────────────────────────────────────
function openSettings() {
  const s = state.settings;
  const el = (id) => document.getElementById(id);

  // Populate all inputs from state
  if (el('set-account'))        el('set-account').value        = s.account        || DEFAULT_SETTINGS.account;
  
  // Regime risk — stored and displayed as percentage (e.g. 0.50)
  const rOn  = s.riskOn      || DEFAULT_SETTINGS.riskOn;
  const rNeu = s.riskNeutral || DEFAULT_SETTINGS.riskNeutral;
  const rOff = s.riskOff     || DEFAULT_SETTINGS.riskOff;

  if (el('set-risk-on-r'))      el('set-risk-on-r').value      = rOn;
  if (el('set-risk-neutral-r')) el('set-risk-neutral-r').value = rNeu;
  if (el('set-risk-off-r'))     el('set-risk-off-r').value     = rOff;

  if (el('set-max-positions'))  el('set-max-positions').value  = s.maxPositions   || DEFAULT_SETTINGS.maxPositions;
  if (el('set-stop-pct'))       el('set-stop-pct').value       = s.stopPct        ?? DEFAULT_SETTINGS.stopPct;
  if (el('set-target-r'))       el('set-target-r').value       = s.targetRMultiple ?? DEFAULT_SETTINGS.targetRMultiple;
  if (el('set-min-earnings-days')) el('set-min-earnings-days').value = s.minDaysToEarnings ?? DEFAULT_SETTINGS.minDaysToEarnings;

  // Wire sliders (only first time — guard with dataset flag)
  const overlay = document.getElementById('modal-settings');
  if (!overlay.dataset.wired) {
    overlay.dataset.wired = '1';
    wireSliderInput('sett-sl-on',      'set-risk-on-r',      0.1, 100, 'on');
    wireSliderInput('sett-sl-neutral', 'set-risk-neutral-r', 0.1, 100, 'neutral');
    wireSliderInput('sett-sl-off',     'set-risk-off-r',     0.1, 100, 'off');
    wireSliderInput('sett-sl-pos',     'set-max-positions',  1,   20,  'cap');

    // account input triggers all hints
    const acctEl = el('set-account');
    if (acctEl) acctEl.addEventListener('input', updateLiveHints);

    // Export CSV — reuse the existing global handler.
    const exportBtn = el('btn-export-csv');
    if (exportBtn) exportBtn.addEventListener('click', () => {
      if (typeof window.exportCSV === 'function') window.exportCSV();
      else if (typeof window.toast === 'function') window.toast('Export unavailable right now.', true);
    });

    // Report feedback — placeholder for now.
    const feedbackBtn = el('btn-report-feedback');
    if (feedbackBtn) feedbackBtn.addEventListener('click', () => {
      if (typeof window.toast === 'function') window.toast('Feedback channel coming soon.');
    });

    // Version footer — injected at build time via Vite define.
    const verEl = el('sett-version');
    if (verEl) verEl.textContent = (typeof __APP_VERSION__ !== 'undefined') ? __APP_VERSION__ : '—';

    // Sidebar nav highlight on scroll
    const mainScroll = el('sett-main-scroll');
    if (mainScroll) {
      mainScroll.addEventListener('scroll', () => {
        const sections = ['sett-s01','sett-s02','sett-s03','sett-s04'];
        let active = sections[0];
        sections.forEach(id => {
          const sec = el(id);
          if (sec && sec.offsetTop - mainScroll.scrollTop < 200) active = id;
        });
        const navKey = active.replace('sett-s0', 's0');
        overlay.querySelectorAll('[data-sett-nav]').forEach(a => {
          a.classList.toggle('active', a.dataset.settNav === navKey);
        });
      });
    }

    // Smooth scroll nav links
    overlay.querySelectorAll('[data-sett-nav]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const id = 'sett-s0' + a.dataset.settNav.replace('s0','');
        const target = el(id);
        if (target && mainScroll) mainScroll.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' });
      });
    });

    // Mobile list row taps — expand the section inline below the list
    const mvEl = el('sett-mv');
    if (mvEl) {
      mvEl.querySelectorAll('[data-mv-sec]').forEach(row => {
        row.addEventListener('click', () => {
          const secId = row.dataset.mvSec;
          // collapse all first
          document.querySelectorAll('.sett-section.sett-mv-open').forEach(s => s.classList.remove('sett-mv-open'));
          const sec = el(secId);
          if (!sec) return;
          sec.classList.add('sett-mv-open');
          // inject back button once
          if (!sec.querySelector('.sett-mv-back')) {
            const btn = document.createElement('button');
            btn.className = 'sett-mv-back';
            btn.textContent = '← Back';
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              sec.classList.remove('sett-mv-open');
              mvEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            sec.insertAdjacentElement('afterbegin', btn);
          }
          sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }
  }

  // Reset mobile open state on every open
  document.querySelectorAll('.sett-section.sett-mv-open').forEach(s => s.classList.remove('sett-mv-open'));

  // Update all live hints
  updateLiveHints();

  overlay.classList.add('show');
}

// ── close ─────────────────────────────────────────────────────────────
function closeSettings() {
  document.getElementById('modal-settings')?.classList.remove('show');
  // collapse any open mobile sections
  document.querySelectorAll('.sett-section.sett-mv-open').forEach(s => s.classList.remove('sett-mv-open'));
}

// ── save ──────────────────────────────────────────────────────────────
function saveSettings() {
  const v = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? (parseFloat(el.value) || fallback) : fallback;
  };
  const vi = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? (parseInt(el.value) || fallback) : fallback;
  };
  const vi0 = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const n = parseInt(el.value, 10);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  };
  const vc = (id) => {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  };

  // Regime risk — read and store as percentage (e.g. 0.50 for 0.5%)
  const riskOn      = v('set-risk-on-r',      DEFAULT_SETTINGS.riskOn);
  const riskNeutral = v('set-risk-neutral-r', DEFAULT_SETTINGS.riskNeutral);
  const riskOff     = v('set-risk-off-r',     DEFAULT_SETTINGS.riskOff);

  if (riskNeutral > riskOn || riskOff > riskOn) {
    if (typeof window.toast === 'function') window.toast('Risk-On must be the highest risk tier (or equal).', true);
    return;
  }
  if (riskOff > riskNeutral) {
    if (typeof window.toast === 'function') window.toast('Risk-Off cannot be higher than Neutral risk.', true);
    return;
  }

  const newSettings = {
    ...state.settings,
    account:                  v('set-account',      DEFAULT_SETTINGS.account),
    riskOn,
    riskNeutral,
    riskOff,
    maxPositions:             vi('set-max-positions', DEFAULT_SETTINGS.maxPositions),
    stopPct:                  v('set-stop-pct',      DEFAULT_SETTINGS.stopPct),
    targetRMultiple:          v('set-target-r',      DEFAULT_SETTINGS.targetRMultiple),
    minDaysToEarnings:        vi0('set-min-earnings-days', DEFAULT_SETTINGS.minDaysToEarnings),
  };
  delete newSettings.maxPremiumPct;
  delete newSettings.maxRiskPct;

  state.settings = newSettings;
  saveState();
  closeSettings();

  // Re-render everything that depends on settings
  if (typeof window.renderHome === 'function')          window.renderHome();
  if (typeof window.renderRegime === 'function')        window.renderRegime();
  if (typeof window.renderPretradeCheck === 'function') window.renderPretradeCheck();
  if (typeof window.renderLogStats === 'function')      window.renderLogStats();
  if (typeof window.renderReference === 'function')     window.renderReference();
  if (typeof window.renderTrade === 'function')         window.renderTrade();
  window.toast('Settings saved');
}

// ── reset ─────────────────────────────────────────────────────────────
function resetSettingsToDefaults() {
  if (!confirm('Reset all settings to defaults?')) return;
  state.settings = { ...DEFAULT_SETTINGS };
  openSettings();
  window.toast('Defaults loaded — click Save to apply');
}

// ── clear all ──────────────────────────────────────────────────────────
function clearAllTradesAndData() {
  const tradeCount = (state.trades || []).length;
  const ok = confirm(
    `Clear all trades and cockpit data?\n\n` +
    `This deletes ${tradeCount} trade${tradeCount === 1 ? '' : 's'}, sector ratings, Sunday/session progress, and current analysis inputs. Settings are preserved.\n\n` +
    `This cannot be undone.`
  );
  if (!ok) return;

  const deletedAt = new Date().toISOString();
  const deletedTradeIds = { ...(state.deletedTradeIds || {}) };
  (state.trades || []).forEach(t => {
    if (t && t.id) deletedTradeIds[t.id] = deletedAt;
  });

  // Build fresh defaults, then preserve the user-configured settings and the
  // tombstone log of deleted trade ids (so cloud sync won't resurrect them).
  const settings = { ...state.settings };
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, createDefaultState(), {
    settings,
    deletedTradeIds,
    marketContextUpdatedAt: deletedAt,
  });

  ['ivr-input','premium-input','atr-input','underlying-price-input','ticker-input','sa-quant-input','days-to-earnings-input']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['i-ticker','i-entry','i-stop','i-target','i-contracts','i-spread','i-vwap-rel','i-notes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  const directionInput = document.getElementById('direction-input');
  if (directionInput) directionInput.value = 'long';
  const logFilter = document.getElementById('log-mode-filter');
  if (logFilter) logFilter.value = 'all';

  saveState();
  closeSettings();
  if (typeof window.closeContextPanel === 'function') window.closeContextPanel();
  window.setTab('home');
  if (typeof window.renderHome === 'function')          window.renderHome();
  if (typeof window.renderRegime === 'function')        window.renderRegime();
  if (typeof window.renderPretradeCheck === 'function') window.renderPretradeCheck();
  if (typeof window.renderLogStats === 'function')      window.renderLogStats();
  if (typeof window.renderLogTable === 'function')      window.renderLogTable();
  if (typeof window.renderContextPanel === 'function')  window.renderContextPanel();
  window.toast('All trades and cockpit data cleared');
}

window.openSettings          = openSettings;
window.closeSettings         = closeSettings;
window.saveSettings          = saveSettings;
window.resetSettingsToDefaults = resetSettingsToDefaults;
window.clearAllTradesAndData   = clearAllTradesAndData;
