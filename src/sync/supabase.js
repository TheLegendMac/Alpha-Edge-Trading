// Supabase cloud sync: client setup, push/pull, debouncing, cross-device polling.
// Strategy: localStorage is the immediate source of truth (fast, offline-safe).
// Supabase is the cloud mirror. On every save, debounce-push to Supabase. On
// boot, pull cloud state, compare timestamps, and reconcile.

import { state } from '../state/store.js';
import { saveStateLocal } from '../state/persistence.js';
import { refreshAllUI } from '../state/store.js';
import {
  mergeDeletedTradeIds,
  mergeTradesArrays,
  shouldAdoptCloudMarketContext,
  adoptCloudMarketContext,
} from './merge.js';

export const SYNC = {
  client: null,
  user: null,
  enabled: false,
  status: 'local',        // 'local' | 'syncing' | 'synced' | 'error' | 'offline'
  lastSyncAt: null,
  lastError: null,
  deviceId: null,
  pendingPush: null,      // setTimeout handle for debounced push
  PUSH_DEBOUNCE_MS: 1500, // wait this long after last save before pushing
};

// Stable device ID for conflict resolution.
export function getDeviceId() {
  let id = localStorage.getItem('mac_cockpit_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem('mac_cockpit_device_id', id);
  }
  return id;
}
SYNC.deviceId = getDeviceId();

// Initialize Supabase client (called from init via bootstrapAuth).
export function initSupabase() {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url || cfg.url.includes('YOUR-PROJECT') || !cfg.anonKey || cfg.anonKey.includes('YOUR-ANON-KEY')) {
    console.info('Supabase config missing — running in local-only mode.');
    setSyncStatus('local', 'No cloud sync configured');
    return false;
  }
  if (!window.supabase || !window.supabase.createClient) {
    console.warn('Supabase library failed to load.');
    setSyncStatus('error', 'Library failed to load');
    return false;
  }
  try {
    SYNC.client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mac-cockpit-auth' },
    });
    SYNC.enabled = true;
    return true;
  } catch (e) {
    console.error('Supabase init failed:', e);
    setSyncStatus('error', e.message);
    return false;
  }
}

export function setSyncStatus(status, label) {
  SYNC.status = status;
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  const pill = document.getElementById('sync-pill');
  if (!dot || !lbl || !pill) return;
  const colors = {
    local:   { color: '#6e7681', text: 'Local' },
    syncing: { color: '#f59e0b', text: 'Syncing' },
    synced:  { color: '#10b981', text: 'Synced' },
    error:   { color: '#ef4444', text: 'Error' },
    offline: { color: '#f59e0b', text: 'Offline' },
  };
  const c = colors[status] || colors.local;
  dot.style.background = c.color;
  lbl.textContent = label || c.text;
  pill.title = `Sync: ${c.text}${SYNC.user ? ` (${SYNC.user.email})` : ''}${SYNC.lastSyncAt ? ` — last ${new Date(SYNC.lastSyncAt).toLocaleTimeString()}` : ''}`;
}

export async function pullCloudState() {
  if (!SYNC.enabled || !SYNC.user) return null;
  setSyncStatus('syncing', 'Pulling');
  try {
    const { data, error } = await SYNC.client
      .from('cockpit_state')
      .select('state_json, updated_at, device_id')
      .eq('user_id', SYNC.user.id)
      .maybeSingle();
    if (error) throw error;
    setSyncStatus('synced');
    SYNC.lastSyncAt = Date.now();
    return data;
  } catch (e) {
    console.warn('Pull failed:', e);
    setSyncStatus('error', 'Pull failed');
    SYNC.lastError = e.message;
    return null;
  }
}

export function schedulePush() {
  if (!SYNC.enabled || !SYNC.user) return;
  if (SYNC.pendingPush) clearTimeout(SYNC.pendingPush);
  SYNC.pendingPush = setTimeout(doPush, SYNC.PUSH_DEBOUNCE_MS);
}

export async function doPush() {
  if (!SYNC.enabled || !SYNC.user) return false;
  if (!navigator.onLine) {
    setSyncStatus('offline', 'Offline');
    return false;
  }
  setSyncStatus('syncing', 'Saving');
  SYNC.pushInFlight = true;
  const tradeCount = (state.trades || []).length;
  const lastTrade = tradeCount > 0 ? state.trades[tradeCount - 1] : null;
  console.log('[sync push]', {
    tradeCount,
    lastTradeId: lastTrade?.id,
    lastTradeTicker: lastTrade?.ticker,
    sectorRatingCount: Object.keys(state.sectorRatings || {}).length,
    deviceId: SYNC.deviceId,
    userId: SYNC.user.id,
  });
  try {
    // Snapshot the state at this exact moment by deep-cloning before passing
    // to Supabase — eliminates state mutation between read and HTTP send.
    const snapshot = JSON.parse(JSON.stringify(state));
    const { data, error } = await SYNC.client
      .from('cockpit_state')
      .upsert({
        user_id: SYNC.user.id,
        state_json: snapshot,
        device_id: SYNC.deviceId,
      }, { onConflict: 'user_id' })
      .select();
    if (error) throw error;
    if (data && data[0]) {
      const returnedTrades = (data[0].state_json?.trades || []).length;
      console.log('[sync push] success — server returned', returnedTrades, 'trades in row');
      if (returnedTrades !== tradeCount) {
        console.warn('[sync push] MISMATCH: pushed', tradeCount, 'trades but server returned', returnedTrades);
      }
    }
    await syncTradesTableMirror(snapshot);
    SYNC.lastSyncAt = Date.now();
    setSyncStatus('synced');
    return true;
  } catch (e) {
    console.error('[sync push] FAILED:', e);
    setSyncStatus('error', 'Save failed');
    SYNC.lastError = e.message;
    return false;
  } finally {
    SYNC.pushInFlight = false;
  }
}

