// Position Editor modal — manages multi-leg execution log + journal entries.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import {
  tradeBias,
  tradeInstrument,
  tradeMultiplier,
  tradeQty,
  calcPL,
  tradeRiskDollars,
} from '../models/trade.js';
import { _fmtMoney, _fmtMoneyPlain, _toneClass } from '../models/formatters.js';
import { attr, esc } from '../dom/html.js';

const POS = {
  id: null,
  trade: null,
  mark: null,
  executions: [],
  tags: [],
  notes: '',
  playbookImage: null,
};

function _posMultiplier(t) { return tradeMultiplier(t); }

// tradeBias → src/models/trade.js

function _posSign(t) {
  // Only short stock requires sign flip — long calls and long puts both use +1.
  if (t.instrument === 'stocks' && tradeBias(t) === 'bearish') return -1;
  return 1;
}

function _posSideLabel(t) {
  const bias = tradeBias(t);
  if (t.instrument === 'stocks') return bias === 'bearish' ? 'SHORT STOCK' : 'LONG STOCK';
  return bias === 'bearish' ? 'LONG PUT' : 'LONG CALL';
}

function _posQtyUnit(t) {
  return tradeInstrument(t) === 'stocks' ? 'Shares' : 'Contracts';
}

// tradeQty → src/models/trade.js

function _posRealizedPL(t, executions) {
  const mult = _posMultiplier(t);
  const sign = _posSign(t);
  return executions.reduce((s, e) => s + sign * (Number(e.price) - Number(t.entry)) * mult * Number(e.qty || 0), 0);
}

function _posOpenQty(t, executions) {
  const total = tradeQty(t);
  const closed = executions.reduce((s, e) => s + (Number(e.qty) || 0), 0);
  return Math.max(0, total - closed);
}

function _posUnrealizedPL(t, executions, mark) {
  if (mark === null || isNaN(mark)) return 0;
  const open = _posOpenQty(t, executions);
  if (!open) return 0;
  const mult = _posMultiplier(t);
  const sign = _posSign(t);
  return sign * (Number(mark) - Number(t.entry)) * mult * open;
}

// _fmtMoney, _fmtMoneyPlain, _toneClass → src/models/formatters.js

function _posSetupLabel(t) {
  const raw = t.setup || 'No setup';
  if (typeof window.tfFindIntradaySetup === 'function') {
    const def = window.tfFindIntradaySetup(raw);
    if (def && def.name) return def.name;
  }
  return raw;
}

function _fmtR(value) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function _rMultiple(value, risk) {
  return risk > 0 ? value / risk : null;
}

function _clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function _levelPL(t, price) {
  const entry = Number(t.entry);
  const level = Number(price);
  const qty = tradeQty(t);
  if (!Number.isFinite(entry) || !Number.isFinite(level) || entry <= 0 || level <= 0 || qty <= 0) return null;
  // Swing option records can store an underlying stop; don't compare that to premium entry.
  if (tradeInstrument(t) === 'options' && level > entry * 4) return null;
  return _posSign(t) * (level - entry) * _posMultiplier(t) * qty;
}

function _fallbackTargetPL(riskUnit) {
  const settings = state.settings || {};
  const targetPct = Number(settings.targetPct) || 50;
  const stopPct = Number(settings.stopPct) || 50;
  return riskUnit > 0 ? riskUnit * (targetPct / Math.max(1, stopPct)) : 0;
}

function _rTitle(label, dollars, r) {
  const rText = _fmtR(r);
  const dollarText = _fmtMoney(dollars || 0);
  return `${label}: ${rText} (${dollarText})`;
}

function _updateQtyInputForTrade(t) {
  const qtyEl = document.getElementById('pos-exit-qty');
  const unit = _posQtyUnit(t);
  const lower = unit.toLowerCase();
  qtyEl.placeholder = `${unit} to sell`;
  qtyEl.setAttribute('aria-label', `Exit ${lower}`);
  document.getElementById('pos-open-qty-unit').textContent = unit;
}

