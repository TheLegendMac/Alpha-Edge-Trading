// Small HTML helpers for template renderers. Keep dynamic text escaped and
// attributes boring so list/card renderers can stay fast without inline JS.

import { fmtMoney, fmtMoneyPlain } from '../models/formatters.js';

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

// HTML-template aliases — route to canonical formatters so output is consistent.
export const money = (v, digits = 0) => fmtMoney(v, digits);
export const plainMoney = (v, digits = 0) => fmtMoneyPlain(v, digits);

// ── Reusable HTML component builders ───────────────────────

// card({ title, body, tone, help, className }) → home-card HTML
// tone: 'good' | 'warn' | 'bad' | 'info' | '' (untoned)
export function card({ title, body, tone = '', help = '', className = '' } = {}) {
  const toneCls = tone ? ` ${tone}` : '';
  const extraCls = className ? ` ${className}` : '';
  return `
    <div class="home-card${toneCls}${extraCls}">
      ${title ? `<div class="home-card-title">${title}${help || ''}</div>` : ''}
      ${body || ''}
    </div>`;
}

// barRow({ label, sub, value, fillPct, tone })
// Renders a horizontal bar row used by alpha buckets, exit-discipline, setup perf.
// tone: 'pos' | 'neg' | 'neutral' (controls fill + value color)
export function barRow({ label, sub = '', value = '', fillPct = 0, tone = 'neutral', valueClass = '' } = {}) {
  const pct = Math.max(0, Math.min(100, Number(fillPct) || 0));
  const fillTone = tone === 'pos' || tone === 'neg' || tone === 'neutral' ? tone : 'neutral';
  const valCls = valueClass || (tone === 'pos' ? 'pl-positive' : tone === 'neg' ? 'pl-negative' : '');
  return `
    <div class="bar-row">
      <div class="bar-row-label">${label}${sub ? `<span class="bar-row-sub">${sub}</span>` : ''}</div>
      <div class="bar-wrap"><div class="bar-fill ${fillTone}" style="width:${pct.toFixed(0)}%"></div></div>
      <div class="bar-value ${valCls}">${value}</div>
    </div>`;
}