export async function syncTradesTableMirror(snapshot) {
  if (!SYNC.enabled || !SYNC.user) return;
  const trades = snapshot.trades || [];
  try {
    if (trades.length > 0) {
      const rows = trades.map(t => ({
        id: t.id,
        user_id: SYNC.user.id,
        mode: t.mode || 'swing',
        trade_date: t.date || null,
        ticker: t.ticker || null,
        setup: t.setup || null,
        direction: t.direction || null,
        entry: t.entry ?? null,
        contracts: t.contracts ?? null,
        status: t.status || 'open',
        exit: t.exit ?? null,
        exit_date: t.exit_date || null,
        grade: t.grade || null,
        trade_json: t,
        updated_at: t.updated_at || new Date().toISOString(),
      }));
      const { error } = await SYNC.client
        .from('trades')
        .upsert(rows, { onConflict: 'id' });
      if (error) {
        const minimalRows = trades.map(t => ({
          id: t.id,
          user_id: SYNC.user.id,
          trade_json: t,
          updated_at: t.updated_at || new Date().toISOString(),
        }));
        const { error: minimalError } = await SYNC.client
          .from('trades')
          .upsert(minimalRows, { onConflict: 'id' });
        if (minimalError) throw minimalError;
      }
      console.log('[sync trades mirror] upserted', rows.length, 'trade rows');
    }

    const deletedIds = Object.keys(snapshot.deletedTradeIds || {});
    if (deletedIds.length > 0) {
      const { error } = await SYNC.client
        .from('trades')
        .delete()
        .eq('user_id', SYNC.user.id)
        .in('id', deletedIds);
      if (error) throw error;
      console.log('[sync trades mirror] deleted', deletedIds.length, 'trade rows');
    }
  } catch (e) {
    console.warn('[sync trades mirror] skipped. Create an optional trades table to enable row-by-row trade viewing.', e);
  }
}

// Reconcile cloud state with local state on sign-in.
export async function reconcileOnSignIn() {
  const cloud = await pullCloudState();
  if (!cloud) {
    await doPush();
    return;
  }
  const STORAGE_KEY = window.STORAGE_KEY;
  const localRaw = localStorage.getItem(STORAGE_KEY);
  if (!localRaw) {
    Object.assign(state, cloud.state_json);
    saveStateLocal();
    refreshAllUI();
    return;
  }
  const cloudTime = new Date(cloud.updated_at).getTime();
  const localTime = Number(localStorage.getItem('mac_cockpit_local_save_ts') || 0);
  const sameDevice = cloud.device_id === SYNC.deviceId;
  const localTradeCount = (state.trades || []).length;
  const cloudTradeCount = (cloud.state_json?.trades || []).length;
  console.log('[sync reconcile]', { cloudTradeCount, localTradeCount, sameDevice });

  if (!sameDevice && cloudTime > localTime + 5000) {
    const useCloud = confirm(
      'Cloud has newer data from another device.\n\n' +
      `Cloud: ${new Date(cloud.updated_at).toLocaleString()} (${cloudTradeCount} trades)\n` +
      `Local: ${localTime ? new Date(localTime).toLocaleString() : 'unknown'} (${localTradeCount} trades)\n\n` +
      'Click OK to merge cloud + local (recommended).\n' +
      'Click Cancel to keep ONLY local data (push to cloud, replace cloud).'
    );
    if (useCloud) {
      const cloudClone = JSON.parse(JSON.stringify(cloud.state_json));
      const mergedDeleted = mergeDeletedTradeIds(state.deletedTradeIds, cloudClone.deletedTradeIds);
      const mergedTrades = mergeTradesArrays(state.trades || [], cloudClone.trades || [], mergedDeleted);
      Object.assign(state, cloudClone, { trades: mergedTrades, deletedTradeIds: mergedDeleted });
      saveStateLocal();
      schedulePush();
      refreshAllUI();
    } else {
      await doPush();
    }
  } else {
    // Local is current OR same-device — push, but defensively merge cloud changes.
    const cloudClone = JSON.parse(JSON.stringify(cloud.state_json));
    const mergedDeleted = mergeDeletedTradeIds(state.deletedTradeIds, cloudClone.deletedTradeIds);
    const mergedTrades = mergeTradesArrays(state.trades || [], cloudClone.trades || [], mergedDeleted);
    const marketContextChanged = shouldAdoptCloudMarketContext(cloudClone, cloud.updated_at, sameDevice);
    if (
      JSON.stringify(mergedTrades) !== JSON.stringify(state.trades || []) ||
      JSON.stringify(mergedDeleted) !== JSON.stringify(state.deletedTradeIds || {}) ||
      marketContextChanged
    ) {
      state.deletedTradeIds = mergedDeleted;
      state.trades = mergedTrades;
      if (marketContextChanged) adoptCloudMarketContext(cloudClone);
      saveStateLocal();
      refreshAllUI();
    }
    await doPush();
  }
}