function _setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function _readModelNumber(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const n = parseFloat(el.value);
  return Number.isFinite(n) ? n : null;
}

function _refreshPositionHeader(t) {
  document.getElementById('pos-ticker').textContent = (t.ticker || '—').toUpperCase();
  const sideEl = document.getElementById('pos-side-badge');
  sideEl.textContent = _posSideLabel(t);
  const isBearish = tradeBias(t) === 'bearish';
  sideEl.classList.toggle('long', !isBearish);
  sideEl.classList.toggle('short', isBearish);
  document.getElementById('pos-entry').textContent = _fmtMoneyPlain(t.entry);
  document.getElementById('pos-qty-total').textContent = tradeQty(t);
  document.getElementById('pos-qty-unit').textContent = _posQtyUnit(t);
  document.getElementById('pos-setup').textContent = _posSetupLabel(t);
  _updateQtyInputForTrade(t);
}

function _populateTradeModel(t) {
  _setInputValue('pos-model-ticker', (t.ticker || '').toUpperCase());
  _setInputValue('pos-model-setup', t.setup || '');
  _setInputValue('pos-model-instrument', tradeInstrument(t));
  _setInputValue('pos-model-direction', tradeBias(t) === 'bearish' ? 'Short' : 'Long');
  _setInputValue('pos-model-entry', t.entry ?? '');
  _setInputValue('pos-model-qty', tradeQty(t) || '');
  _setInputValue('pos-model-stop', t.stop ?? '');
  _setInputValue('pos-model-target', t.target ?? '');
  _setInputValue('pos-model-risk', t.riskDollars ?? '');
  _setInputValue('pos-model-sa', t.saQuant ?? '');
}

function _applyTradeModelInputs(t) {
  const ticker = (document.getElementById('pos-model-ticker')?.value || '').trim().toUpperCase();
  const setup = (document.getElementById('pos-model-setup')?.value || '').trim();
  const instrument = document.getElementById('pos-model-instrument')?.value === 'stocks' ? 'stocks' : 'options';
  const direction = document.getElementById('pos-model-direction')?.value === 'Short' ? 'Short' : 'Long';
  const qty = Math.max(0, parseInt(document.getElementById('pos-model-qty')?.value || '', 10) || 0);
  const entry = _readModelNumber('pos-model-entry');
  const stop = _readModelNumber('pos-model-stop');
  const target = _readModelNumber('pos-model-target');
  const risk = _readModelNumber('pos-model-risk');
  const saQuant = _readModelNumber('pos-model-sa');

  if (ticker) t.ticker = ticker;
  t.setup = setup || t.setup || '';
  t.instrument = instrument;
  t.direction = direction;
  t.bias = direction === 'Short' ? 'bearish' : 'bullish';
  if (entry && entry > 0) t.entry = entry;
  if (instrument === 'stocks') {
    t.shares = qty || t.shares || t.contracts || 0;
    t.contracts = null;
  } else {
    t.contracts = qty || t.contracts || t.shares || 0;
    t.shares = null;
  }
  t.qty = null;
  t.stop = stop && stop > 0 ? stop : null;
  t.target = target && target > 0 ? target : null;
  t.riskDollars = risk && risk > 0 ? risk : tradeRiskDollars(t);
  t.saQuant = saQuant && saQuant >= 1 && saQuant <= 5 ? saQuant : null;
  return t;
}

function _previewTradeModel() {
  if (!POS.trade) return;
  POS.trade = _applyTradeModelInputs({ ...POS.trade });
  _refreshPositionHeader(POS.trade);
  renderPositionEditor();
}

