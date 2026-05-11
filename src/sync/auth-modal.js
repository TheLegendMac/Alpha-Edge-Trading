// Auth modal flow + sync menu. Talks to the Supabase client through sync/supabase.js.

import { state } from '../state/store.js';
import {
  SYNC,
  initSupabase,
  setSyncStatus,
  reconcileOnSignIn,
  pullAndMergeIfNewer,
  doPush,
} from './supabase.js';

export function ensureAuthModal() {
  if (document.getElementById('auth-modal')) return;
  document.body.insertAdjacentHTML('afterbegin', `
    <div id="auth-modal" class="auth-modal-backdrop">
      <div class="auth-modal-card">
        <div class="auth-modal-head">
          <div class="auth-modal-title">Trapper's Edge</div>
          <div style="font-family: var(--mono); font-size: 11px; font-weight: 700; color: var(--cyan); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 12px;">Take Risk &amp; Prosper</div>
          <div class="auth-modal-subtitle">Sign in to sync across devices</div>
        </div>
        <div class="auth-field">
          <label for="auth-email">Email</label>
          <input type="email" id="auth-email" placeholder="you@example.com" />
        </div>
        <div class="auth-field">
          <label for="auth-password">Password</label>
          <input type="password" id="auth-password" placeholder="Password" autocomplete="current-password" />
        </div>
        <div id="auth-error" class="auth-error"></div>
        <div class="auth-actions">
          <button id="auth-signin-btn" class="auth-primary" type="button">Sign In</button>
          <button id="auth-signup-btn" class="auth-secondary" type="button">Sign Up</button>
        </div>
        <div class="auth-skip-row">
          <button id="auth-skip-btn" type="button">Continue without sync (local-only)</button>
        </div>
      </div>
    </div>
  `);

  document.getElementById('auth-signin-btn')?.addEventListener('click', handleSignIn);
  document.getElementById('auth-signup-btn')?.addEventListener('click', handleSignUp);
  document.getElementById('auth-skip-btn')?.addEventListener('click', handleSkipAuth);
  ['auth-email', 'auth-password'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleSignIn();
    });
  });
}

export function showAuthModal() {
  ensureAuthModal();
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'flex';
}

export function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
}

export function showAuthError(msg) {
  ensureAuthModal();
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

export function clearAuthError() {
  const el = document.getElementById('auth-error');
  if (el) el.style.display = 'none';
}

export async function handleSignIn() {
  clearAuthError();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) return showAuthError('Email and password required.');
  if (!SYNC.client && !(await initSupabase())) return showAuthError('Cloud sync not configured.');
  if (!SYNC.client) return showAuthError('Cloud sync not configured.');
  try {
    const { data, error } = await SYNC.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    SYNC.user = { id: data.user.id, email: data.user.email };
    hideAuthModal();
    setSyncStatus('syncing', 'Connecting');
    await reconcileOnSignIn();
    localStorage.setItem('mac_cockpit_skip_auth', 'false');
  } catch (e) {
    showAuthError(e.message || 'Sign-in failed.');
  }
}

export async function handleSignUp() {
  clearAuthError();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) return showAuthError('Email and password required.');
  if (password.length < 6) return showAuthError('Password must be at least 6 characters.');
  if (!SYNC.client && !(await initSupabase())) return showAuthError('Cloud sync not configured.');
  if (!SYNC.client) return showAuthError('Cloud sync not configured.');
  try {
    const { data, error } = await SYNC.client.auth.signUp({ email, password });
    if (error) throw error;
    if (data.user && !data.session) {
      showAuthError('Account created. Check your email to confirm, then sign in.');
      return;
    }
    if (data.session) {
      SYNC.user = { id: data.user.id, email: data.user.email };
      hideAuthModal();
      setSyncStatus('syncing', 'Connecting');
      await reconcileOnSignIn();
    }
  } catch (e) {
    showAuthError(e.message || 'Sign-up failed.');
  }
}

export function handleSkipAuth() {
  hideAuthModal();
  localStorage.setItem('mac_cockpit_skip_auth', 'true');
  setSyncStatus('local', 'Local only');
}

// Sync pill menu — tapped from the cmdbar.
export async function showSyncMenu() {
  if (!SYNC.enabled && !(await initSupabase())) {
    alert('Cloud sync is not configured.\n\nEdit the SUPABASE_CONFIG block at the top of Cockpit.html and add your project URL + anon key.');
    return;
  }
  if (!SYNC.user) {
    showAuthModal();
    return;
  }
  const lines = [
    `Signed in as: ${SYNC.user.email}`,
    `Status: ${SYNC.status}`,
    SYNC.lastSyncAt ? `Last sync: ${new Date(SYNC.lastSyncAt).toLocaleString()}` : 'Never synced',
    SYNC.lastError ? `Last error: ${SYNC.lastError}` : '',
    '',
    'OK to refresh Supabase now.',
    'Cancel keeps the current session signed in.',
  ].filter(Boolean).join('\n');
  if (confirm(lines)) {
    manualSupabaseRefresh();
  }
}

export async function manualSupabaseRefresh() {
  if (!SYNC.enabled) {
    alert('Cloud sync is not configured.');
    return;
  }
  if (!SYNC.user) {
    showAuthModal();
    return;
  }
  try {
    setSyncStatus('syncing', 'Refreshing');
    if (SYNC.pendingPush) {
      clearTimeout(SYNC.pendingPush);
      SYNC.pendingPush = null;
    }
    await pullAndMergeIfNewer();
    const pushed = await doPush();
    if (!pushed) throw new Error(SYNC.lastError || 'Supabase push failed');
    // toast() is still in legacy.js — reach via window.
    if (typeof window.toast === 'function') {
      window.toast(`Supabase refreshed: ${(state.trades || []).length} trades synced`);
    }
  } catch (e) {
    console.warn('[sync refresh] failed:', e);
    setSyncStatus('error', 'Refresh failed');
    if (typeof window.toast === 'function') {
      window.toast('Supabase refresh failed. Check console for details.', true);
    }
  }
}

// Bootstrap auth flow on page load. Called from init() in legacy.js.
export async function bootstrapAuth() {
  const skip = localStorage.getItem('mac_cockpit_skip_auth') === 'true';
  if (skip) {
    setSyncStatus('local', 'Local only');
    return;
  }
  if (!(await initSupabase())) return;  // No config — stay local-only
  try {
    const { data } = await SYNC.client.auth.getSession();
    if (data.session) {
      SYNC.user = { id: data.session.user.id, email: data.session.user.email };
      setSyncStatus('syncing', 'Connecting');
      await reconcileOnSignIn();
      return;
    }
  } catch (e) {
    console.warn('Session check failed:', e);
  }
  showAuthModal();
}

// Bridge to legacy.js.
window.showAuthModal = showAuthModal;
window.ensureAuthModal = ensureAuthModal;
window.hideAuthModal = hideAuthModal;
window.showAuthError = showAuthError;
window.clearAuthError = clearAuthError;
window.handleSignIn = handleSignIn;
window.handleSignUp = handleSignUp;
window.handleSkipAuth = handleSkipAuth;
window.showSyncMenu = showSyncMenu;
window.manualSupabaseRefresh = manualSupabaseRefresh;
window.bootstrapAuth = bootstrapAuth;
