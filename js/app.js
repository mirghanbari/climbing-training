import { DEVICES, DEVICE_ORDER, WEEKS, SESSIONS, RULES, GRADES, STYLES, pctFor } from './program.js';
import * as S from './store.js';
import { lineChart, barChart } from './charts.js';
import * as Sync from './sync.js';

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  (Array.isArray(kids) ? kids : [kids]).forEach((k) => {
    if (k == null || k === false) return;
    node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  });
  return node;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2400);
}

function restLabel(sec) {
  return sec >= 60 ? `${sec / 60} min rest` : `${sec}s rest`;
}

/* ---------- shared renderers ---------- */

function weekPill(week) {
  const cls = week.phase === 'Deload' ? 'is-deload' : week.phase === 'Peak' ? 'is-peak' : '';
  return h('span', { class: `pill ${cls}`, text: `${week.phase} · ${week.pct}%` });
}

// One exercise block, with the load resolved for this week.
function renderExercise(item, week) {
  const box = h('div', { class: 'exercise' });

  if (item.kind === 'warmup' || item.kind === 'accessory' || item.kind === 'interval') {
    box.appendChild(h('div', { class: 'ex-head' }, [h('div', { class: 'ex-title', text: item.label })]));
    if (item.cue) box.appendChild(h('p', { class: 'ex-cue', text: item.cue }));
    if (item.items) {
      box.appendChild(h('ul', { class: 'ex-list' }, item.items.map((t) => h('li', { text: t }))));
    }
    return box;
  }

  const pct = pctFor(item, week);
  const load = S.loadFor(item.device, week.n, pct);
  const dev = DEVICES[item.device];

  box.appendChild(h('div', { class: 'ex-head' }, [
    h('div', {}, [
      h('div', { class: 'ex-title', text: item.label }),
      h('div', { class: 'ex-prescription', text: prescription(item) })
    ]),
    h('div', { class: 'ex-load', html: load == null ? '<small>no max</small>'
      : `${load}<small> lb · ${Math.round(pct)}%</small>` })
  ]));

  if (load == null) {
    box.appendChild(h('p', { class: 'ex-missing',
      text: `No tested max for ${dev.name} yet — add one on the Progress tab and this load fills in.` }));
  }
  if (item.cue) box.appendChild(h('p', { class: 'ex-cue', text: item.cue }));
  return box;
}

function prescription(item) {
  const bits = [];
  if (item.repScheme) bits.push(`${item.sets} sets · ${item.repScheme}`);
  else if (item.sets && item.holdSec) bits.push(`${item.sets} × ${item.holdSec}s`);
  if (item.perHand) bits.push('each hand');
  if (item.restSec) bits.push(restLabel(item.restSec));
  return bits.join(' · ');
}

function renderSessionCard(week, day, { open = false } = {}) {
  const tpl = SESSIONS.find((s) => s.day === day);
  const date = S.sessionDate(week.n, day);
  const logged = S.sessionFor(week.n, day);

  const card = h('section', { class: 'card' });
  card.appendChild(h('div', { class: 'card-head' }, [
    h('div', {}, [
      h('p', { class: 'eyebrow', text: `${tpl.weekday} · ${S.fmtShort(date)} · Day ${day}` }),
      h('h2', { text: tpl.title })
    ]),
    logged ? h('span', { class: 'pill is-done', text: '✓ logged' }) : weekPill(week)
  ]));
  card.appendChild(h('p', { class: 'card-sub', text: tpl.focus }));
  if (tpl.climbing) card.appendChild(h('p', { class: 'note', text: tpl.climbing }));

  const body = h('div', {});
  tpl.blocks.forEach((b) => body.appendChild(renderExercise(b, week)));
  card.appendChild(body);

  card.appendChild(h('div', { class: 'btn-row' }, [
    h('button', {
      class: logged ? 'btn btn-sm' : 'btn btn-primary btn-sm',
      type: 'button',
      text: logged ? 'Edit log' : 'Log this session',
      onclick: () => openLogForm(card, week, day)
    }),
    logged && h('button', {
      class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete log',
      onclick: () => { S.removeSession(week.n, day); toast('Log deleted'); }
    })
  ]));

  if (logged) card.appendChild(renderLoggedSummary(logged));
  if (open) card.dataset.open = 'true';
  return card;
}