function _renderRiskProfile({ trade, realized, unrealized, total }) {
  const el = document.getElementById('pos-risk-profile');
  if (!el) return;
  const risk = tradeRiskDollars(trade);
  const setup = _posSetupLabel(trade);
  const stopFromLevel = _levelPL(trade, trade.stop);
  const stopDollars = stopFromLevel !== null ? -Math.abs(stopFromLevel) : -Math.abs(risk);
  const riskUnit = Math.abs(stopDollars) || risk || 0;
  const targetFromLevel = _levelPL(trade, trade.target);
  const targetDollars = targetFromLevel !== null ? targetFromLevel : _fallbackTargetPL(riskUnit);
  const stopR = _rMultiple(stopDollars, riskUnit);
  const targetR = _rMultiple(targetDollars, riskUnit);
  const totalR = _rMultiple(total, riskUnit);
  const realizedR = _rMultiple(realized, riskUnit);
  const openR = _rMultiple(unrealized, riskUnit);
  const minR = Math.min(stopR ?? -1, totalR ?? 0, 0);
  const maxR = Math.max(targetR ?? 1, totalR ?? 0, 0);
  const spanR = Math.max(0.01, maxR - minR);
  const zeroLeft = ((0 - minR) / spanR) * 100;
  const markerR = totalR === null ? 0 : _clamp(totalR, minR, maxR);
  const markerLeft = ((markerR - minR) / spanR) * 100;
  const markerTone = total > 0 ? 'pos' : total < 0 ? 'neg' : 'zero';
  const stopLabel = trade.stop ? _fmtMoneyPlain(trade.stop) : 'Risk stop';
  const targetLabel = trade.target ? _fmtMoneyPlain(trade.target) : 'Plan target';

  el.innerHTML = `
    <div class="pos-risk-head">
      <span>Setup <strong>${esc(setup)}</strong></span>
      <span title="${attr(_rTitle('1R risk', riskUnit, 1))}">1R <strong>${riskUnit > 0 ? _fmtMoneyPlain(riskUnit) : '—'}</strong></span>
    </div>
    <div class="pos-risk-bar" aria-label="Risk profile from stop to target">
      <span class="pos-risk-loss" style="width:${zeroLeft}%"></span>
      <span class="pos-risk-gain" style="left:${zeroLeft}%;"></span>
      <span class="pos-risk-zero" style="left:${zeroLeft}%"></span>
      <span class="pos-risk-marker ${markerTone}" style="left:${markerLeft}%"></span>
    </div>
    <div class="pos-risk-scale">
      <span title="${attr(_rTitle('Stop', stopDollars, stopR))}">Stop <strong>${esc(stopLabel)}</strong> · ${_fmtR(stopR)}</span>
      <span title="${attr(_rTitle('Entry', 0, 0))}">Entry · 0R</span>
      <span title="${attr(_rTitle('Target', targetDollars, targetR))}">Target <strong>${esc(targetLabel)}</strong> · ${_fmtR(targetR)}</span>
    </div>
    <div class="pos-risk-chips">
      <span title="${attr(_rTitle('Realized', realized, realizedR))}">Realized <strong>${_fmtMoney(realized)} · ${_fmtR(realizedR)}</strong></span>
      <span title="${attr(_rTitle('Open', unrealized, openR))}">Open <strong>${_fmtMoney(unrealized)} · ${_fmtR(openR)}</strong></span>
      <span title="${attr(_rTitle('Total', total, totalR))}">Total <strong>${_fmtMoney(total)} · ${_fmtR(totalR)}</strong></span>
    </div>
  `;
}

