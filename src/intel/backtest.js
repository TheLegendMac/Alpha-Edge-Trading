// ThinkorSwim backtest report import + display.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { SYNC, doPush } from '../sync/supabase.js';

// ── TOS backtest report import card ───────────────────────────
function buildBacktestCard(help) {
  const reports = (state.backtestReports || []);
  const list = reports.length ? reports.map((r, i) => {
    const tone = (r.netProfit || 0) >= 0 ? 'pos' : 'neg';
    const np = r.netProfit;
    const npStr = np == null ? '—' : `${np >= 0 ? '+' : '-'}$${Math.abs(np).toFixed(2)}`;
    const periodStr = r.period ? ` · ${r.period}` : '';
    const pfStr = r.profitFactor != null ? ` · PF ${r.profitFactor}` : '';
    const avgStr = r.avgTrade != null ? ` · avg ${r.avgTrade >= 0 ? '+' : '-'}$${Math.abs(r.avgTrade).toFixed(2)}` : '';
    return `<div class="bar-row" style="border-bottom:1px solid var(--line); padding-bottom:8px; align-items:center;">
      <div class="bar-row-label" style="flex:1;">
        <strong>${r.name || 'Backtest ' + (i + 1)}</strong>
        <span class="bar-row-sub">${r.symbol || '—'} · ${r.trades || 0} trades · ${r.winRate != null ? r.winRate.toFixed(0) + '%W' : '—'}${pfStr}${avgStr}${periodStr}</span>
      </div>
      <div class="bar-value ${tone === 'pos' ? 'pl-positive' : 'pl-negative'}" style="min-width:90px;">${npStr}</div>
      <button class="pos-exec-del-btn" onclick="deleteBacktestReport('${r.id}')" title="Remove" style="margin-left:8px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>`;
  }).join('') : `<div style="color:var(--ink-4);font-size:12px;padding:8px 0;">Import a TOS Strategy Report (.csv or pasted text) to compare your live trades against the historical backtest.</div>`;

  return `<div class="home-card">
    <div class="stats-snapshot-head">
      <div class="home-card-title" style="margin: 0;">Backtest Reports (TOS Import)${help('Import a ThinkorSwim strategy backtest report. Stored locally so you can compare live results to the historical study.')}</div>
      <div style="display:flex; gap:8px;">
        <button class="btn-secondary btn-compact" id="btn-import-backtest-file" type="button">Import file</button>
        <button class="btn-secondary btn-compact" id="btn-import-backtest-paste" type="button">Paste text</button>
        <input type="file" id="backtest-file-input" accept=".csv,.txt,.tsv" style="display:none" />
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:6px;">${list}</div>
  </div>`;
}

