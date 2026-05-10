// Settings — full-page overlay open/close/save.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { DEFAULT_SETTINGS, newIntradayTicket } from '../config/constants.js';
import { calcPL, isClosedTrade } from '../models/trade.js';

// ── helpers ──────────────────────────────────────────────────────────
function fmt$(n) { return '$' + Math.abs(Math.round(n)).toLocaleString(); }

function updateLiveHints() {
  const acct  = parseFloat(document.getElementById('set-account')?.value) || 50000;
  // read from regime slider first, fall back to account-section base risk input
  const rOn   = parseFloat(document.getElementById('set-risk-on-r')?.value)
             || parseFloat(document.getElementById('set-risk-on')?.value)
             || 0.5;
  const prem  = parseFloat(document.getElementById('set-max-premium')?.value) || 12;
  const risk  = parseFloat(document.getElementById('set-max-risk')?.value) || 6;
  const kill  = parseFloat(document.getElementById('set-kill-floor')?.value) || 7;
  const dml   = parseFloat(document.getElementById('set-daily-loss-pct')?.value) || 2;

  const el = (id) => document.getElementById(id);
  if (el('sett-live-equity'))      el('sett-live-equity').textContent      = '$' + acct.toLocaleString();
  if (el('sett-live-base1r'))      el('sett-live-base1r').textContent      = fmt$(acct * rOn / 100);
  if (el('sett-live-base1r-sub'))  el('sett-live-base1r-sub').textContent  = `${rOn.toFixed(2)}% of equity`;
  if (el('sett-live-cap'))         el('sett-live-cap').textContent         = fmt$(acct * prem / 100);
  if (el('sett-live-cap-sub'))     el('sett-live-cap-sub').textContent     = `of ${fmt$(acct)} · ${prem}%`;
  if (el('sett-live-kill'))        el('sett-live-kill').textContent        = `-${kill.toFixed(1)}%`;
  if (el('sett-hint-base1r'))      el('sett-hint-base1r').textContent      = `= ${fmt$(acct * rOn / 100)} · 1R`;

  // Regime equiv labels
  const rNeu = parseFloat(document.getElementById('set-risk-neutral-r')?.value) || 0.25;
  const rOff = parseFloat(document.getElementById('set-risk-off-r')?.value) || 0.15;
  if (el('sett-eqv-on'))      el('sett-eqv-on').textContent      = `= ${fmt$(acct * rOn / 100)}`;
  if (el('sett-eqv-neutral')) el('sett-eqv-neutral').textContent = `= ${fmt$(acct * rNeu / 100)}`;
  if (el('sett-eqv-off'))     el('sett-eqv-off').textContent     = `= ${fmt$(acct * rOff / 100)}`;

  // Cap dollar labels (header tags + inline box-right)
  const premCap = Math.round(acct * prem / 100).toLocaleString();
  const riskCap = Math.round(acct * risk / 100).toLocaleString();
  ['sett-live-premium-cap','sett-live-premium-cap-b'].forEach(id => { if (el(id)) el(id).textContent = premCap; });
  ['sett-live-risk-cap','sett-live-risk-cap-b'].forEach(id => { if (el(id)) el(id).textContent = riskCap; });

  // Kill equiv (remove the duplicate - now done in syncSlider call above)

  // Slider fill
  syncSlider('sett-sl-on',      rOn,   0.1, 2,   'on');
  syncSlider('sett-sl-neutral', rNeu,  0.1, 2,   'neutral');
  syncSlider('sett-sl-off',     rOff,  0.1, 2,   'off');
  syncSlider('sett-sl-pos',     parseFloat(document.getElementById('set-max-positions')?.value)||4, 1, 20, 'cap');
  syncSlider('sett-sl-prem',    prem,  5,  100,  'cap');
  syncSlider('sett-sl-risk',    risk,  1,   50,  'cap');
  syncSlider('sett-sl-kill',    kill,  1,   30,  'kill');
  // Live kill equiv label
  if (el('sett-kill-eqv'))    el('sett-kill-eqv').textContent    = `= -${fmt$(acct * kill / 100)} on ${fmt$(acct)}`;
  if (el('sett-kill-daily-sub')) el('sett-kill-daily-sub').textContent = `= -${fmt$(acct * dml / 100)}`;
  // Kill preview chart
  drawKillPreview();
  // Mobile list view values
  updateMobileView(acct, rOn, kill);
}