// =====================================================================
// CROSS-DEVICE SYNC — pull cloud state when this tab is reactivated.
// Triggers: tab visibility, window focus, periodic poll (60s while visible).
// =====================================================================
export async function pullAndMergeIfNewer() {
  if (!SYNC.enabled || !SYNC.user) return;
  if (!navigator.onLine) return;
  if (SYNC.pendingPush || SYNC.pushInFlight) return;
  try {
    const cloud = await pullCloudState();
    if (!cloud) return;
    const cloudTime = new Date(cloud.updated_at).getTime();
    const localTime = Number(localStorage.getItem('mac_cockpit_local_save_ts') || 0);
    const sameDevice = cloud.device_id === SYNC.deviceId;
    const localTradeCount = (state.trades || []).length;
    const cloudTradeCount = (cloud.state_json?.trades || []).length;

    console.log('[sync pull]', {
      cloudTime: new Date(cloudTime).toLocaleTimeString(),
      localTime: localTime ? new Date(localTime).toLocaleTimeString() : 'never',
      sameDevice,
      cloudDevice: cloud.device_id,
      myDevice: SYNC.deviceId,
      cloudTradeCount,
      localTradeCount,
    });

    // Always merge trade IDs (safe — trade IDs are stable). Only replace
    // non-trade state if cloud is newer + from a different device.
    const cloudClone = JSON.parse(JSON.stringify(cloud.state_json));
    const mergedDeleted = mergeDeletedTradeIds(state.deletedTradeIds, cloudClone.deletedTradeIds);
    const mergedTrades = mergeTradesArrays(state.trades || [], cloudClone.trades || [], mergedDeleted);
    const tradesChanged = JSON.stringify(mergedTrades) !== JSON.stringify(state.trades || []) ||
      JSON.stringify(mergedDeleted) !== JSON.stringify(state.deletedTradeIds || {});
    const marketContextChanged = shouldAdoptCloudMarketContext(cloudClone, cloud.updated_at, sameDevice);

    let nonTradeChanged = false;
    if (!sameDevice && cloudTime > localTime + 5000) {
      console.info('[sync pull] Adopting newer cloud state from device', cloud.device_id);
      Object.assign(state, cloudClone, { trades: mergedTrades, deletedTradeIds: mergedDeleted });
      nonTradeChanged = true;
    } else if (tradesChanged) {
      console.info('[sync pull] Merging', mergedTrades.length - (state.trades || []).length, 'new trades from cloud');
      state.trades = mergedTrades;
      state.deletedTradeIds = mergedDeleted;
    }
    if (marketContextChanged && !nonTradeChanged) {
      console.info('[sync pull] Adopting newer market context from device', cloud.device_id);
      adoptCloudMarketContext(cloudClone);
    }

    if (tradesChanged || nonTradeChanged || marketContextChanged) {
      saveStateLocal();
      schedulePush();
      localStorage.setItem('mac_cockpit_local_save_ts', String(Date.now()));
      refreshAllUI();
      setSyncStatus('synced', 'Updated from cloud');
      setTimeout(() => setSyncStatus('synced'), 2500);
    }
  } catch (e) {
    console.warn('[sync] Pull-and-merge failed:', e);
  }
}

// ---------- Auto-sync triggers ----------
// Online/offline: clear/show offline banner.
window.addEventListener('online', () => {
  if (SYNC.user) {
    setSyncStatus('synced');
    schedulePush();
  }
});
window.addEventListener('offline', () => {
  if (SYNC.user) setSyncStatus('offline', 'Offline');
});

// Cross-device pull triggers.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pullAndMergeIfNewer();
});
window.addEventListener('focus', () => {
  pullAndMergeIfNewer();
});
setInterval(() => {
  if (!document.hidden) pullAndMergeIfNewer();
}, 60000);

// Bridge to legacy.js.
window.SYNC = SYNC;
window.getDeviceId = getDeviceId;
window.initSupabase = initSupabase;
window.setSyncStatus = setSyncStatus;
window.pullCloudState = pullCloudState;
window.schedulePush = schedulePush;
window.doPush = doPush;
window.syncTradesTableMirror = syncTradesTableMirror;
window.reconcileOnSignIn = reconcileOnSignIn;
window.pullAndMergeIfNewer = pullAndMergeIfNewer;
