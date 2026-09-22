// State lives in localStorage. One key, one JSON blob, versioned so a future
// schema change can migrate rather than silently drop training history.

import { DEVICE_ORDER, DEVICES, WEEKS } from './program.js';

const KEY = 'climbing-training.v1';

// Blocks start on a Monday. Default to the next one so a fresh install is sane.
function nextMonday() {
  const d = new Date();
  const delta = (8 - (d.getDay() || 7)) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DEFAULT_STATE = {
  version: 1,
  settings: {
    bodyweightLb: null,
    startDate: nextMonday(),
    tripName: 'Trip',
    tripDate: null,
    targets: { grippul: 74, block10: 55 }
  },
  tests: [],
  sessions: [],
  sends: []
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}),
        targets: { ...DEFAULT_STATE.settings.targets, ...((parsed.settings || {}).targets || {}) } } };
  } catch (err) {
    console.error('[training] could not read saved data, starting fresh', err);
    return structuredClone(DEFAULT_STATE);
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.error('[training] could not save', err);
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
  const next = fn(structuredClone(state));
  state = next;
  persist();
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------- tests & maxes ---------- */

export function addTest({ device, valueLb, date, hand, notes }) {
  update((s) => {
    s.tests.push({
      id: uid(),
      device,
      valueLb: Number(valueLb),
      bodyweightLb: Number(s.settings.bodyweightLb),
      date: date || today(),
      hand: hand || 'weaker',
      notes: notes || ''
    });
    s.tests.sort((a, b) => a.date.localeCompare(b.date));
    return s;
  });
}

export function removeTest(id) {
  update((s) => { s.tests = s.tests.filter((t) => t.id !== id); return s; });
}

// Most recent test for a device on or before a cutoff date.
export function maxAsOf(device, cutoff) {
  const rows = state.tests
    .filter((t) => t.device === device && (!cutoff || t.date <= cutoff))
    .sort((a, b) => a.date.localeCompare(b.date));
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
  const diff = daysBetween(start, d);
  const n = Math.floor(diff / 7) + 1;
  return n > WEEKS.length ? WEEKS.length + 1 : n;
}

// The next session that has not been logged, scanning forward from week 1.
export function nextSession() {
  for (const w of WEEKS) {
    for (const day of [1, 2, 3]) {
      if (!isLogged(w.n, day)) return { week: w, day };
    }
  }
  return null;
}

export function isLogged(weekN, dayN) {
  return state.sessions.some((s) => s.week === weekN && s.day === dayN);
}

export function sessionFor(weekN, dayN) {
  return state.sessions.find((s) => s.week === weekN && s.day === dayN) || null;
}

/* ---------- session logging ---------- */

export function saveSession(entry) {
  update((s) => {
    const idx = s.sessions.findIndex((x) => x.week === entry.week && x.day === entry.day);
    const row = { id: entry.id || uid(), ...entry };
    if (idx >= 0) s.sessions[idx] = row; else s.sessions.push(row);
    s.sessions.sort((a, b) => (a.week - b.week) || (a.day - b.day));
    return s;
  });
}

export function removeSession(weekN, dayN) {
  update((s) => {
    s.sessions = s.sessions.filter((x) => !(x.week === weekN && x.day === dayN));
    return s;
  });
}

/* ---------- sends ---------- */

export function addSend(send) {
  update((s) => {
    s.sends.push({ id: uid(), ...send });
    s.sends.sort((a, b) => b.date.localeCompare(a.date));
    return s;
  });
}

export function removeSend(id) {
  update((s) => { s.sends = s.sends.filter((x) => x.id !== id); return s; });
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

/* ---------- import / export ---------- */

export function exportJson() {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tests)) {
    throw new Error('That file does not look like a training export.');
  }
  state = { ...structuredClone(DEFAULT_STATE), ...parsed };
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