function openPositionEditor(trade, tab = 'exec') {
  POS.id = trade.id;
  POS.trade = { ...trade };
  trade = POS.trade;
  // Hydrate executions from trade — back-compat: synth a single execution from t.exit if present
  if (Array.isArray(trade.executions) && trade.executions.length) {
    POS.executions = trade.executions.map(e => ({ ...e }));
  } else if (trade.status !== 'open' && trade.exit) {
    POS.executions = [{
      id: 'e_' + Math.random().toString(36).slice(2, 8),
      time: trade.exit_date ? new Date(trade.exit_date).toISOString() : new Date().toISOString(),
      type: trade.exit_reason === 'target' ? 'target_hit' :
            trade.exit_reason === 'stop' ? 'stop_loss' : 'manual_close',
      qty: tradeQty(trade),
      price: Number(trade.exit) || 0,
    }];
  } else {
    POS.executions = [];
  }
  POS.mark = trade.mark != null ? Number(trade.mark) : (trade.exit ? Number(trade.exit) : null);
  POS.tags = Array.isArray(trade.outcome_tags) ? [...trade.outcome_tags] : _backfillTagsFromTrade(trade);
  POS.notes = trade.lesson || trade.notes || '';
  POS.playbookImage = trade.playbook_image || null;

  _refreshPositionHeader(trade);
  _populateTradeModel(trade);

  // Mark input
  const markInput = document.getElementById('pos-mark');
  markInput.value = POS.mark != null ? POS.mark : '';

  // Notes + tags + playbook image
  document.getElementById('pos-notes').value = POS.notes;
  document.querySelectorAll('#pos-tag-group .pos-tag').forEach(b => {
    b.classList.toggle('active', POS.tags.includes(b.dataset.tag));
  });
  _renderPlaybookImage();
  setPositionTab(tab);
  renderPositionEditor();

  document.getElementById('modal-position').classList.add('show');
}

function closePositionEditor() {
  document.getElementById('modal-position').classList.remove('show');
  POS.id = null;
  POS.trade = null;
}

function setPositionTab(tab) {
  document.querySelectorAll('#pos-tabs .pos-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.posTab === tab);
  });
  document.querySelectorAll('#modal-position [data-pos-pane]').forEach(p => {
    p.classList.toggle('active', p.dataset.posPane === tab);
  });
}

function renderPositionEditor() {
  if (!POS.trade) return;
  const t = POS.trade;
  const mark = POS.mark;
  const open = _posOpenQty(t, POS.executions);
  const realized = _posRealizedPL(t, POS.executions);
  const unrealized = _posUnrealizedPL(t, POS.executions, mark);
  const total = realized + unrealized;

  // Header total
  const totalEl = document.getElementById('pos-total-pnl');
  totalEl.textContent = _fmtMoney(total);
  totalEl.classList.remove('pos','neg','zero');
  totalEl.classList.add(_toneClass(total));

  // Position status
  document.getElementById('pos-open-qty').textContent = open;
  const unrealEl = document.getElementById('pos-unrealized');
  unrealEl.textContent = _fmtMoney(unrealized);
  unrealEl.classList.remove('pos','neg','zero');
  unrealEl.classList.add(_toneClass(unrealized));
  _renderRiskProfile({ trade: t, realized, unrealized, total });

  // Quick scale buttons (mark % off open qty)
  document.querySelectorAll('.pos-quick-btn').forEach(b => {
    b.disabled = open <= 0;
    b.style.opacity = open <= 0 ? 0.5 : 1;
  });
  document.getElementById('pos-execute-btn').disabled = open <= 0;

  // Render execution log
  _renderExecLog();
}