// ── TOS Strategy Report parser ────────────────────────────────
function parseTOSBacktest(rawText, filename) {
  const text = (rawText || '').replace(/\r/g, '');
  const lines = text.split('\n').map(l => l.replace(/^﻿/, '').trim()).filter(Boolean);
  const result = {
    id: 'bt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: filename ? filename.replace(/\.(csv|tsv|txt)$/i, '') : null,
    symbol: null,
    netProfit: null,
    winRate: null,
    trades: null,
    profitFactor: null,
    maxDrawdown: null,
    avgTrade: null,
    period: null,
    strategy: null,
    raw: text.length > 200000 ? text.slice(0, 200000) : text,
    imported_at: new Date().toISOString(),
  };

  // Detect delimiter for a single line
  const splitFor = (line) => {
    if (line.includes('\t')) return line.split('\t');
    if (line.includes(';'))  return line.split(';');
    if (line.includes(','))  return line.split(',');
    return line.split(/\s{2,}/);
  };

  // Strip quotes/dollar/commas/percent → number. Parens denote negative.
  const num = v => {
    if (v == null) return null;
    let s = String(v).trim().replace(/^["']|["']$/g, '');
    if (!s) return null;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[$,%\s]/g, '');
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return negative ? -Math.abs(n) : n;
  };

  // Find a labelled value: "Label: 123" or "Label;...;123"
  const findVal = (...labels) => {
    for (const label of labels) {
      const re = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:;]?', 'i');
      for (const line of lines) {
        if (re.test(line)) {
          // After the label, take the trailing numeric token.
          const after = line.replace(re, '').replace(/[;:,]\s*$/, '');
          const parts = splitFor(after);
          for (let i = parts.length - 1; i >= 0; i--) {
            const n = num(parts[i]);
            if (n !== null) return n;
          }
          // If no parts, try the raw remainder
          const n2 = num(after);
          if (n2 !== null) return n2;
        }
      }
    }
    return null;
  };

  // ---- Header metadata ----
  const symLine = lines.find(l => /^symbol\s*[:;]/i.test(l));
  if (symLine) {
    const after = symLine.replace(/^symbol\s*[:;]\s*/i, '').replace(/[;,]+$/, '').trim();
    const m = after.match(/[A-Z.]{1,6}/);
    if (m) result.symbol = m[0];
  }
  const workTime = lines.find(l => /^work\s*time\s*[:;]/i.test(l));
  if (workTime) result.period = workTime.replace(/^work\s*time\s*[:;]\s*/i, '').replace(/;+$/, '').trim();

  // ---- Trade-row table (Format A) ----
  // Find a header row containing "Trade P/L" — subsequent rows until blank are data.
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/trade\s*p\/?l/i.test(lines[i]) && /side|strategy/i.test(lines[i])) { headerIdx = i; break; }
  }
  let tradeCount = 0;
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let netFromRows = 0;
  let strategySeen = null;
  if (headerIdx >= 0) {
    const headerParts = splitFor(lines[headerIdx]).map(s => s.trim().toLowerCase());
    const colTradePL  = headerParts.findIndex(c => /^trade\s*p\/?l/.test(c));
    const colSide     = headerParts.findIndex(c => /^side$/.test(c));
    const colStrategy = headerParts.findIndex(c => /^strategy$/.test(c));
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const ln = lines[i];
      // Stop at the summary section (blank already filtered, so look for non-numeric leading)
      if (/^total\s+p\/?l/i.test(ln) || /^max\s+trade\s+p\/?l/i.test(ln) || /^total\s+order/i.test(ln)) break;
      const parts = splitFor(ln);
      if (!parts.length) continue;
      // Trade row starts with a numeric Id
      if (!/^\d+$/.test(parts[0].trim())) continue;
      const side = colSide >= 0 ? (parts[colSide] || '').trim().toLowerCase() : '';
      // Only count exits as trades — entries pair to exits to form one trade
      if (side && !/(close|cover)/.test(side)) continue;
      const pl = colTradePL >= 0 ? num(parts[colTradePL]) : null;
      if (pl === null) continue;
      tradeCount++;
      netFromRows += pl;
      if (pl > 0) { wins++; grossWin += pl; }
      else if (pl < 0) { losses++; grossLoss += Math.abs(pl); }
      if (colStrategy >= 0 && !strategySeen) {
        const stratRaw = (parts[colStrategy] || '').trim();
        const m = stratRaw.match(/^([A-Z][A-Za-z0-9_]+)/);
        if (m) strategySeen = m[1];
      }
    }
  }

  // ---- Summary lines (Format A footer + Format B) ----
  result.netProfit    = findVal('Total P/L', 'Net Profit', 'Total Net Profit', 'Total Net P/L');
  result.trades       = findVal('Total Number of Trades', 'Number of Trades', 'Total Trades', '# of Trades');
  result.winRate      = findVal('Percent Profitable', 'Win Rate', 'Profitable %', '% Profitable');
  result.profitFactor = findVal('Profit Factor');
  result.maxDrawdown  = findVal('Max Drawdown', 'Max. Drawdown');
  result.avgTrade     = findVal('Avg Trade', 'Avg. Trade', 'Average Trade', 'Max trade P/L');

  // Fill from row-derived stats when summary line is missing
  if (result.netProfit === null && tradeCount > 0) result.netProfit = Number(netFromRows.toFixed(2));
  if (result.trades === null && tradeCount > 0) result.trades = tradeCount;
  if (result.winRate === null && tradeCount > 0) result.winRate = (wins / tradeCount) * 100;
  if (result.profitFactor === null && grossLoss > 0) result.profitFactor = Number((grossWin / grossLoss).toFixed(2));
  if (result.avgTrade === null && tradeCount > 0) result.avgTrade = Number((netFromRows / tradeCount).toFixed(2));

  if (strategySeen) result.strategy = strategySeen;

  if (!result.symbol && filename) {
    const m = filename.match(/[A-Z]{1,5}/);
    if (m) result.symbol = m[0];
  }

  // Auto-name from strategy + symbol if no explicit name
  if (result.name && /^StrategyReports?_/i.test(result.name) && result.symbol) {
    result.name = (result.strategy || 'Strategy') + ' · ' + result.symbol;
  }

  // Failure: nothing found at all
  if (result.netProfit === null && result.trades === null && result.winRate === null) {
    return { ok: false, reason: 'Could not detect TOS Strategy Report fields. Looked for "Total P/L", "Total order(s)", "Net Profit", "Percent Profitable", and trade rows with "Trade P/L". Got ' + lines.length + ' lines.' };
  }
  return { ok: true, report: result };
}

function addBacktestReport(report) {
  if (!state.backtestReports) state.backtestReports = [];
  state.backtestReports.unshift(report);
  saveState();
  if (SYNC.pendingPush) { clearTimeout(SYNC.pendingPush); SYNC.pendingPush = null; }
  doPush();
  if (typeof window.renderLogStats === 'function') window.renderLogStats();
  if (typeof window.toast === 'function') window.toast('Backtest imported');
}

function deleteBacktestReport(id) {
  if (!state.backtestReports) return;
  if (!confirm('Remove this backtest report?')) return;
  state.backtestReports = state.backtestReports.filter(r => r.id !== id);
  saveState();
  if (typeof window.renderLogStats === 'function') window.renderLogStats();
  if (typeof window.toast === 'function') window.toast('Backtest removed');
}

function importBacktestFromFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = parseTOSBacktest(e.target.result, file.name);
    if (!parsed.ok) {
      if (typeof window.toast === 'function') window.toast(parsed.reason || 'Could not parse backtest', true);
      return;
    }
    addBacktestReport(parsed.report);
  };
  reader.readAsText(file);
}

function importBacktestFromPaste() {
  const txt = prompt('Paste your TOS Strategy Report below (tab-delimited or CSV):');
  if (!txt || !txt.trim()) return;
  const parsed = parseTOSBacktest(txt, null);
  if (!parsed.ok) {
    if (typeof window.toast === 'function') window.toast(parsed.reason || 'Could not parse backtest', true);
    return;
  }
  const name = prompt('Give this backtest a name (e.g., "21-EMA Pullback / SPY 2024"):', 'Backtest ' + new Date().toLocaleDateString());
  if (name) parsed.report.name = name.trim();
  addBacktestReport(parsed.report);
}

window.buildBacktestCard = buildBacktestCard;
window.parseTOSBacktest = parseTOSBacktest;
window.addBacktestReport = addBacktestReport;
window.deleteBacktestReport = deleteBacktestReport;
window.importBacktestFromFile = importBacktestFromFile;
window.importBacktestFromPaste = importBacktestFromPaste;
