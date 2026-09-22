// Client half of the sync protocol.
//
// Offline-first by design: every change is already saved locally before sync is
// involved, so a failed sync is an inconvenience, never data loss.

import * as S from './store.js';

const STATUS = { idle: 'idle', syncing: 'syncing', ok: 'ok', error: 'error', off: 'off' };

let status = STATUS.off;
let message = '';
let debounceTimer = null;
let inFlight = null;
const listeners = new Set();

export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(next, msg = '') {
  status = next;
  message = msg;
  listeners.forEach((fn) => fn({ status, message }));
}

export function getStatus() {
  const cfg = S.getSync();
  if (!cfg.url || !cfg.token) return { status: STATUS.off, message: '', lastSyncedAt: null };
  return { status, message, lastSyncedAt: cfg.lastSyncedAt };
}

export function isConfigured() {
  const cfg = S.getSync();
  return Boolean(cfg.url && cfg.token);
}

function endpoint(path) {
  const base = S.getSync().url.replace(/\/+$/, '');
  return `${base}${path}`;
}

async function call(path, { method = 'GET', body } = {}) {
  const cfg = S.getSync();
  const res = await fetch(endpoint(path), {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) throw new Error('Token rejected. Issue a new one and paste it in again.');
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch { /* body was not JSON */ }
    throw new Error(detail || `Server returned ${res.status}`);
  }
  return res.json();
}

/** Verify a URL and token before saving them. */
export async function testConnection(url, token) {
  const base = url.replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/whoami`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error('That token was rejected.');
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

/**
 * One full sync. Pushes everything this device holds and pulls anything newer
 * than the stored cursor, paging until the server says it is done.
 *
 * Pushing the whole dataset each time is deliberate: it is a few kilobytes at
 * this scale, and it makes sync idempotent rather than dependent on correctly
 * tracking which records are dirty.
 */
export async function syncNow({ silent = false } = {}) {
  if (!isConfigured()) return { skipped: 'not configured' };
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (!silent) setStatus(STATUS.syncing, 'Syncing…');
    try {
      let changes = S.collectChanges();
      let pulled = 0;
      let pages = 0;

      for (;;) {
        const cursor = S.getSync().cursor || 0;
        const res = await call('/v1/sync', { method: 'POST', body: { cursor, changes } });
        changes = []; // only push on the first page

        if (Array.isArray(res.changes) && res.changes.length) {
          pulled += S.applyChanges(res.changes);
        }
        S.setSync({ cursor: res.cursor ?? cursor });

        pages += 1;
        if (!res.hasMore || pages > 20) break;
      }

      S.setSync({ lastSyncedAt: Date.now(), lastError: null });
      setStatus(STATUS.ok, pulled ? `Synced — ${pulled} update${pulled === 1 ? '' : 's'} pulled` : 'Synced');
      return { pulled };
    } catch (err) {
      const msg = err?.message || 'Sync failed';
      S.setSync({ lastError: msg });
      setStatus(STATUS.error, msg);
      console.error('[sync]', err);
      return { error: msg };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Coalesce bursts of edits into one sync. */
export function scheduleSync(delay = 2500) {
  if (!isConfigured()) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncNow({ silent: true }), delay);
}

export function start() {
  if (!isConfigured()) return;
  syncNow({ silent: true });
  window.addEventListener('online', () => syncNow({ silent: true }));
  // Catch the case where the phone was locked mid-session.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(800);
  });
}

export { STATUS };
