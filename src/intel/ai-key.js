// Anthropic API key storage.
//
// Lives in localStorage under its OWN key (not in the synced state blob) — that
// way it stays on the device and does not get pushed to the cloud or shared
// across signed-in browsers. Each user supplies their own key from
// https://console.anthropic.com/settings/keys.
//
// The key never leaves this device or the direct call to api.anthropic.com.

const STORAGE_KEY = 'mac_cockpit_anthropic_key';

export function getAnthropicKey() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setAnthropicKey(value) {
  const v = (value || '').trim();
  try {
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore quota errors */ }
}

export function clearAnthropicKey() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function maskKey(value) {
  const v = (value || '').trim();
  if (!v) return '';
  if (v.length <= 12) return '••••';
  return `${v.slice(0, 7)}…${v.slice(-4)}`;
}

// Lightweight sanity check on the key shape — Anthropic keys start with
// "sk-ant-". We don't validate length strictly because format may evolve.
export function looksLikeAnthropicKey(value) {
  const v = (value || '').trim();
  return /^sk-ant-/i.test(v) && v.length >= 20;
}
