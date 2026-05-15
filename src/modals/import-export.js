// JSON/CSV export + JSON re-import + stale-backup nudge banner.

import { state } from '../state/store.js';
import { saveState } from '../state/persistence.js';

function exportCSV() {
  if (state.trades.length === 0) { window.toast('No trades to export', true); return; }
  const cols = ['date','mode','ticker','setup','direction','entry','contracts','ivr','regime','status','exit','exit_date','riskDollars','grade','thesis','premortem','stop'];
  const csv = [
    cols.join(','),
    ...state.trades.map(t => cols.map(c => {
      let v = t[c] || '';
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
        v = '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    }).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mac_trades_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  window.toast('CSV exported');
}

// ---------- JSON Export / Import ----------
function exportJSON() {
  // Full state snapshot (settings, regime, sectors, trades) for cross-machine sync
  const blob = new Blob([JSON.stringify({
    version: 'mac-v3',
    exportedAt: new Date().toISOString(),
    state: state
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mac_state_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  // Stamp the export so the "stale backup" nudge stays quiet
  localStorage.setItem('mac_cockpit_last_export', String(Date.now()));
  hideStaleBackupNudge();
  window.toast('JSON snapshot exported');
}

// ---------- Stale-backup nudge ----------
// Even with Supabase sync, a local JSON export is cheap insurance against
// cloud account issues, schema migrations gone wrong, or just wanting an
// archived snapshot. Nudge if no export in 7+ days.
function checkStaleBackup() {
  const last = Number(localStorage.getItem('mac_cockpit_last_export') || 0);
  if (!last) return;  // never exported — don't nag a brand-new user
  const days = (Date.now() - last) / (1000 * 60 * 60 * 24);
  if (days >= 7) showStaleBackupNudge(Math.floor(days));
}

function showStaleBackupNudge(daysOld) {
  if (document.getElementById('stale-backup-nudge')) return;
  const banner = document.createElement('div');
  banner.id = 'stale-backup-nudge';
  banner.style.cssText = 'position: fixed; bottom: 16px; right: 16px; z-index: 9999; background: var(--bg-card); border: 1px solid var(--amber); border-left: 3px solid var(--amber); border-radius: var(--r-md); padding: 12px 16px; max-width: 340px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); font-size: 13px;';
  banner.innerHTML = `
    <div style="display: flex; gap: 10px; align-items: flex-start;">
      <span style="font-size: 16px; flex-shrink: 0;">💾</span>
      <div style="flex: 1;">
        <div style="font-weight: 600; color: var(--ink); margin-bottom: 4px;">Backup is ${daysOld} days old</div>
        <div style="color: var(--ink-3); margin-bottom: 8px; line-height: 1.4;">Cloud sync is great but a local export is cheap insurance. Save one now?</div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-secondary btn-compact" id="stale-backup-export">Export now</button>
          <button class="btn-ghost btn-compact" id="stale-backup-dismiss">Dismiss</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(banner);
  document.getElementById('stale-backup-export').addEventListener('click', exportJSON);
  document.getElementById('stale-backup-dismiss').addEventListener('click', () => {
    // Snooze 24 hours
    localStorage.setItem('mac_cockpit_last_export', String(Date.now() - (6 * 24 * 60 * 60 * 1000)));
    hideStaleBackupNudge();
  });
}

function hideStaleBackupNudge() {
  const n = document.getElementById('stale-backup-nudge');
  if (n) n.remove();
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.state || !Array.isArray(data.state.trades)) throw new Error('Invalid format');
      const ok = confirm(`Import ${data.state.trades.length} trades and overwrite current cockpit state? Current data will be replaced.`);
      if (!ok) return;
      // Replace state contents while preserving object identity.
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, data.state);
      // Re-init missing fields after import
      if (!state.liquidity) state.liquidity = { stockVolPass: null, optionOIPass: null, bid: null, ask: null, spreadPct: null };
      if (!state.sectorRatings) state.sectorRatings = {};
      if (!state.pretradeChecks) state.pretradeChecks = { vix: true, news: true };
      saveState();
      window.toast(`Imported ${state.trades.length} trades`);
      // Hard refresh of UI
      location.reload();
    } catch (err) {
      window.toast('Import failed: ' + err.message, true);
    }
  };
  reader.readAsText(file);
}

window.exportCSV = exportCSV;
window.exportJSON = exportJSON;
window.importJSON = importJSON;
window.checkStaleBackup = checkStaleBackup;
window.showStaleBackupNudge = showStaleBackupNudge;
window.hideStaleBackupNudge = hideStaleBackupNudge;