function _renderExecLog() {
  const t = POS.trade;
  if (!t) return;
  const wrap = document.getElementById('pos-exec-log-body');
  if (!POS.executions.length) {
    wrap.innerHTML = `<div class="pos-exec-empty">No exits yet. Use Quick Scale to log a partial or full exit.</div>`;
    return;
  }
  const sign = _posSign(t);
  const mult = _posMultiplier(t);
  const rows = POS.executions.map(e => {
    const pl = sign * (Number(e.price) - Number(t.entry)) * mult * Number(e.qty || 0);
    const time = e.time ? new Date(e.time) : new Date();
    const timeStr = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const typeLabel = TAG_LABELS[e.type] || 'Manual Close';
    return `<tr>
      <td>${timeStr}</td>
      <td><span class="pos-exec-type-pill">${typeLabel}</span></td>
      <td><strong>${e.qty}</strong></td>
      <td>${_fmtMoneyPlain(e.price)}</td>
      <td class="right pos-exec-pnl ${pl >= 0 ? 'pl-pos' : 'pl-neg'}">${_fmtMoney(pl)}</td>
      <td class="right"><button class="pos-exec-del-btn" data-exec-id="${e.id}" aria-label="Remove exit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button></td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table class="pos-exec-table">
    <thead><tr><th>Time</th><th>Type</th><th>Qty</th><th>Price</th><th class="right">PnL</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function _renderPlaybookImage() {
  const drop = document.getElementById('pos-playbook-drop');
  const btn = document.getElementById('pos-paste-img-btn');
  const label = document.getElementById('pos-paste-img-label');
  if (POS.playbookImage) {
    drop.classList.add('has-image');
    drop.innerHTML = `<img src="${POS.playbookImage}" alt="Playbook screenshot" />`;
    btn.classList.add('remove');
    btn.title = 'Remove image';
    btn.setAttribute('aria-label', 'Remove image');
    if (label) label.textContent = 'Remove';
  } else {
    drop.classList.remove('has-image');
    drop.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <div>Paste (Ctrl+V) Screenshot</div>`;
    btn.classList.remove('remove');
    btn.title = 'Paste image';
    btn.setAttribute('aria-label', 'Paste image');
    if (label) label.textContent = 'Paste';
  }
}

const TAG_LABELS = {
  target_hit: 'Target Hit',
  stop_loss: 'Stop Loss',
  breakeven: 'Breakeven',
  manual_close: 'Manual Close',
  premature_exit: 'Premature Exit',
  fomo_entry: 'FOMO Entry',
};

// Build outcome tags from existing trade fields when migrating older data.
function _backfillTagsFromTrade(t) {
  const tags = [];
  if (t.exit_reason === 'target') tags.push('target_hit');
  if (t.exit_reason === 'stop') tags.push('stop_loss');
  if (t.exit_reason === 'discretionary') tags.push('manual_close');
  if (t.emotion === 'fomo') tags.push('fomo_entry');
  if (t.grade === 'broken' && t.exit_reason !== 'stop') tags.push('premature_exit');
  return tags;
}

function _activeExecType() {
  // Map active outcome tags to execution-row type. Falls back to manual close.
  const priority = ['target_hit','stop_loss','breakeven','premature_exit','manual_close'];
  for (const p of priority) if (POS.tags.includes(p)) return p;
  return 'manual_close';
}

function _execScale(pct) {
  const open = _posOpenQty(POS.trade, POS.executions);
  const qty = Math.max(0, Math.floor(open * pct));
  document.getElementById('pos-exit-qty').value = qty || '';
  // Default the price to the mark if the price input is empty
  const priceEl = document.getElementById('pos-exit-price');
  if (!priceEl.value && POS.mark != null) priceEl.value = POS.mark;
}

function _execExit() {
  const t = POS.trade;
  if (!t) return;
  const qty = parseInt(document.getElementById('pos-exit-qty').value, 10);
  const price = parseFloat(document.getElementById('pos-exit-price').value);
  const open = _posOpenQty(t, POS.executions);
  if (!qty || qty <= 0) { window.toast('Enter exit qty', true); return; }
  if (qty > open) { window.toast(`Only ${open} ${_posQtyUnit(t).toLowerCase()} open`, true); return; }
  if (!price || price <= 0) { window.toast('Enter exit price', true); return; }
  POS.executions.push({
    id: 'e_' + Math.random().toString(36).slice(2, 8),
    time: new Date().toISOString(),
    type: _activeExecType(),
    qty,
    price,
  });
  document.getElementById('pos-exit-qty').value = '';
  document.getElementById('pos-exit-price').value = '';
  renderPositionEditor();
}

function _delExec(id) {
  POS.executions = POS.executions.filter(e => e.id !== id);
  renderPositionEditor();
}

function _toggleTag(tag) {
  const idx = POS.tags.indexOf(tag);
  if (idx >= 0) POS.tags.splice(idx, 1); else POS.tags.push(tag);
  document.querySelectorAll('#pos-tag-group .pos-tag').forEach(b => {
    b.classList.toggle('active', POS.tags.includes(b.dataset.tag));
  });
}

function _savePositionEditor() {
  const t = POS.trade;
  if (!t) return;
  const tradeIdx = state.trades.findIndex(x => x.id === t.id);
  if (tradeIdx < 0) { window.toast('Trade not found', true); return; }

  // Persist editor data back onto the trade.
  const updated = _applyTradeModelInputs({ ...state.trades[tradeIdx] });
  const closedQty = POS.executions.reduce((s, e) => s + (Number(e.qty) || 0), 0);
  if (tradeQty(updated) < closedQty) {
    window.toast(`Model quantity cannot be below ${closedQty} already exited.`, true);
    return;
  }
  updated.executions = POS.executions.slice();
  updated.outcome_tags = POS.tags.slice();
  updated.notes = document.getElementById('pos-notes').value;
  updated.lesson = updated.notes || updated.lesson || null;
  updated.mark = POS.mark;
  updated.playbook_image = POS.playbookImage || null;

  // Compute close state from executions.
  const open = _posOpenQty(updated, updated.executions);
  if (open === 0 && updated.executions.length) {
    const totalQty = updated.executions.reduce((s, e) => s + Number(e.qty), 0);
    const wAvgExit = updated.executions.reduce((s, e) => s + Number(e.price) * Number(e.qty), 0) / totalQty;
    updated.exit = Number(wAvgExit.toFixed(4));
    const realized = _posRealizedPL(updated, updated.executions);
    updated.status = realized >= 0 ? 'win' : 'loss';
    updated.exit_date = updated.exit_date || (updated.executions[updated.executions.length - 1].time || '').split('T')[0] || new Date().toISOString().split('T')[0];
  } else {
    updated.status = 'open';
    updated.exit = null;
  }
  // Map first relevant tag back into existing exit_reason field for back-compat with stats.
  if (POS.tags.includes('target_hit')) updated.exit_reason = 'target';
  else if (POS.tags.includes('stop_loss')) updated.exit_reason = 'stop';
  else if (POS.tags.includes('manual_close') || POS.tags.includes('breakeven')) updated.exit_reason = 'discretionary';
  else if (POS.tags.includes('premature_exit')) updated.exit_reason = 'thesis-broke';
  if (POS.tags.includes('fomo_entry')) updated.emotion = 'fomo';
  if (POS.tags.includes('premature_exit')) updated.grade = 'broken';
  updated.updated_at = new Date().toISOString();

  state.trades[tradeIdx] = updated;
  saveState();
  if (typeof doPush === 'function') {
    if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    window.doPush();
  }
  closePositionEditor();
  window.renderHome();
  window.renderLogStats();
  window.renderLogTable();
  if (typeof renderTrade === 'function') window.renderTrade();
  window.toast('Trade updated');
}

function _deletePositionEditor() {
  const t = POS.trade;
  if (!t) return;
  if (!confirm(`Delete this trade?\n\n${t.ticker} ${t.setup || ''} ${t.date || ''}\n\nThis cannot be undone.`)) return;
  if (!state.deletedTradeIds) state.deletedTradeIds = {};
  state.deletedTradeIds[t.id] = new Date().toISOString();
  state.trades = state.trades.filter(x => x.id !== t.id);
  saveState();
  if (typeof doPush === 'function') {
    if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
    window.doPush();
  }
  closePositionEditor();
  window.renderHome();
  window.renderLogStats();
  window.renderLogTable();
  if (typeof renderTrade === 'function') window.renderTrade();
  window.toast('Trade deleted');
}

function _wirePositionEditor() {
  const modal = document.getElementById('modal-position');
  if (!modal) return;
  // Backdrop close
  modal.addEventListener('click', e => { if (e.target === e.currentTarget) closePositionEditor(); });
  document.querySelectorAll('[data-close-position]').forEach(b => b.addEventListener('click', closePositionEditor));
  // Tabs
  document.querySelectorAll('#pos-tabs .pos-tab').forEach(b => b.addEventListener('click', () => setPositionTab(b.dataset.posTab)));
  // Mark price input
  document.getElementById('pos-mark').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    POS.mark = isNaN(v) ? null : v;
    renderPositionEditor();
  });
  document.querySelectorAll('#modal-position [id^="pos-model-"]').forEach(el => {
    el.addEventListener('input', _previewTradeModel);
    el.addEventListener('change', _previewTradeModel);
  });
  // Quick scale
  document.querySelectorAll('.pos-quick-btn').forEach(b => b.addEventListener('click', () => _execScale(parseFloat(b.dataset.scale))));
  // Execute exit
  document.getElementById('pos-execute-btn').addEventListener('click', _execExit);
  // Exec log delete (event delegation)
  document.getElementById('pos-exec-log-body').addEventListener('click', e => {
    const btn = e.target.closest('.pos-exec-del-btn');
    if (btn) _delExec(btn.dataset.execId);
  });
  // Tag chips
  document.querySelectorAll('#pos-tag-group .pos-tag').forEach(b => b.addEventListener('click', () => _toggleTag(b.dataset.tag)));
  // Save / delete
  document.getElementById('pos-save-btn').addEventListener('click', _savePositionEditor);
  document.getElementById('pos-delete-btn').addEventListener('click', _deletePositionEditor);
  // Refine — light cleanup pass: trim, collapse newlines, sentence-case first letter
  document.getElementById('pos-refine-btn').addEventListener('click', () => {
    const ta = document.getElementById('pos-notes');
    let v = (ta.value || '').replace(/\s+/g, ' ').trim();
    if (v) v = v[0].toUpperCase() + v.slice(1);
    if (v && !/[.!?]$/.test(v)) v += '.';
    ta.value = v;
    window.toast('Notes cleaned up');
  });
  // Dictate — Web Speech API if available
  const dictateBtn = document.getElementById('pos-dictate-btn');
  let recognition = null;
  let recognizing = false;
  dictateBtn.addEventListener('click', () => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) { window.toast('Voice input not supported in this browser', true); return; }
    if (recognizing && recognition) { recognition.stop(); return; }
    recognition = new Rec();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => { recognizing = true; dictateBtn.style.color = 'var(--red-bright)'; };
    recognition.onend = () => { recognizing = false; dictateBtn.style.color = ''; };
    recognition.onerror = () => { recognizing = false; dictateBtn.style.color = ''; };
    recognition.onresult = e => {
      const txt = Array.from(e.results).map(r => r[0].transcript).join(' ');
      const ta = document.getElementById('pos-notes');
      ta.value = (ta.value ? ta.value + ' ' : '') + txt;
    };
    recognition.start();
  });
  // Image paste — only when modal is open and journal pane visible
  document.addEventListener('paste', e => {
    if (!modal.classList.contains('show')) return;
    if (!document.querySelector('[data-pos-pane="journal"].active')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        const reader = new FileReader();
        reader.onload = ev => { POS.playbookImage = ev.target.result; _renderPlaybookImage(); };
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  });
  // Click on drop area to open file picker
  const drop = document.getElementById('pos-playbook-drop');
  const fileInput = document.getElementById('pos-playbook-file');
  drop.addEventListener('click', () => fileInput.click());
  document.getElementById('pos-paste-img-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (POS.playbookImage) {
      POS.playbookImage = null;
      _renderPlaybookImage();
      return;
    }
    fileInput.click();
  });
  fileInput.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => { POS.playbookImage = ev.target.result; _renderPlaybookImage(); };
    reader.readAsDataURL(f);
    e.target.value = '';
  });
}

window.POS = POS;
window.openPositionEditor = openPositionEditor;
window.closePositionEditor = closePositionEditor;
window.setPositionTab = setPositionTab;
window.renderPositionEditor = renderPositionEditor;
window._execScale = _execScale;
window._execExit = _execExit;
window._delExec = _delExec;
window._toggleTag = _toggleTag;
window._savePositionEditor = _savePositionEditor;
window._deletePositionEditor = _deletePositionEditor;
window._wirePositionEditor = _wirePositionEditor;