function updateMobileView(acct, rOn, kill) {
  const el = (id) => document.getElementById(id);
  if (!el('sett-mv')) return;
  const a = acct || parseFloat(el('set-account')?.value) || 50000;
  const r = rOn  || parseFloat(el('set-risk-on-r')?.value) || parseFloat(el('set-risk-on')?.value) || 0.5;
  const k = kill || parseFloat(el('set-kill-floor')?.value) || 7;
  const rNeu = parseFloat(el('set-risk-neutral-r')?.value) || 0.25;
  const rOff = parseFloat(el('set-risk-off-r')?.value) || 0.15;
  const maxPos  = parseInt(el('set-max-positions')?.value) || 4;
  const maxPrem = parseFloat(el('set-max-premium')?.value) || 12;
  const maxRisk = parseFloat(el('set-max-risk')?.value) || 6;
  const maxPosTgt = parseInt(el('set-target-pct')?.value) || 4;
  const iRisk = parseFloat(el('set-i-risk')?.value) || 125;
  const f$ = (n) => '$' + Math.abs(Math.round(n)).toLocaleString();

  const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  set('smv-equity', '$' + a.toLocaleString());
  set('smv-1r',     f$(a * r / 100));
  set('smv-s01',    '$' + a.toLocaleString());
  set('smv-s-rOn',  r.toFixed(2) + '%');
  set('smv-s-rNeu', rNeu.toFixed(2) + '%');
  set('smv-s-rOff', rOff.toFixed(2) + '%');
  set('smv-s-caps', `${maxPos} · ${maxPrem}% · ${maxRisk}%`);
  set('smv-s-kill', `-${k.toFixed(1)}% · 14d`);
  set('smv-s-swing', `${r.toFixed(2)}% · ${maxPosTgt} max`);
  set('smv-s-intra', `${f$(iRisk)} · 15:55 ET`);
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

function drawKillPreview() {
  const canvas = document.getElementById('sett-kill-preview');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const account = parseFloat(document.getElementById('set-account')?.value) || 50000;
  const floor   = parseFloat(document.getElementById('set-kill-floor')?.value) || 7.0;
  const floorPct = -floor;

  // Build cumulative P&L over last 14 days, one data point per day
  const DAYS = 14;
  const now = Date.now();
  const cutoff = now - DAYS * 24 * 60 * 60 * 1000;
  const trades = (state.trades || []).filter(t => isClosedTrade(t) && (t.exit_date || t.date));

  const dailyPL = {};
  trades.forEach(t => {
    const dateStr = (t.exit_date || t.date || '').slice(0, 10);
    const ts = new Date(dateStr).getTime();
    if (ts >= cutoff && ts <= now) {
      dailyPL[dateStr] = (dailyPL[dateStr] || 0) + (calcPL(t) || 0);
    }
  });

  const points = [];
  let cum = 0;
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    cum += dailyPL[dateStr] || 0;
    points.push((cum / account) * 100);
  }

  const currentPct = points[points.length - 1];
  const isFloored  = currentPct <= floorPct;

  // Update labels
  const stateEl    = document.getElementById('sett-kill-state');
  const stateSubEl = document.getElementById('sett-kill-state-sub');
  const nowPctEl   = document.getElementById('sett-kill-now-pct');
  const nowSubEl   = document.getElementById('sett-kill-now-sub');
  if (stateEl) {
    stateEl.textContent = isFloored ? 'FLOORED' : 'CLEARED';
    stateEl.style.color = isFloored ? '#f87171' : '#34d399';
  }
  if (stateSubEl) stateSubEl.textContent = isFloored ? 'trading stopped' : 'trading allowed';
  if (nowPctEl) {
    nowPctEl.textContent = (currentPct >= 0 ? '+' : '') + currentPct.toFixed(1) + '%';
    nowPctEl.style.color = isFloored ? '#f87171' : '#f59e0b';
  }
  if (nowSubEl) {
    const distToFloor = (currentPct - floorPct).toFixed(1);
    nowSubEl.textContent = isFloored ? 'floor breached' : `${distToFloor}pt to floor`;
  }

  // Draw — canvas is 2× resolution (560×240) rendered at CSS 100%×120px
  ctx.clearRect(0, 0, W, H);
  const S = 2; // scale factor
  const pad = { t: 12 * S, r: 14 * S, b: 14 * S, l: 14 * S };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;

  const minVal = Math.min(floorPct - 1.5, ...points);
  const maxVal = Math.max(2, ...points);
  const range  = maxVal - minVal || 1;

  const xOf = (i) => pad.l + (points.length > 1 ? (i / (points.length - 1)) : 0.5) * cW;
  const yOf = (v) => pad.t + (1 - (v - minVal) / range) * cH;

  // Floor dashed line
  const floorY = yOf(floorPct);
  ctx.save();
  ctx.strokeStyle = 'rgba(248,113,113,0.55)';
  ctx.lineWidth = S;
  ctx.setLineDash([5 * S, 6 * S]);
  ctx.beginPath();
  ctx.moveTo(pad.l, floorY);
  ctx.lineTo(W - pad.r, floorY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // "FLOOR" label
  ctx.save();
  ctx.font = `bold ${7 * S}px "JetBrains Mono", monospace`;
  ctx.fillStyle = 'rgba(248,113,113,0.65)';
  ctx.textAlign = 'right';
  ctx.fillText('FLOOR', W - pad.r - S, floorY - 3 * S);
  ctx.restore();

  // Filled area under P&L line
  const lineColor = isFloored ? '#f87171' : '#f59e0b';
  const fillTop   = isFloored ? 'rgba(248,113,113,0.18)' : 'rgba(245,158,11,0.18)';
  ctx.save();
  ctx.beginPath();
  points.forEach((v, i) => {
    const x = xOf(i), y = yOf(v);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(xOf(points.length - 1), H - pad.b);
  ctx.lineTo(xOf(0), H - pad.b);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
  grad.addColorStop(0, fillTop);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // P&L line
  ctx.save();
  ctx.beginPath();
  points.forEach((v, i) => {
    const x = xOf(i), y = yOf(v);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5 * S;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  // Dot at today
  const dotX = xOf(points.length - 1);
  const dotY = yOf(currentPct);
  ctx.save();
  ctx.beginPath();
  ctx.arc(dotX, dotY, 3 * S, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.shadowColor = lineColor;
  ctx.shadowBlur = 6 * S;
  ctx.fill();
  ctx.restore();
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
  // Regime risk — all three inputs (slider, regime -r input, account base-risk) kept in sync
  const rOn  = s.riskOn      || DEFAULT_SETTINGS.riskOn;
  const rNeu = s.riskNeutral || DEFAULT_SETTINGS.riskNeutral;
  const rOff = s.riskOff     || DEFAULT_SETTINGS.riskOff;
  if (el('set-risk-on-r'))      el('set-risk-on-r').value      = rOn;
  if (el('set-risk-neutral-r')) el('set-risk-neutral-r').value = rNeu;
  if (el('set-risk-off-r'))     el('set-risk-off-r').value     = rOff;
  if (el('set-risk-on'))        el('set-risk-on').value        = rOn;   // account base risk field
  if (el('set-risk-neutral'))   el('set-risk-neutral').value   = rNeu;
  if (el('set-risk-off'))       el('set-risk-off').value       = rOff;

  if (el('set-stop-pct'))       el('set-stop-pct').value       = s.stopPct        || DEFAULT_SETTINGS.stopPct;
  if (el('set-target-pct'))     el('set-target-pct').value     = s.targetPct      || DEFAULT_SETTINGS.targetPct;
  if (el('set-max-positions'))  el('set-max-positions').value  = s.maxPositions   || DEFAULT_SETTINGS.maxPositions;
  if (el('set-max-premium'))    el('set-max-premium').value    = s.maxPremiumPct  || DEFAULT_SETTINGS.maxPremiumPct;
  if (el('set-max-risk'))       el('set-max-risk').value       = s.maxRiskPct     || DEFAULT_SETTINGS.maxRiskPct;
  if (el('set-long-only'))      el('set-long-only').checked    = s.longOnlyMode   || false;
  if (el('set-i-risk'))         el('set-i-risk').value         = s.intradayRiskPerTrade    || DEFAULT_SETTINGS.intradayRiskPerTrade;
  if (el('set-i-max-loss'))     el('set-i-max-loss').value     = s.intradayMaxDailyLoss    || DEFAULT_SETTINGS.intradayMaxDailyLoss;
  if (el('set-i-max-spread'))   el('set-i-max-spread').value   = s.intradayMaxSpreadPct    || DEFAULT_SETTINGS.intradayMaxSpreadPct;
  if (el('set-i-delta'))         el('set-i-delta').checked      = true; // loss-day stop on by default
  if (el('set-kill-floor'))      el('set-kill-floor').value     = s.killSwitchFloor   || DEFAULT_SETTINGS.killSwitchFloor   || 7.0;
  if (el('set-daily-loss-pct'))  el('set-daily-loss-pct').value = s.dailyMaxLossPct   || DEFAULT_SETTINGS.dailyMaxLossPct   || 2.0;
  // no-op: set-killswitch-days input was removed from HTML

  // Wire sliders (only first time — guard with dataset flag)
  const overlay = document.getElementById('modal-settings');
  if (!overlay.dataset.wired) {
    overlay.dataset.wired = '1';
    wireSliderInput('sett-sl-on',      'set-risk-on-r',      0.1, 2,   'on',      'set-risk-on');
    wireSliderInput('sett-sl-neutral', 'set-risk-neutral-r', 0.1, 2,   'neutral', 'set-risk-neutral');
    wireSliderInput('sett-sl-off',     'set-risk-off-r',     0.1, 2,   'off',     'set-risk-off');
    wireSliderInput('sett-sl-pos',     'set-max-positions',  1,   20,  'cap');
    wireSliderInput('sett-sl-prem',    'set-max-premium',    5,   100, 'cap');
    wireSliderInput('sett-sl-risk',    'set-max-risk',       1,   50,  'cap');
    wireSliderInput('sett-sl-kill',    'set-kill-floor',     1,   30,  'kill');

    // account input triggers all hints
    const acctEl = el('set-account');
    if (acctEl) acctEl.addEventListener('input', updateLiveHints);

    // Wire account-section base-risk input (set-risk-on) → regime slider + hints
    const acctRiskEl = el('set-risk-on');
    if (acctRiskEl) {
      acctRiskEl.addEventListener('input', () => {
        const val = parseFloat(acctRiskEl.value) || 0;
        const rOnR = el('set-risk-on-r');
        const slOn = el('sett-sl-on');
        if (rOnR) rOnR.value = val;
        if (slOn) { slOn.value = val; syncSlider('sett-sl-on', val, 0.1, 2, 'on'); }
        updateLiveHints();
      });
    }

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

    // Long-only toggle label
    const loCheck = el('set-long-only');
    const loLbl   = el('sett-long-only-lbl');
    if (loCheck && loLbl) {
      loCheck.addEventListener('change', () => {
        loLbl.textContent = loCheck.checked ? 'ON' : 'OFF';
        loLbl.className = 'sett-toggle-lbl-sm ' + (loCheck.checked ? 'sett-lbl-on' : '');
      });
    }

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
  const vc = (id) => {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  };

  // Regime risk — read from new -r inputs (which stay synced with old IDs via wireSliderInput)
  const riskOn      = v('set-risk-on-r',      null) || v('set-risk-on',      DEFAULT_SETTINGS.riskOn);
  const riskNeutral = v('set-risk-neutral-r', null) || v('set-risk-neutral', DEFAULT_SETTINGS.riskNeutral);
  const riskOff     = v('set-risk-off-r',     null) || v('set-risk-off',     DEFAULT_SETTINGS.riskOff);

  const newSettings = {
    account:                  v('set-account',      DEFAULT_SETTINGS.account),
    riskOn,
    riskNeutral,
    riskOff,
    stopPct:                  v('set-stop-pct',     DEFAULT_SETTINGS.stopPct),
    targetPct:                v('set-target-pct',   DEFAULT_SETTINGS.targetPct),
    maxPositions:             vi('set-max-positions', DEFAULT_SETTINGS.maxPositions),
    maxPremiumPct:            v('set-max-premium',  DEFAULT_SETTINGS.maxPremiumPct),
    maxRiskPct:               v('set-max-risk',     DEFAULT_SETTINGS.maxRiskPct),
    longOnlyMode:             vc('set-long-only'),
    intradayRiskPerTrade:     v('set-i-risk',        DEFAULT_SETTINGS.intradayRiskPerTrade),
    // set-i-max-loss has no visible input — preserve the existing saved value to avoid overwrite
    intradayMaxDailyLoss:     v('set-i-max-loss',    state.settings?.intradayMaxDailyLoss ?? DEFAULT_SETTINGS.intradayMaxDailyLoss),
    intradayMaxSpreadPct:     v('set-i-max-spread',  DEFAULT_SETTINGS.intradayMaxSpreadPct),
    intradayDefaultDelta:     v('set-i-delta',       DEFAULT_SETTINGS.intradayDefaultDelta),
    killSwitchDays:           state.settings?.killSwitchDays ?? DEFAULT_SETTINGS.killSwitchDays,
    killSwitchFloor:          v('set-kill-floor',    DEFAULT_SETTINGS.killSwitchFloor   || 7.0),
    dailyMaxLossPct:          v('set-daily-loss-pct', DEFAULT_SETTINGS.dailyMaxLossPct  || 2.0),
  };

  state.settings = newSettings;
  saveState();
  closeSettings();

  // Re-render everything that depends on settings
  if (typeof window.renderHome === 'function')          window.renderHome();
  if (typeof window.renderRegime === 'function')        window.renderRegime();
  if (typeof window.renderPretradeCheck === 'function') window.renderPretradeCheck();
  if (typeof window.renderLogStats === 'function')      window.renderLogStats();
  if (typeof renderReference === 'function')            renderReference();
  if (typeof window.renderTrade === 'function')         window.renderTrade();
  window.toast('Settings saved');
}

// ── reset ─────────────────────────────────────────────────────────────
function resetSettingsToDefaults() {
  if (!confirm('Reset all settings to v3 defaults?')) return;
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

  const settings = { ...state.settings };
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, {
    settings,
    regime: 'risk-on',
    activeMode: 'home',
    homeFilterDate: null,
    trades: [],
    deletedTradeIds,
    selectedSetup: null,
    instrument: 'options',
    ivr: null,
    direction: 'long',
    premium: null,
    atr: null,
    underlyingPrice: null,
    ticker: null,
    saQuant: null,
    daysToEarnings: null,
    gateChecks: {},
    pretradeChecks: { vix: true, news: true },
    sundayChecks: {},
    sectorNotes: '',
    sectorRatings: {},
    sectorRatedAt: null,
    marketContextUpdatedAt: deletedAt,
    liquidity: { stockVol: null, optionOI: null, optionVol: null, bid: null, ask: null, spreadPct: null },
    intraday: newIntradayTicket(),
    intradayQuality: { timeOverride: false },
    logModeFilter: 'all',
    logSearch: '',
    logSetupFilter: '',
    homePortfolioView: 'recent',
    tradeFlow: { mode: 'swing', step: 1, thesis: '', preMortem: '', moonshotR: 3 },
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
  if (typeof window.renderSectors === 'function')       window.renderSectors();
  if (typeof window.renderSectorStatusMini === 'function') window.renderSectorStatusMini();
  window.toast('All trades and cockpit data cleared');
}

window.openSettings          = openSettings;
window.closeSettings         = closeSettings;
window.saveSettings          = saveSettings;
window.resetSettingsToDefaults = resetSettingsToDefaults;
window.clearAllTradesAndData   = clearAllTradesAndData;