function renderLoggedSummary(entry) {
  const wrap = h('div', { class: 'note' });
  const bits = [];
  if (entry.date) bits.push(S.fmtDate(entry.date));
  if (entry.rpe) bits.push(`RPE ${entry.rpe}`);
  if (entry.pain != null) bits.push(`pain ${entry.pain}/10`);
  wrap.appendChild(h('div', { text: bits.join(' · ') }));
  if (entry.lifts?.length) {
    wrap.appendChild(h('div', { class: 'card-sub',
      text: entry.lifts.map((l) => `${DEVICES[l.device]?.short || l.device}: ${l.actualLb} lb`).join('  ·  ') }));
  }
  if (entry.notes) wrap.appendChild(h('div', { class: 'card-sub', text: entry.notes }));
  if (entry.pain >= 5) {
    wrap.className = 'note is-critical';
    wrap.appendChild(h('div', { class: 'card-sub', text: 'Pain 5+ — 72h off finger work.' }));
  } else if (entry.pain >= 3) {
    wrap.className = 'note is-warning';
  }
  return wrap;
}

function openLogForm(card, week, day) {
  if ($('.log-form', card)) { $('.log-form', card).remove(); return; }
  const tpl = SESSIONS.find((s) => s.day === day);
  const existing = S.sessionFor(week.n, day);
  const workItems = tpl.blocks.filter((b) => b.kind === 'work');

  const form = h('form', { class: 'log-form', onsubmit: (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const lifts = workItems.map((item, i) => ({
      device: item.device,
      label: item.label,
      targetLb: S.loadFor(item.device, week.n, pctFor(item, week)),
      actualLb: Number(fd.get(`lift${i}`)) || null
    })).filter((l) => l.actualLb);
    S.saveSession({
      week: week.n, day,
      date: fd.get('date'),
      rpe: Number(fd.get('rpe')) || null,
      pain: fd.get('pain') === '' ? null : Number(fd.get('pain')),
      lifts,
      notes: (fd.get('notes') || '').toString().trim()
    });
    toast('Session logged');
  } });

  form.appendChild(h('div', { class: 'field' }, [
    h('label', { for: `d-${week.n}-${day}`, text: 'Date' }),
    h('input', { type: 'date', id: `d-${week.n}-${day}`, name: 'date',
      value: existing?.date || S.sessionDate(week.n, day) })
  ]));

  workItems.forEach((item, i) => {
    const target = S.loadFor(item.device, week.n, pctFor(item, week));
    const prev = existing?.lifts?.find((l) => l.device === item.device);
    form.appendChild(h('div', { class: 'field' }, [
      h('label', { for: `l-${week.n}-${day}-${i}`,
        text: `${item.label} — actual load (target ${target != null ? target + ' lb' : '—'})` }),
      h('input', { type: 'number', step: '0.5', inputmode: 'decimal',
        id: `l-${week.n}-${day}-${i}`, name: `lift${i}`,
        placeholder: target != null ? String(target) : '', value: prev?.actualLb ?? '' })
    ]));
  });

  form.appendChild(h('div', { class: 'row' }, [
    h('div', { class: 'field' }, [
      h('label', { for: `rpe-${week.n}-${day}`, text: 'Session RPE' }),
      h('select', { id: `rpe-${week.n}-${day}`, name: 'rpe' },
        ['', 6, 7, 8, 9, 10].map((v) => h('option', { value: v, text: v === '' ? '—' : `RPE ${v}`,
          selected: existing?.rpe === v })))
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: `pain-${week.n}-${day}`, text: 'Pain (0–10)' }),
      h('select', { id: `pain-${week.n}-${day}`, name: 'pain' },
        ['', 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => h('option', { value: v,
          text: v === '' ? '—' : String(v), selected: existing?.pain === v })))
    ])
  ]));

  form.appendChild(h('div', { class: 'field' }, [
    h('label', { for: `n-${week.n}-${day}`, text: 'Notes' }),
    h('textarea', { id: `n-${week.n}-${day}`, name: 'notes',
      placeholder: 'How the holds felt, anything that tweaked, what you sent.' },
      existing?.notes || '')
  ]));

  form.appendChild(h('div', { class: 'btn-row' }, [
    h('button', { class: 'btn btn-primary', type: 'submit', text: 'Save session' }),
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => form.remove() })
  ]));

  card.appendChild(form);
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- views ---------- */

