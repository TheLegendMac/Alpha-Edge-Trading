// AI Setup Builder modal.
//
// The user describes a chart pattern in plain English; we call the
// `ai-setup` Supabase Edge Function (which proxies to Claude) and get back
// a structured setup. The result is stored in state.aiCustomSetups so it
// shows up as a selectable card in the trade-flow Setup step.
//
// API key never lives on the client — see supabase/functions/ai-setup/index.ts.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import { toast } from './toast.js';
import { tfRefreshAll } from '../trade-flow/stepper.js';
import { getAnthropicKey } from '../intel/ai-key.js';

const MODAL_ID = 'ai-setup-modal';

const SEED_PRESETS = {
  swing: [
    { label: '21-EMA bounce', text: 'Pullback to a rising 21-day EMA in a confirmed uptrend, then the next candle reclaims the prior day high on volume.' },
    { label: 'Base breakout',  text: 'Stock trades in a tight 3-week base near 52-week highs, then breaks the range on 1.5x average volume.' },
    { label: 'Bounce-back',    text: 'Stock undercuts the 9-EMA intraday but closes back above it by end of day — dip-buyers defended the trend.' },
  ],
  intraday: [
    { label: 'VWAP reclaim', text: 'Price loses VWAP in the morning, drifts sideways for 20+ minutes, then reclaims VWAP on a volume spike with EMA9 crossing back above EMA21.' },
    { label: 'Range break',  text: 'Price consolidates inside the opening-range high/low for the first 30 minutes, then breaks the OR high on a momentum candle.' },
    { label: 'Gap fade',     text: 'Stock gaps up >2% pre-market with no real news, fails to hold premarket high in the first 15 minutes, then loses VWAP — fade short.' },
  ],
};

function buildMarkup() {
  return `
    <div class="modal-backdrop ai-setup-backdrop" id="${MODAL_ID}-backdrop">
      <div class="modal ai-setup-modal" role="dialog" aria-label="AI setup builder">
        <button class="modal-close" id="${MODAL_ID}-x" type="button" aria-label="Close">×</button>
        <div class="ai-setup-accent"></div>
        <div class="ai-setup-header">
          <div class="ai-setup-kicker">
            <span class="ai-setup-kicker-main">EDGE INTELLIGENCE</span>
            <span class="ai-setup-kicker-sep">·</span>
            <span class="ai-setup-kicker-sub">SETUP BUILDER</span>
            <span class="ai-setup-kicker-sep">·</span>
            <span class="ai-setup-kicker-mode" id="${MODAL_ID}-mode-label">SWING</span>
          </div>
          <h2 class="ai-setup-title">Describe the <span class="ai-setup-title-accent" id="${MODAL_ID}-title-accent">pattern.</span></h2>
          <div class="ai-setup-sub">Describe a pattern in plain English. Edge Intelligence builds a tagged setup, ready to log.</div>
        </div>
        <div class="ai-setup-body">
          <div class="ai-setup-input-wrap">
            <textarea
              id="${MODAL_ID}-prompt"
              class="ai-setup-textarea"
              rows="6"
              maxlength="600"
              placeholder=""
            ></textarea>
            <div class="ai-setup-input-meta">
              <div class="ai-setup-input-hint">MARKDOWN OK &nbsp;·&nbsp; <span class="ai-setup-input-key">↵</span> TO SEND</div>
              <div class="ai-setup-count"><span id="${MODAL_ID}-count">0</span> / 600</div>
            </div>
          </div>
          <div class="ai-setup-error" id="${MODAL_ID}-error" hidden></div>
        </div>
        <div class="ai-setup-footer">
          <div class="ai-setup-seeds" id="${MODAL_ID}-seeds">
            <span class="ai-setup-seed-label">SEED</span>
            <div class="ai-setup-seed-chips" id="${MODAL_ID}-seed-chips"></div>
          </div>
          <div class="ai-setup-actions">
            <button class="ai-setup-cancel" id="${MODAL_ID}-cancel" type="button">CANCEL</button>
            <button class="ai-setup-go" id="${MODAL_ID}-go" type="button">
              <span class="ai-setup-go-plus">+</span>
              <span class="ai-setup-go-label" id="${MODAL_ID}-go-label">GENERATE SETUP</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function ensureMounted() {
  let root = document.getElementById(`${MODAL_ID}-backdrop`);
  if (root) return root;
  const wrap = document.createElement('div');
  wrap.innerHTML = buildMarkup();
  root = wrap.firstElementChild;
  document.body.appendChild(root);
  return root;
}

function setLoading(loading) {
  const btn = document.getElementById(`${MODAL_ID}-go`);
  const label = document.getElementById(`${MODAL_ID}-go-label`);
  const cancel = document.getElementById(`${MODAL_ID}-cancel`);
  const ta = document.getElementById(`${MODAL_ID}-prompt`);
  if (!btn) return;
  btn.disabled = loading;
  if (cancel) cancel.disabled = loading;
  if (ta) ta.disabled = loading;
  if (label) label.textContent = loading ? 'THINKING…' : 'GENERATE SETUP';
  btn.classList.toggle('is-loading', loading);
}

function showError(msg) {
  const el = document.getElementById(`${MODAL_ID}-error`);
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function closeModal() {
  const root = document.getElementById(`${MODAL_ID}-backdrop`);
  if (!root) return;
  root.classList.remove('show');
  setLoading(false);
}

const SETUP_TOOL = {
  name: 'create_trading_setup',
  description: 'Define the trading setup the user described.',
  input_schema: {
    type: 'object',
    properties: {
      name:      { type: 'string',  description: 'Short 2-4 word setup name, title case, no quotes/emoji.' },
      desc:      { type: 'string',  description: 'One plain-English sentence describing the trigger conditions (≤140 chars).' },
      bias:      { type: 'string',  enum: ['long', 'short', 'either'] },
      thesis:    { type: 'string',  description: 'One sentence on why this trade should win (≤160 chars).' },
      preMortem: { type: 'string',  description: 'One sentence on what invalidates the trade — the level/condition (≤160 chars).' },
      isOrb:     { type: 'boolean', description: 'INTRADAY ONLY: true if setup uses the opening range (ORB / first 5-30 min breakout).' },
    },
    required: ['name', 'desc', 'bias', 'thesis', 'preMortem'],
  },
};

function buildSystemPrompt(mode, direction) {
  const modeBlurb = mode === 'intraday'
    ? 'INTRADAY (same-day trades: opening-range breakouts, VWAP trends/fades, momentum)'
    : 'SWING (multi-day trades: pullbacks to moving averages, base breakouts, breakout retests, reclaims)';
  const orbRule = mode === 'intraday'
    ? 'isOrb: true ONLY if the user mentions opening range, ORB, premarket high/low, or first 5-30 min breakout. Otherwise false.'
    : 'isOrb: omit — this is swing mode.';
  return [
    'You are a trading-setup classifier inside a personal trade-logging app.',
    '',
    'The user will describe in plain English a chart pattern they want to trade. Convert it into a structured setup definition by calling the create_trading_setup tool exactly once.',
    '',
    `Mode: ${modeBlurb}`,
    `Direction hint (override if the user's description is clearly the opposite): ${direction}`,
    '',
    'Rules:',
    '- name: 2-4 words, title case, no quotes/emoji.',
    '- desc: one sentence describing the trigger conditions, ≤140 chars.',
    '- thesis: one sentence on why it should win, ≤160 chars.',
    '- preMortem: one sentence naming the level or condition that invalidates the trade, ≤160 chars.',
    `- ${orbRule}`,
    '',
    'Do not output prose. Only call the tool.',
  ].join('\n');
}

