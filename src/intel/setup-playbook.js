import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';
import {
  TRADE_SWING_SETUPS,
  TRADE_INTRADAY_SETUPS,
  TRADE_SETUP_TEMPLATES,
} from '../config/constants.js';
import { esc, attr } from '../dom/html.js';

let saveTimer = null;

function knownSetups(trades = state.trades || []) {
  const map = new Map();
  TRADE_SWING_SETUPS.forEach(s => map.set(s.id, { name: s.id, type: 'Swing', hint: s.desc }));
  TRADE_INTRADAY_SETUPS.forEach(s => map.set(s.id, { name: s.id, label: s.name, type: 'Intraday', hint: s.desc }));
  trades.forEach(t => {
    const name = t.setup || '';
    if (!name || map.has(name)) return;
    map.set(name, { name, type: t.mode === 'intraday' ? 'Intraday' : 'Swing', hint: '' });
  });
  return [...map.values()].sort((a, b) => a.type.localeCompare(b.type) || (a.label || a.name).localeCompare(b.label || b.name));
}

function rulePlaceholder(setup) {
  const tpl = TRADE_SETUP_TEMPLATES[setup.name];
  if (tpl && tpl.thesis) return tpl.thesis;
  return setup.hint || 'Write the exact rule for when this setup is allowed.';
}

export function buildSetupPlaybookHtml(trades = state.trades || []) {
  if (!state.setupRules) state.setupRules = {};
  const setups = knownSetups(trades);
  return `
    <div class="home-card setup-playbook-card">
      <div class="stats-snapshot-head">
        <div class="home-card-title" style="margin:0;">Setup Rules Playbook</div>
        <div class="stats-snapshot-meta">rules only · autosaves</div>
      </div>
      <div class="setup-rule-list">
        ${setups.map(setup => {
          const name = setup.name;
          const display = setup.label || name;
          const rule = state.setupRules[name] || '';
          return `
            <label class="setup-rule-row">
              <span class="setup-rule-meta">
                <span class="setup-rule-name">${esc(display)}</span>
                <span class="setup-rule-type">${esc(setup.type)}</span>
              </span>
              <textarea data-setup-rule="${attr(name)}" rows="2" placeholder="${attr(rulePlaceholder(setup))}">${esc(rule)}</textarea>
            </label>`;
        }).join('')}
      </div>
    </div>`;
}

export function wireSetupPlaybook(container) {
  if (!container || container.dataset.setupPlaybookWired === '1') return;
  container.dataset.setupPlaybookWired = '1';
  container.addEventListener('input', e => {
    const field = e.target.closest('[data-setup-rule]');
    if (!field) return;
    if (!state.setupRules) state.setupRules = {};
    state.setupRules[field.dataset.setupRule] = field.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveState();
      if (typeof window.toast === 'function') window.toast('Playbook rule saved');
    }, 650);
  });
}

window.buildSetupPlaybookHtml = buildSetupPlaybookHtml;
window.wireSetupPlaybook = wireSetupPlaybook;