function viewToday(host) {
  host.textContent = '';
  const st = S.getState();
  const wk = S.currentWeek();
  const next = S.nextSession();

  // Phase banner
  if (wk === 0) {
    const days = S.daysBetween(S.today(), st.settings.startDate);
    host.appendChild(h('div', { class: 'card' }, [
      h('p', { class: 'eyebrow', text: 'Not started' }),
      h('h2', { text: `Block starts in ${days} day${days === 1 ? '' : 's'}` }),
      h('p', { class: 'card-sub', text: `Week 1 opens ${S.fmtDate(st.settings.startDate)}.` }),
      staleTestNote()
    ]));
  } else if (wk > WEEKS.length) {
    host.appendChild(h('div', { class: 'card' }, [
      h('p', { class: 'eyebrow', text: 'Block complete' }),
      h('h2', { text: 'Eight weeks done' }),
      h('p', { class: 'card-sub', text: 'Log the final test, then move to maintenance and route-specific work before the trip.' })
    ]));
  }

  if (!S.liveTests().length || !st.settings.bodyweightLb) {
    host.appendChild(h('div', { class: 'card' }, [
      h('p', { class: 'eyebrow', text: 'Start here' }),
      h('h2', { text: 'Set your numbers' }),
      h('p', { class: 'card-sub',
        text: 'Every load in this program is a percentage of a tested max, so nothing is prescribed until you enter one. Two steps, once.' }),
      h('ul', { class: 'rule-list' }, [
        h('li', { text: 'Setup → bodyweight, the Monday week 1 starts on, and your trip date.' }),
        h('li', { text: 'Progress → log a max test for the Grippūl and the Tension Block. Read the testing protocol on the Setup tab first.' })
      ]),
      h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn btn-primary', type: 'button', text: 'Go to Setup',
          onclick: () => { active = 'setup'; location.hash = 'setup'; render(); window.scrollTo({ top: 0 }); } }),
        h('button', { class: 'btn', type: 'button', text: 'Log a max test',
          onclick: () => { active = 'progress'; location.hash = 'progress'; render(); window.scrollTo({ top: 0 }); } })
      ])
    ]));
  }

  host.appendChild(renderStatTiles());

  if (next) {
    const w = next.week;
    host.appendChild(h('p', { class: 'eyebrow', text: `Up next — week ${w.n} of 8` }));
    host.appendChild(renderSessionCard(w, next.day, { open: true }));
    host.appendChild(h('div', { class: 'card' }, [
      h('h3', { text: `Week ${w.n} — ${w.phase}` }),
      h('p', { class: 'card-sub', text: w.note })
    ]));
  } else {
    host.appendChild(h('p', { class: 'empty', text: 'Every session in the block is logged. Time to retest and plan the trip.' }));
  }
}

// A max more than three weeks old prices the whole block wrong, so say so.
function staleTestNote() {
  const st = S.getState();
  const newest = ['grippul', 'block10']
    .map((id) => S.latestMax(id)?.date).filter(Boolean).sort().pop();
  if (!newest) return null;
  const age = S.daysBetween(newest, st.settings.startDate);
  if (age <= 21) return null;
  return h('p', { class: 'note is-warning',
    text: `Your most recent max test is ${age} days old by the time week 1 starts. Retest first — if you have been climbing since, it is low, and the whole block will be too easy.` });
}

function renderStatTiles() {
  const st = S.getState();
  const tiles = h('div', { class: 'tiles' });

  ['grippul', 'block10'].forEach((id) => {
    const m = S.latestMax(id);
    const target = S.targetLb(id);
    const pct = m ? S.pctBw(m.valueLb) : null;
    const gap = m && target ? target - m.valueLb : null;
    tiles.appendChild(h('div', { class: 'tile' }, [
      h('div', { class: 'tile-label', text: DEVICES[id].short + ' max' }),
      h('div', { class: 'tile-value', text: m ? `${m.valueLb} lb` : '—' }),
      h('div', { class: 'tile-meta' + (gap != null && gap <= 0 ? ' is-good' : ''),
        text: !m ? 'no test logged'
          : gap == null ? 'set bodyweight for % BW'
          : gap <= 0 ? `${pct.toFixed(1)}% BW · target met`
          : `${pct.toFixed(1)}% BW · ${gap.toFixed(1)} lb to target` })
    ]));
  });

  const done = S.liveSessions().length;
  tiles.appendChild(h('div', { class: 'tile' }, [
    h('div', { class: 'tile-label', text: 'Sessions logged' }),
    h('div', { class: 'tile-value', text: `${done}/24` }),
    h('div', { class: 'tile-meta', text: `${WEEKS.length} weeks × 3` })
  ]));

  if (st.settings.tripDate) {
    const days = S.daysBetween(S.today(), st.settings.tripDate);
    tiles.appendChild(h('div', { class: 'tile' }, [
      h('div', { class: 'tile-label', text: st.settings.tripName || 'Trip' }),
      h('div', { class: 'tile-value', text: `${days}d` }),
      h('div', { class: 'tile-meta', text: S.fmtDate(st.settings.tripDate) })
    ]));
  }

  return tiles;
}

let programWeek = null;

