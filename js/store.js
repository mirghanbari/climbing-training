// State lives in localStorage — that stays true even with sync on, so the app
// works in a gym with no signal. The Worker is a meeting point between devices,
// not the source of truth.

import { DEVICE_ORDER, DEVICES, WEEKS } from './program.js';

const KEY = 'climbing-training.v1';
// Sync config is deliberately a separate key: it holds a token, and it must
// never end up inside an exported backup file.
const SYNC_KEY = 'climbing-training.sync';

const SCHEMA_VERSION = 2;

// Blocks start on a Monday. Default to the next one so a fresh install is sane.
function nextMonday() {
  const d = new Date();
  const delta = (8 - (d.getDay() || 7)) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DEFAULT_STATE = {
  version: SCHEMA_VERSION,
  settings: {
    bodyweightLb: null,
    startDate: nextMonday(),
    tripName: 'Trip',
    tripDate: null,
    targets: { grippul: 74, block10: 55 }
  },
  settingsUpdatedAt: 0,
  tests: [],
  sessions: [],
  sends: []
};

const DEFAULT_SYNC = { url: '', token: '', cursor: 0, lastSyncedAt: null, lastError: null };

let state = load();
let sync = loadSync();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    return migrate(JSON.parse(raw));
  } catch (err) {
    console.error('[training] could not read saved data, starting fresh', err);
    return structuredClone(DEFAULT_STATE);
  }
}

// v1 had no per-record timestamps, which sync needs to resolve conflicts.
// Backfill from the record's own date so ordering stays roughly honest.
function migrate(parsed) {
  const base = structuredClone(DEFAULT_STATE);
  const out = {
    ...base,
    ...parsed,
    settings: {
      ...base.settings,
      ...(parsed.settings || {}),
      targets: { ...base.settings.targets, ...((parsed.settings || {}).targets || {}) }
    }
  };
  const stamp = (r) => {
    if (typeof r.updatedAt !== 'number') r.updatedAt = r.date ? Date.parse(`${r.date}T12:00:00Z`) || Date.now() : Date.now();
    if (typeof r.deleted !== 'boolean') r.deleted = false;
    return r;
  };
  out.tests = (out.tests || []).map(stamp);
  out.sends = (out.sends || []).map(stamp);
  out.sessions = (out.sessions || []).map((s) => {
    // Sessions get a natural key so two devices logging the same session
    // converge on one row instead of creating duplicates.
    if (!s.id || !/^w\d+d\d+$/.test(s.id)) s.id = `w${s.week}d${s.day}`;
    return stamp(s);
  });
  if (typeof out.settingsUpdatedAt !== 'number') out.settingsUpdatedAt = 0;
  out.version = SCHEMA_VERSION;
  return out;
}

function loadSync() {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    return raw ? { ...DEFAULT_SYNC, ...JSON.parse(raw) } : { ...DEFAULT_SYNC };
  } catch {
    return { ...DEFAULT_SYNC };
  }
}

function persist({ silent = false } = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('[training] could not save', err);
  }
  if (!silent) listeners.forEach((fn) => fn(state));
}

function persistSync() {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
  } catch (err) {
    console.error('[training] could not save sync config', err);
  }
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