// Call Anthropic directly from the browser using the user's own key (stored in
// localStorage). The `anthropic-dangerous-direct-browser-access` header is the
// documented opt-in for direct browser calls — Anthropic returns CORS-blocked
// without it. Key never goes anywhere except api.anthropic.com.
async function callAnthropic(mode, direction, prompt) {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    const err = new Error('No Anthropic API key saved. Open Settings → Data & export → AI assistant key to add one.');
    err.code = 'NO_KEY';
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
      max_tokens: 600,
      tools: [SETUP_TOOL],
      tool_choice: { type: 'tool', name: 'create_trading_setup' },
      system: buildSystemPrompt(mode, direction),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch { /* ignore */ }
    if (res.status === 401) {
      throw new Error('Anthropic rejected the key (401). Check that it is correct in Settings.');
    }
    if (res.status === 429) {
      throw new Error('Rate limit or insufficient credits on your Anthropic account.');
    }
    throw new Error(detail || `AI service error (${res.status}).`);
  }
  const data = await res.json();
  const block = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'create_trading_setup');
  if (!block || !block.input) {
    throw new Error('AI did not return a valid setup.');
  }
  const out = block.input;
  const bias = ['long', 'short', 'either'].includes(out.bias) ? out.bias : 'either';
  return {
    id: `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(out.name || 'AI Setup').slice(0, 60),
    desc: String(out.desc || '').slice(0, 200),
    bias,
    thesis: String(out.thesis || '').slice(0, 220),
    preMortem: String(out.preMortem || '').slice(0, 220),
    isOrb: mode === 'intraday' ? !!out.isOrb : false,
    mode,
    createdAt: new Date().toISOString(),
  };
}

function currentDirection(mode) {
  if (mode === 'intraday') {
    const d = state.intraday && state.intraday.direction;
    return d === 'short' ? 'short' : 'long';
  }
  return state.direction === 'short' ? 'short' : 'long';
}

function applySetup(setup, mode) {
  if (!state.aiCustomSetups) state.aiCustomSetups = {};
  state.aiCustomSetups[setup.id] = { ...setup, isAi: true };
  if (mode === 'intraday') {
    if (!state.intraday) return;
    state.intraday.setup = setup.id;
    if (setup.bias && setup.bias !== 'either') state.intraday.direction = setup.bias;
  } else {
    state.selectedSetup = setup.id;
    if (setup.bias && setup.bias !== 'either') state.direction = setup.bias;
  }
  if (!state.tradeFlow) state.tradeFlow = { mode, step: 1, thesis: '', preMortem: '' };
  if (!state.tradeFlow.thesis) state.tradeFlow.thesis = setup.thesis || '';
  if (!state.tradeFlow.preMortem) state.tradeFlow.preMortem = setup.preMortem || '';
  saveState();
  tfRefreshAll();
}

function renderSeeds(mode) {
  const wrap = document.getElementById(`${MODAL_ID}-seed-chips`);
  if (!wrap) return;
  const seeds = SEED_PRESETS[mode] || SEED_PRESETS.swing;
  wrap.innerHTML = seeds.map((s, i) =>
    `<button type="button" class="ai-setup-seed-chip" data-seed-i="${i}">${s.label}</button>`
  ).join('');
}

export function openAiSetupBuilder(mode) {
  const m = mode === 'intraday' ? 'intraday' : 'swing';
  const root = ensureMounted();

  const ta = document.getElementById(`${MODAL_ID}-prompt`);
  const count = document.getElementById(`${MODAL_ID}-count`);
  const modeLabel = document.getElementById(`${MODAL_ID}-mode-label`);
  if (ta) {
    ta.value = '';
    ta.placeholder = m === 'intraday'
      ? 'e.g. Stock gapping up on news, holds above VWAP for 30 min, then breaks the pre-market high on volume.'
      : 'e.g. Stock pulling back to a rising 50-day MA in a confirmed uptrend, then the next candle closes above the prior day high.';
  }
  if (count) count.textContent = '0';
  if (modeLabel) modeLabel.textContent = m.toUpperCase();
  // Color-code "pattern." accent to the mode: cyan for swing, magenta for intraday.
  const titleAccent = document.getElementById(`${MODAL_ID}-title-accent`);
  if (titleAccent) {
    titleAccent.classList.remove('mode-swing', 'mode-intraday');
    titleAccent.classList.add(`mode-${m}`);
  }
  showError('');
  setLoading(false);
  renderSeeds(m);

  const close = () => closeModal();

  // Strip prior listeners by cloning the dynamic nodes.
  ['x', 'cancel', 'go', 'prompt'].forEach(suffix => {
    const el = document.getElementById(`${MODAL_ID}-${suffix}`);
    el?.replaceWith(el.cloneNode(true));
  });
  // Seeds were just re-rendered with fresh innerHTML, so they're already clean.

  const xBtn = document.getElementById(`${MODAL_ID}-x`);
  const cancelBtn = document.getElementById(`${MODAL_ID}-cancel`);
  const goBtn = document.getElementById(`${MODAL_ID}-go`);
  const ta2 = document.getElementById(`${MODAL_ID}-prompt`);
  const count2 = document.getElementById(`${MODAL_ID}-count`);

  const onChar = () => {
    if (count2 && ta2) count2.textContent = String(ta2.value.length);
  };
  const onSubmit = async () => {
    const prompt = (ta2?.value || '').trim();
    if (!prompt) {
      showError('Describe the pattern first.');
      return;
    }
    showError('');
    setLoading(true);
    try {
      const setup = await callAnthropic(m, currentDirection(m), prompt);
      applySetup(setup, m);
      toast(`AI setup added: ${setup.name}`);
      closeModal();
    } catch (e) {
      console.error('[ai-setup]', e);
      showError(e.message || 'Something went wrong. Try again.');
      setLoading(false);
    }
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { close(); }
    // Plain Enter sends (matches the "↵ TO SEND" hint). Shift+Enter inserts a newline.
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      onSubmit();
    }
  };

  xBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);
  goBtn?.addEventListener('click', onSubmit);
  ta2?.addEventListener('input', onChar);
  ta2?.addEventListener('keydown', onKey);

  // Seeds: clicking a chip fills the textarea with the preset prompt text.
  document.querySelectorAll(`#${MODAL_ID}-seed-chips .ai-setup-seed-chip`).forEach(chip => {
    chip.addEventListener('click', () => {
      const i = Number(chip.dataset.seedI);
      const seeds = SEED_PRESETS[m] || SEED_PRESETS.swing;
      const seed = seeds[i];
      if (!seed || !ta2) return;
      ta2.value = seed.text;
      onChar();
      ta2.focus();
    });
  });

  root.addEventListener('click', (ev) => {
    if (ev.target === root) close();
  }, { once: true });
  document.addEventListener('keydown', function escHandler(ev) {
    if (ev.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escHandler);
    }
  });

  root.classList.add('show');
  setTimeout(() => ta2?.focus(), 50);
}