function viewProgram(host) {
  host.textContent = '';
  const cur = Math.min(Math.max(S.currentWeek() || 1, 1), WEEKS.length);
  if (programWeek == null) programWeek = cur;

  const nav = h('div', { class: 'week-nav' });
  WEEKS.forEach((w) => {
    const allDone = [1, 2, 3].every((d) => S.isLogged(w.n, d));
    nav.appendChild(h('button', {
      class: `week-chip${w.n === programWeek ? ' is-active' : ''}${allDone ? ' is-done' : ''}`,
      type: 'button',
      text: `Wk ${w.n}`,
      onclick: () => { programWeek = w.n; viewProgram(host); }
    }));
  });
  host.appendChild(nav);

  const week = WEEKS.find((w) => w.n === programWeek);
  host.appendChild(h('div', { class: 'card' }, [
    h('div', { class: 'card-head' }, [
      h('div', {}, [
        h('p', { class: 'eyebrow', text: `${S.fmtShort(S.weekStart(week.n))} – ${S.fmtShort(S.addDays(S.weekStart(week.n), 6))}` }),
        h('h2', { text: `Week ${week.n} — ${week.phase}` })
      ]),
      weekPill(week)
    ]),
    h('p', { class: 'card-sub', text: week.note }),
    week.retest ? h('p', { class: 'note is-warning',
      text: week.n === 4
        ? 'Retest at the end of this week. Weeks 5–8 re-price off the new numbers automatically — just add the test on the Progress tab.'
        : 'Final test at the end of this week. This is the number the trip prep is built on.' }) : null
  ]));

  [1, 2, 3].forEach((d) => host.appendChild(renderSessionCard(week, d)));
}

let progressUnit = 'lb';

