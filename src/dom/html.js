// Small HTML helpers for template renderers. Keep dynamic text escaped and
// attributes boring so list/card renderers can stay fast without inline JS.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

export function attr(value) {
  return esc(value).replace(/`/g, '&#96;');
}

export function money(value, digits = 0) {
  const n = Number(value) || 0;
  return `${n >= 0 ? '+$' : '-$'}${Math.abs(n).toFixed(digits)}`;
}

export function plainMoney(value, digits = 0) {
  const n = Number(value) || 0;
  return `$${Math.abs(n).toFixed(digits)}`;
}

window.htmlEsc = esc;
window.htmlAttr = attr;