export function update(fn) {
  state = fn(structuredClone(state));
  persist();
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const now = () => Date.now();

// A record arriving from the server may predate a field this client expects —
// an older app version, or a future schema change. Sorting must never throw.
const byDateAsc = (a, b) => String(a?.date || '').localeCompare(String(b?.date || ''));
const byDateDesc = (a, b) => String(b?.date || '').localeCompare(String(a?.date || ''));

/* ---------- live views (tombstones filtered out) ---------- */

export function liveTests() { return state.tests.filter((r) => !r.deleted); }
export function liveSessions() { return state.sessions.filter((r) => !r.deleted); }
export function liveSends() { return state.sends.filter((r) => !r.deleted); }

/* ---------- tests & maxes ---------- */

export function addTest({ device, valueLb, date, hand, notes }) {
  update((s) => {
    s.tests.push({
      id: uid(),
      device,
      valueLb: Number(valueLb),
      bodyweightLb: Number(s.settings.bodyweightLb) || null,
      date: date || today(),
      hand: hand || 'weaker',
      notes: notes || '',
      updatedAt: now(),
      deleted: false
    });
    s.tests.sort(byDateAsc);
    return s;
  });
}

export function removeTest(id) {
  update((s) => {
    const row = s.tests.find((t) => t.id === id);
    if (row) { row.deleted = true; row.updatedAt = now(); }
    return s;
  });
}

// Most recent test for a device on or before a cutoff date.
export function maxAsOf(device, cutoff) {
  const rows = liveTests()
    .filter((t) => t.device === device && t.date && (!cutoff || t.date <= cutoff))
    .sort(byDateAsc);
  return rows.length ? rows[rows.length - 1] : null;
}

export function latestMax(device) {
  return maxAsOf(device, null);
}

// Weeks 1–4 run off the pre-block baseline; weeks 5–8 re-price off the week-4
// retest, exactly like the workbook did.
export function maxForWeek(device, weekN) {
  const cutoff = weekN <= 4 ? addDays(state.settings.startDate, -1) : addDays(weekStart(5), -1);
  return maxAsOf(device, cutoff) || latestMax(device);
}

export function loadFor(device, weekN, pct) {
  const m = maxForWeek(device, weekN);
  if (!m || pct == null) return null;
  return round(m.valueLb * (pct / 100));
}

export function round(lb) {
  return Math.round(lb / 2.5) * 2.5; // nearest 2.5 lb — what you can actually load
}

/* ---------- schedule ---------- */

export function weekStart(weekN) {
  return addDays(state.settings.startDate, (weekN - 1) * 7);
}

export function sessionDate(weekN, dayN) {
  const offsets = { 1: 0, 2: 2, 3: 5 }; // Mon, Wed, Sat
  return addDays(weekStart(weekN), offsets[dayN] ?? 0);
}

export function currentWeek(ref) {
  const d = ref || today();
  const start = state.settings.startDate;
  if (d < start) return 0;
  const n = Math.floor(daysBetween(start, d) / 7) + 1;
  return n > WEEKS.length ? WEEKS.length + 1 : n;
}

export function nextSession() {
  for (const w of WEEKS) {
    for (const day of [1, 2, 3]) {
      if (!isLogged(w.n, day)) return { week: w, day };
    }
  }
  return null;
}

export function isLogged(weekN, dayN) {
  return liveSessions().some((s) => s.week === weekN && s.day === dayN);
}

export function sessionFor(weekN, dayN) {
  return liveSessions().find((s) => s.week === weekN && s.day === dayN) || null;
}

/* ---------- session logging ---------- */

export function saveSession(entry) {
  update((s) => {
    const id = `w${entry.week}d${entry.day}`;
    const idx = s.sessions.findIndex((x) => x.id === id);
    const row = { ...entry, id, updatedAt: now(), deleted: false };
    if (idx >= 0) s.sessions[idx] = row; else s.sessions.push(row);
    s.sessions.sort((a, b) => (a.week - b.week) || (a.day - b.day));
    return s;
  });
}

export function removeSession(weekN, dayN) {
  update((s) => {
    const row = s.sessions.find((x) => x.id === `w${weekN}d${dayN}`);
    if (row) { row.deleted = true; row.updatedAt = now(); }
    return s;
  });
}

/* ---------- sends ---------- */

export function addSend(send) {
  update((s) => {
    s.sends.push({ id: uid(), ...send, updatedAt: now(), deleted: false });
    s.sends.sort(byDateDesc);
    return s;
  });
}

export function removeSend(id) {
  update((s) => {
    const row = s.sends.find((x) => x.id === id);
    if (row) { row.deleted = true; row.updatedAt = now(); }
    return s;
  });
}

/* ---------- settings ---------- */

export function updateSettings(fn) {
  update((s) => {
    fn(s.settings);
    s.settingsUpdatedAt = now();
    return s;
  });
}

/* ---------- derived ---------- */

export function pctBw(valueLb, bw) {
  const w = bw || state.settings.bodyweightLb;
  if (!w || !valueLb) return null;
  return (valueLb / w) * 100;
}

export function targetLb(device) {
  const pct = state.settings.targets[device];
  if (!pct || !state.settings.bodyweightLb) return null;
  // Targets are a reference point, not a load to put on a pin — keep them exact.
  return Math.round(state.settings.bodyweightLb * (pct / 100) * 10) / 10;
}

/* ---------- sync plumbing ---------- */

const KIND_TO_LIST = { test: 'tests', session: 'sessions', send: 'sends' };

export function getSync() { return sync; }

export function setSync(patch) {
  sync = { ...sync, ...patch };
  persistSync();
}

export function resetSyncCursor() {
  setSync({ cursor: 0 });
}

/** Everything this device holds, in the wire format. */
export function collectChanges() {
  const out = [];
  for (const [kind, list] of Object.entries(KIND_TO_LIST)) {
    for (const r of state[list]) {
      out.push({ kind, id: r.id, payload: r, updatedAt: r.updatedAt || 0, deleted: Boolean(r.deleted) });
    }
  }
  if (state.settingsUpdatedAt) {
    out.push({ kind: 'settings', id: 'settings', payload: state.settings, updatedAt: state.settingsUpdatedAt, deleted: false });
  }
  return out;
}

/** Merge server changes in, last-write-wins on updatedAt. Returns how many landed. */
export function applyChanges(changes) {
  let applied = 0;
  state = structuredClone(state);

  for (const c of changes) {
    if (c.kind === 'settings') {
      if ((c.updatedAt || 0) > (state.settingsUpdatedAt || 0)) {
        state.settings = { ...state.settings, ...c.payload,
          targets: { ...state.settings.targets, ...((c.payload || {}).targets || {}) } };
        state.settingsUpdatedAt = c.updatedAt;
        applied += 1;
      }
      continue;
    }

    const listName = KIND_TO_LIST[c.kind];
    if (!listName) continue;
    const list = state[listName];
    const idx = list.findIndex((r) => r.id === c.id);
    const incoming = { ...c.payload, id: c.id, updatedAt: c.updatedAt, deleted: Boolean(c.deleted) };

    if (idx < 0) {
      list.push(incoming);
      applied += 1;
    } else if ((c.updatedAt || 0) > (list[idx].updatedAt || 0)) {
      list[idx] = incoming;
      applied += 1;
    }
  }

  state.tests.sort(byDateAsc);
  state.sends.sort(byDateDesc);
  state.sessions.sort((a, b) => (a.week - b.week) || (a.day - b.day));
  persist();
  return applied;
}

/* ---------- import / export ---------- */

export function exportJson() {
  // Never include the sync config — it holds a token.
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tests)) {
    throw new Error('That file does not look like a training export.');
  }
  state = migrate(parsed);
  persist();
}

export function resetAll() {
  state = structuredClone(DEFAULT_STATE);
  persist();
}

/* ---------- dates ---------- */

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const toUtc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined,
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function fmtShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined,
    { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function pad(n) { return String(n).padStart(2, '0'); }