function viewProgress(host) {
  host.textContent = '';
  const st = S.getState();

  host.appendChild(renderStatTiles());

  // --- add test form ---
  const form = h('form', { class: 'card', onsubmit: (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const val = Number(fd.get('value'));
    if (!val) { toast('Enter a weight'); return; }
    S.addTest({ device: fd.get('device'), valueLb: val, date: fd.get('date'),
      hand: fd.get('hand'), notes: fd.get('notes') });
    form.reset();
    $('[name=date]', form).value = S.today();
    toast('Test added — loads updated');
  } });
  form.appendChild(h('h2', { text: 'Log a max test' }));
  form.appendChild(h('p', { class: 'card-sub',
    text: 'Every prescribed load in the program is a percentage of these numbers. Add a test and the whole block re-prices itself.' }));
  form.appendChild(h('div', { class: 'row' }, [
    h('div', { class: 'field' }, [
      h('label', { for: 't-device', text: 'Device' }),
      h('select', { id: 't-device', name: 'device' },
        DEVICE_ORDER.map((id) => h('option', { value: id, text: DEVICES[id].name })))
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 't-value', text: 'Max (lb)' }),
      h('input', { type: 'number', step: '0.5', inputmode: 'decimal', id: 't-value', name: 'value', required: true })
    ])
  ]));
  form.appendChild(h('div', { class: 'row' }, [
    h('div', { class: 'field' }, [
      h('label', { for: 't-date', text: 'Date' }),
      h('input', { type: 'date', id: 't-date', name: 'date', value: S.today() })
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 't-hand', text: 'Hand' }),
      h('select', { id: 't-hand', name: 'hand' }, [
        h('option', { value: 'weaker', text: 'Weaker hand (use this)' }),
        h('option', { value: 'left', text: 'Left' }),
        h('option', { value: 'right', text: 'Right' })
      ])
    ])
  ]));
  form.appendChild(h('div', { class: 'field' }, [
    h('label', { for: 't-notes', text: 'Notes' }),
    h('input', { type: 'text', id: 't-notes', name: 'notes', placeholder: 'Optional' })
  ]));
  form.appendChild(h('div', { class: 'btn-row' }, [
    h('button', { class: 'btn btn-primary', type: 'submit', text: 'Add test' })
  ]));
  host.appendChild(form);

  // --- strength chart ---
  const chartCard = h('div', { class: 'card' });
  chartCard.appendChild(h('div', { class: 'card-head' }, [
    h('div', {}, [
      h('h2', { text: 'Max strength over time' }),
      h('p', { class: 'card-sub', text: progressUnit === 'lb'
        ? 'Pounds lifted. This only moves when you actually get stronger.'
        : 'Percent of bodyweight. Moves when your weight moves — read it with that in mind.' })
    ]),
    h('div', { class: 'seg' }, [
      h('button', { type: 'button', class: progressUnit === 'lb' ? 'is-active' : '', text: 'lb',
        onclick: () => { progressUnit = 'lb'; viewProgress(host); } }),
      h('button', { type: 'button', class: progressUnit === 'bw' ? 'is-active' : '', text: '% BW',
        onclick: () => { progressUnit = 'bw'; viewProgress(host); } })
    ])
  ]));

  const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
  const series = DEVICE_ORDER.map((id, i) => ({
    id,
    label: DEVICES[id].short,
    color: colors[i],
    points: S.liveTests().filter((t) => t.device === id).map((t) => ({
      x: t.date,
      y: progressUnit === 'lb' ? t.valueLb
        : Math.round(S.pctBw(t.valueLb, t.bodyweightLb) * 10) / 10
    }))
  }));

  const refLines = ['grippul', 'block10']
    .filter((id) => S.liveTests().some((t) => t.device === id))
    .map((id, i) => ({
      y: progressUnit === 'lb' ? S.targetLb(id) : DEVICES[id].targetPctBw,
      label: `${DEVICES[id].short} target`,
      color: colors[i]
    }));

  const chartHost = h('div', { class: 'chart-host' });
  chartCard.appendChild(chartHost);
  chartCard.appendChild(h('div', { class: 'legend' },
    series.filter((s) => s.points.length).map((s) =>
      h('span', {}, [h('i', { style: `background:${s.color}` }), s.label]))));
  chartCard.appendChild(h('p', { class: 'card-sub', style: 'margin-top:10px',
    text: 'Targets are Beastfingers benchmarks — a reference point, not a validated predictor of redpoint grade.' }));

  if (S.liveTests().length) {
    const t = h('table', {}, [
      h('thead', {}, h('tr', {}, [
        h('th', { text: 'Date' }), h('th', { text: 'Device' }),
        h('th', { text: 'Load' }), h('th', { text: '% BW' }), h('th', { text: '' })
      ])),
      h('tbody', {}, [...S.liveTests()].reverse().map((t2) => h('tr', {}, [
        h('td', { text: S.fmtShort(t2.date) }),
        h('td', { class: 'is-primary', text: DEVICES[t2.device]?.short || t2.device }),
        h('td', { text: `${t2.valueLb} lb` }),
        h('td', { text: `${S.pctBw(t2.valueLb, t2.bodyweightLb).toFixed(1)}%` }),
        h('td', {}, h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete',
          onclick: () => { S.removeTest(t2.id); toast('Test removed'); } }))
      ])))
    ]);
    chartCard.appendChild(h('details', { class: 'data-table' }, [
      h('summary', { text: `All tests (${S.liveTests().length})` }),
      h('div', { class: 'table-wrap' }, t)
    ]));
  }
  host.appendChild(chartCard);
  lineChart(chartHost, {
    series, refLines,
    yLabel: progressUnit === 'lb' ? 'Pounds' : 'Percent of bodyweight',
    formatY: (v) => progressUnit === 'lb' ? `${v}` : `${v}%`
  });

  // --- logged sessions ---
  if (S.liveSessions().length) {
    const rows = [...S.liveSessions()].reverse().map((s) => {
      const tpl = SESSIONS.find((x) => x.day === s.day);
      return h('tr', {}, [
        h('td', { text: S.fmtShort(s.date) }),
        h('td', { class: 'is-primary', text: `W${s.week} · ${tpl?.title || 'Session'}` }),
        h('td', { text: s.lifts?.map((l) => `${l.actualLb}`).join(' / ') || '—' }),
        h('td', { text: s.rpe ? `RPE ${s.rpe}` : '—' }),
        h('td', { text: s.pain != null ? `${s.pain}/10` : '—' })
      ]);
    });
    host.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: 'Session history' }),
      h('div', { class: 'table-wrap' }, h('table', {}, [
        h('thead', {}, h('tr', {}, [
          h('th', { text: 'Date' }), h('th', { text: 'Session' }),
          h('th', { text: 'Loads' }), h('th', { text: 'RPE' }), h('th', { text: 'Pain' })
        ])),
        h('tbody', {}, rows)
      ]))
    ]));
  }
}

