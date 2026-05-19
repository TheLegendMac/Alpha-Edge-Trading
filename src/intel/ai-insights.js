// AI pattern-extraction over the user's recent closed-trade history.
// Sends a compact summary to Claude with the user's own Anthropic key
// (stored in localStorage; never synced). Result is cached on state.aiInsights
// so re-opening Stats doesn't re-spend tokens.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { getAnthropicKey } from './ai-key.js';
import { isClosedTrade, calcPL, calcR } from '../models/trade.js';

// Build a compact trade row for the AI prompt. We intentionally strip the
// long-text fields (thesis, journal) so the prompt stays small — focus on
// numeric / categorical features the model can pattern-match on.
function summarizeTrade(t) {
  const pl = calcPL(t);
  const r = calcR(t);
  return {
    ticker: t.ticker || '',
    setup: t.setup || '',
    mode: t.mode || 'swing',
    direction: t.direction || '',
    instrument: t.instrument || '',
    entry: Number(t.entry) || null,
    exit: Number(t.exit) || null,
    qty: Number(t.qty || t.contracts || t.shares) || 0,
    riskDollars: Number(t.riskDollars) || null,
    date: t.date || null,
    exit_date: t.exit_date || null,
    exit_reason: t.exit_reason || '',
    grade: t.grade || '',
    tags: Array.isArray(t.tags) ? t.tags : [],
    pl: pl === null ? null : Math.round(pl),
    r: r === null ? null : Number(r.toFixed(2)),
  };
}

function buildContextPayload(limit = 50) {
  const trades = (state.trades || []).filter(isClosedTrade);
  // Most recent N by exit date
  const sorted = trades
    .filter(t => t.exit_date || t.date)
    .sort((a, b) => (b.exit_date || b.date || '').localeCompare(a.exit_date || a.date || ''))
    .slice(0, limit)
    .map(summarizeTrade);

  const settings = state.settings || {};
  return {
    account: Number(settings.account) || null,
    riskPerTrade: { on: settings.riskOn, neutral: settings.riskNeutral, off: settings.riskOff },
    currentRegime: state.regime || null,
    killSwitchFloorPct: settings.killSwitchFloor || 7,
    sampleSize: sorted.length,
    closedTrades: sorted,
  };
}

const SYSTEM_PROMPT = [
  'You are a trading coach analyzing a personal trader\'s closed-trade history.',
  'You will receive a JSON payload of recent trades and settings. Produce a',
  'concise, actionable critique aimed at improving expectancy and discipline.',
  '',
  'Output strictly Markdown. Use this structure:',
  '## What is working',
  '- 2-4 bullets — patterns where the trader has demonstrated edge (cite specific',
  '  setups, tags, or directional bias when supported by ≥3 trades).',
  '## What is bleeding',
  '- 2-4 bullets — patterns that lose money. Quantify with avg R, win rate,',
  '  total P/L when relevant.',
  '## One change to make this week',
  '- A single, specific, testable change (e.g. "skip Edge Reversal shorts in',
  '  risk-on regime — 0/4 this quarter, -$420 total"). No platitudes.',
  '',
  'Rules:',
  '- Never invent data. If sample size is < 5, say so and refuse to draw conclusions.',
  '- Cite trade counts and R values. Prefer Markdown bold for the headline number.',
  '- No disclaimers. No "consult a financial advisor". Talk like a peer.',
  '- ≤ 280 words total.',
].join('\n');

export async function generateAiInsights() {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    const err = new Error('No Anthropic API key saved. Open Settings → Data & export → AI assistant key to add one.');
    err.code = 'NO_KEY';
    throw err;
  }
  const payload = buildContextPayload(50);
  if (!payload.closedTrades.length) {
    const err = new Error('No closed trades yet. Log a few exits before asking for AI insights.');
    err.code = 'NO_DATA';
    throw err;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Here is my recent trading history. Give me the critique.\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
      }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    if (res.status === 401) throw new Error('Anthropic rejected the key (401). Check Settings.');
    if (res.status === 429) throw new Error('Rate limit or insufficient credits on your Anthropic account.');
    throw new Error(detail || `AI service error (${res.status}).`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('AI returned an empty response.');

  state.aiInsights = {
    text,
    generatedAt: new Date().toISOString(),
    sampleSize: payload.closedTrades.length,
  };
  saveState();
  return state.aiInsights;
}

// Bare-bones Markdown → safe HTML for the insights card. Supports H2 (## ),
// list items (- ), bold (**…**), and emphasis (*…*). Anything else falls
// through as escaped text, preserving line breaks as <br>.
export function renderInsightsHtml(md) {
  if (!md) return '';
  const escape = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const inline = s => escape(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>');

  const lines = md.split(/\r?\n/);
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (line.startsWith('## ')) {
      closeList();
      html += `<h3 class="ai-insights-h">${inline(line.slice(3))}</h3>`;
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) { html += '<ul class="ai-insights-list">'; inList = true; }
      html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`;
    } else {
      closeList();
      html += `<p class="ai-insights-p">${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}
