// Alpha Intel — glossary side panel.

import { state } from '../state/store.js';

function openAIGlossary() {
  // Sync the dynamic window label with the user's Settings value.
  const days = (state.settings && state.settings.killSwitchDays) || 30;
  document.querySelectorAll('[data-ai-glossary-window]').forEach(el => {
    el.textContent = days;
  });
  const panel = document.getElementById('ai-glossary-panel');
  const back  = document.getElementById('ai-glossary-backdrop');
  if (!panel || !back) return;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  back.classList.add('open');
}
function closeAIGlossary() {
  const panel = document.getElementById('ai-glossary-panel');
  const back  = document.getElementById('ai-glossary-backdrop');
  if (!panel || !back) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  back.classList.remove('open');
}

window.openAIGlossary = openAIGlossary;
window.closeAIGlossary = closeAIGlossary;