function viewSends(host) {
  host.textContent = '';
  const st = S.getState();

  const hardest = S.liveSends().filter((s) => s.style !== 'Attempt')
    .map((s) => GRADES.indexOf(s.grade)).filter((i) => i >= 0).sort((a, b) => b - a)[0];

  host.appendChild(h('div', { class: 'tiles' }, [
    h('div', { class: 'tile' }, [
      h('div', { class: 'tile-label', text: 'Hardest send' }),
      h('div', { class: 'tile-value', text: hardest != null ? GRADES[hardest] : '—' }),
      h('div', { class: 'tile-meta', text: hardest != null && hardest >= GRADES.indexOf('5.13a') ? 'into the 13s' : 'goal: 5.13a' })
    ]),
    h('div', { class: 'tile' }, [
      h('div', { class: 'tile-label', text: 'Sends logged' }),
      h('div', { class: 'tile-value', text: String(S.liveSends().filter((s) => s.style !== 'Attempt').length) }),
      h('div', { class: 'tile-meta', text: `${S.liveSends().filter((s) => s.style === 'Attempt').length} attempts` })
    ])
  ]));

  const form = h('form', { class: 'card', onsubmit: (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    if (!fd.get('name')) { toast('Name the route'); return; }
    S.addSend({
      date: fd.get('date'), name: fd.get('name'), grade: fd.get('grade'),
      crag: fd.get('crag'), style: fd.get('style'), notes: fd.get('notes')
    });
    form.reset();
    $('[name=date]', form).value = S.today();
    toast('Send logged');
  } });
  form.appendChild(h('h2', { text: 'Log a route' }));
  form.appendChild(h('p', { class: 'card-sub', text: 'The finger numbers are the means. This is the end.' }));
  form.appendChild(h('div', { class: 'field' }, [
    h('label', { for: 's-name', text: 'Route' }),
    h('input', { type: 'text', id: 's-name', name: 'name', required: true, placeholder: 'Route name' })
  ]));
  form.appendChild(h('div', { class: 'row' }, [
    h('div', { class: 'field' }, [
      h('label', { for: 's-grade', text: 'Grade' }),
      h('select', { id: 's-grade', name: 'grade' },
        GRADES.map((g) => h('option', { value: g, text: g, selected: g === '5.12d' })))
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 's-style', text: 'Style' }),
      h('select', { id: 's-style', name: 'style' }, STYLES.map((x) => h('option', { value: x, text: x })))
    ])
  ]));
  form.appendChild(h('div', { class: 'row' }, [
    h('div', { class: 'field' }, [
      h('label', { for: 's-crag', text: 'Crag' }),
      h('input', { type: 'text', id: 's-crag', name: 'crag', placeholder: 'Optional' })
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 's-date', text: 'Date' }),
      h('input', { type: 'date', id: 's-date', name: 'date', value: S.today() })
    ])
  ]));
  form.appendChild(h('div', { class: 'field' }, [
    h('label', { for: 's-notes', text: 'Notes' }),
    h('input', { type: 'text', id: 's-notes', name: 'notes', placeholder: 'Crux, conditions, what held you back' })
  ]));
  form.appendChild(h('div', { class: 'btn-row' }, [
    h('button', { class: 'btn btn-primary', type: 'submit', text: 'Add' })
  ]));
  host.appendChild(form);

  // pyramid
  const counts = new Map();
  S.liveSends().filter((s) => s.style !== 'Attempt').forEach((s) => {
    counts.set(s.grade, (counts.get(s.grade) || 0) + 1);
  });
  const firstIdx = GRADES.indexOf('5.11a');
  const rows = GRADES.slice(firstIdx).map((g) => ({
    label: g, value: counts.get(g) || 0,
    highlight: hardest != null && g === GRADES[hardest]
  })).filter((r, i, arr) => r.value > 0 || arr.slice(i).some((x) => x.value > 0)).reverse();

  const pyCard = h('div', { class: 'card' }, [
    h('h2', { text: 'Grade pyramid' }),
    h('p', { class: 'card-sub', text: 'A 5.13a is built on a wide base of 12s. If the pyramid is a spike, the answer is volume, not more hangboarding.' })
  ]);
  const pyHost = h('div', { class: 'chart-host' });
  pyCard.appendChild(pyHost);
  host.appendChild(pyCard);
  barChart(pyHost, { rows, emptyText: 'No sends logged yet.', formatV: (v) => v ? String(v) : '' });

  if (S.liveSends().length) {
    host.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: 'Send log' }),
      h('div', { class: 'table-wrap' }, h('table', {}, [
        h('thead', {}, h('tr', {}, [
          h('th', { text: 'Date' }), h('th', { text: 'Route' }), h('th', { text: 'Grade' }),
          h('th', { text: 'Style' }), h('th', { text: 'Crag' }), h('th', { text: '' })
        ])),
        h('tbody', {}, S.liveSends().map((s) => h('tr', {}, [
          h('td', { text: S.fmtShort(s.date) }),
          h('td', { class: 'is-primary', text: s.name }),
          h('td', { text: s.grade }),
          h('td', { text: s.style }),
          h('td', { text: s.crag || '—' }),
          h('td', {}, h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete',
            onclick: () => { S.removeSend(s.id); toast('Removed'); } }))
        ])))
      ]))
    ]));
  }
}

function viewSetup(host) {
  host.textContent = '';
  const st = S.getState();

  const form = h('form', { class: 'card', onsubmit: (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    S.updateSettings((set) => {
      set.bodyweightLb = Number(fd.get('bw')) || set.bodyweightLb;
      set.startDate = fd.get('start');
      set.tripName = fd.get('tripName');
      set.tripDate = fd.get('tripDate') || null;
      set.targets.grippul = Number(fd.get('tGrippul'));
      set.targets.block10 = Number(fd.get('tBlock'));
    });
    toast('Saved');
  } });
  form.appendChild(h('h2', { text: 'Setup' }));
  form.appendChild(h('div', { class: 'row' }, [
    h('div', { class: 'field' }, [
      h('label', { for: 'bw', text: 'Bodyweight (lb)' }),
      h('input', { type: 'number', step: '0.5', inputmode: 'decimal', id: 'bw', name: 'bw',
        value: st.settings.bodyweightLb ?? '', placeholder: 'e.g. 148' })
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'start', text: 'Week 1 starts (Monday)' }),
      h('input', { type: 'date', id: 'start', name: 'start', value: st.settings.startDate })
    ])
  ]));
  form.appendChild(h('div', { class: 'row' }, [
    h('div', { class: 'field' }, [
      h('label', { for: 'tripName', text: 'Trip' }),
      h('input', { type: 'text', id: 'tripName', name: 'tripName', value: st.settings.tripName })
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'tripDate', text: 'Trip date' }),
      h('input', { type: 'date', id: 'tripDate', name: 'tripDate', value: st.settings.tripDate || '' })
    ])
  ]));
  form.appendChild(h('div', { class: 'row' }, [
    h('div', { class: 'field' }, [
      h('label', { for: 'tGrippul', text: 'Grippūl target (% BW)' }),
      h('input', { type: 'number', step: '0.5', id: 'tGrippul', name: 'tGrippul', value: st.settings.targets.grippul })
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'tBlock', text: 'Block 10mm target (% BW)' }),
      h('input', { type: 'number', step: '0.5', id: 'tBlock', name: 'tBlock', value: st.settings.targets.block10 })
    ])
  ]));
  form.appendChild(h('p', { class: 'field-hint',
    text: 'Changing bodyweight moves the % BW readouts and the targets. It does not change a single training load — those come off your tested maxes.' }));
  form.appendChild(h('div', { class: 'btn-row' }, [
    h('button', { class: 'btn btn-primary', type: 'submit', text: 'Save' })
  ]));
  host.appendChild(form);

  RULES.forEach((r) => {
    host.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: r.title }),
      h('ul', { class: 'rule-list' }, r.body.map((b) => h('li', { text: b })))
    ]));
  });

  host.appendChild(renderSyncCard());

  // data management
  const data = h('div', { class: 'card' }, [
    h('h2', { text: 'Your data' }),
    h('p', { class: 'card-sub',
      text: Sync.isConfigured()
        ? 'Saved in this browser and synced to your own Cloudflare Worker — nowhere else. Clearing site data wipes this device, but a sync restores it.'
        : 'Stored in this browser only — nothing is uploaded anywhere. Clearing site data wipes it, so export now and then.' })
  ]);
  const fileInput = h('input', { type: 'file', accept: 'application/json', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        S.importJson(await file.text());
        toast('Imported');
      } catch (err) {
        toast(err.message || 'Import failed');
      }
      e.target.value = '';
    } });
  data.appendChild(h('div', { class: 'btn-row' }, [
    h('button', { class: 'btn', type: 'button', text: 'Export JSON', onclick: () => {
      const blob = new Blob([S.exportJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `finger-training-${S.today()}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Exported');
    } }),
    h('button', { class: 'btn', type: 'button', text: 'Import JSON', onclick: () => fileInput.click() }),
  ]));
  data.appendChild(fileInput);

  let armed = false;
  const resetBtn = h('button', { class: 'btn btn-danger', type: 'button', text: 'Reset everything',
    onclick: () => {
      if (!armed) {
        armed = true;
        resetBtn.textContent = 'Tap again to erase all data';
        setTimeout(() => { armed = false; resetBtn.textContent = 'Reset everything'; }, 4000);
        return;
      }
      S.resetAll();
      toast('Reset');
    } });
  data.appendChild(h('div', { class: 'btn-row' }, [resetBtn]));
  host.appendChild(data);
}

function renderSyncCard() {
  const cfg = S.getSync();
  const st = Sync.getStatus();
  const card = h('div', { class: 'card' });

  const pillClass = st.status === 'ok' ? 'is-done' : st.status === 'error' ? 'is-peak' : '';
  const pillText = st.status === 'off' ? 'not connected'
    : st.status === 'syncing' ? 'syncing…'
    : st.status === 'error' ? 'error'
    : 'connected';

  card.appendChild(h('div', { class: 'card-head' }, [
    h('h2', { text: 'Sync across devices' }),
    h('span', { class: `pill ${pillClass}`, text: pillText })
  ]));
  card.appendChild(h('p', { class: 'card-sub',
    text: 'Optional. Your log is saved on this device either way — this keeps your phone and laptop in step. Issue a token per device from the server project.' }));

  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const url = String(fd.get('url') || '').trim();
    const token = String(fd.get('token') || '').trim();
    if (!url || !token) { toast('Need both a URL and a token'); return; }
    const btn = $('[type=submit]', form);
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      await Sync.testConnection(url, token);
      S.setSync({ url, token, lastError: null });
      toast('Connected');
      await Sync.syncNow();
    } catch (err) {
      toast(err.message || 'Could not connect');
      btn.disabled = false; btn.textContent = 'Connect';
    }
  } });

  form.appendChild(h('div', { class: 'field' }, [
    h('label', { for: 'sync-url', text: 'Worker URL' }),
    h('input', { type: 'url', id: 'sync-url', name: 'url', value: cfg.url || '',
      placeholder: 'https://climbing-training-sync.<you>.workers.dev', autocomplete: 'off' })
  ]));
  form.appendChild(h('div', { class: 'field' }, [
    h('label', { for: 'sync-token', text: 'Device token' }),
    h('input', { type: 'password', id: 'sync-token', name: 'token', value: cfg.token || '',
      placeholder: 'ct_…', autocomplete: 'off', spellcheck: 'false' }),
    h('p', { class: 'field-hint',
      text: 'Stored only in this browser, and deliberately left out of JSON exports.' })
  ]));

  const actions = [h('button', { class: 'btn btn-primary', type: 'submit', text: cfg.url ? 'Reconnect' : 'Connect' })];
  if (Sync.isConfigured()) {
    actions.push(h('button', { class: 'btn', type: 'button', text: 'Sync now',
      onclick: async () => { await Sync.syncNow(); } }));
    actions.push(h('button', { class: 'btn btn-danger', type: 'button', text: 'Disconnect',
      onclick: () => {
        S.setSync({ url: '', token: '', cursor: 0, lastSyncedAt: null, lastError: null });
        toast('Disconnected — your data stays on this device');
      } }));
  }
  form.appendChild(h('div', { class: 'btn-row' }, actions));
  card.appendChild(form);

  if (st.message) {
    card.appendChild(h('p', { class: `note${st.status === 'error' ? ' is-critical' : ''}`, text: st.message }));
  }
  if (cfg.lastSyncedAt) {
    const mins = Math.round((Date.now() - cfg.lastSyncedAt) / 60000);
    card.appendChild(h('p', { class: 'field-hint',
      text: `Last synced ${mins < 1 ? 'just now' : mins === 1 ? '1 minute ago' : `${mins} minutes ago`}.` }));
  }
  return card;
}

/* ---------- shell ---------- */

const VIEWS = { today: viewToday, program: viewProgram, progress: viewProgress, sends: viewSends, setup: viewSetup };
let active = 'today';

function render() {
  const st = S.getState();
  const wk = S.currentWeek();
  const week = WEEKS.find((w) => w.n === wk);
  const trip = st.settings.tripDate
    ? ` · ${S.daysBetween(S.today(), st.settings.tripDate)} days to ${st.settings.tripName || 'trip'}`
    : '';
  $('#phase-strip').textContent = wk === 0
    ? `Starts ${S.fmtShort(st.settings.startDate)}${trip}`
    : week
      ? `Week ${wk} of 8 · ${week.phase} · ${week.pct}%`
      : `Block complete${trip}`;

  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== active; });
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === active));
  VIEWS[active]($(`#view-${active}`));
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  active = tab.dataset.view;
  location.hash = active;
  render();
  window.scrollTo({ top: 0 });
}));

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (VIEWS[v]) { active = v; render(); }
});

// theme toggle — remembered per browser, falls back to the OS setting
const THEME_KEY = 'climbing-training.theme';
function applyTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch {}
$('#theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? null : 'dark';
  applyTheme(next);
  try { next ? localStorage.setItem(THEME_KEY, next) : localStorage.removeItem(THEME_KEY); } catch {}
  render();
});

// Any local change schedules a push; the status chip reflects what happened.
S.subscribe(() => { render(); Sync.scheduleSync(); });
Sync.onStatus(() => renderSyncChip());

function renderSyncChip() {
  const chip = $('#sync-chip');
  if (!chip) return;
  const st = Sync.getStatus();
  chip.hidden = st.status === 'off';
  chip.className = `sync-chip is-${st.status}`;
  chip.textContent = st.status === 'syncing' ? 'Syncing…'
    : st.status === 'error' ? 'Sync failed'
    : st.status === 'ok' ? 'Synced'
    : '';
  chip.title = st.message || '';
}

const initial = location.hash.slice(1);
if (VIEWS[initial]) active = initial;

render();
renderSyncChip();
Sync.start();
