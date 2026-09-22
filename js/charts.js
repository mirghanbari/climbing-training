// Hand-rolled SVG charts. Palette slots come from CSS custom properties so the
// light/dark steps swap in one place.

const SERIES_VARS = ['--series-1', '--series-2', '--series-3'];

function el(tag, attrs = {}, kids = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  (Array.isArray(kids) ? kids : [kids]).forEach((k) => k && node.appendChild(k));
  return node;
}

function text(str, attrs = {}) {
  const n = el('text', attrs);
  n.textContent = str;
  return n;
}

function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 5; max += 5; }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/**
 * Multi-series line chart over time.
 * series: [{ id, label, color, points: [{x: isoDate, y: number}] }]
 * refLines: [{ y, label, color }]
 */
export function lineChart(host, { series, refLines = [], yLabel = '', formatY = (v) => v }) {
  host.textContent = '';
  const live = series.filter((s) => s.points.length);
  if (!live.length) {
    host.appendChild(emptyNote('No tests logged yet. Add one on the Progress tab and this chart starts drawing.'));
    return;
  }

  const W = 640, H = 300;
  const pad = { t: 16, r: 18, b: 34, l: 46 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const allX = [...new Set(live.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const toTime = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const x0 = toTime(allX[0]);
  const x1 = toTime(allX[allX.length - 1]);
  const xSpan = Math.max(x1 - x0, 86400000);

  const ys = live.flatMap((s) => s.points.map((p) => p.y)).concat(refLines.map((r) => r.y));
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];

  const sx = (iso) => pad.l + ((toTime(iso) - x0) / xSpan) * iw;
  const sy = (v) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': `${yLabel} over time for ${live.map((s) => s.label).join(', ')}`
  });

  // recessive grid
  ticks.forEach((t) => {
    svg.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: sy(t), y2: sy(t), class: 'grid-line' }));
    svg.appendChild(text(formatY(t), { x: pad.l - 8, y: sy(t) + 4, class: 'axis-label', 'text-anchor': 'end' }));
  });

  // x axis: first, middle-ish and last date only — no label soup
  const xLabels = allX.length <= 3 ? allX : [allX[0], allX[Math.floor(allX.length / 2)], allX[allX.length - 1]];
  xLabels.forEach((iso, i) => {
    const anchor = i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle';
    svg.appendChild(text(shortDate(iso), { x: sx(iso), y: H - 12, class: 'axis-label', 'text-anchor': anchor }));
  });

  // target reference lines
  refLines.forEach((r) => {
    svg.appendChild(el('line', {
      x1: pad.l, x2: W - pad.r, y1: sy(r.y), y2: sy(r.y), class: 'ref-line'
    }));
    svg.appendChild(text(r.label, { x: W - pad.r, y: sy(r.y) - 6, class: 'ref-label', 'text-anchor': 'end' }));
  });

  live.forEach((s) => {
    const pts = [...s.points].sort((a, b) => a.x.localeCompare(b.x));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    pts.forEach((p) => {
      svg.appendChild(el('circle', { cx: sx(p.x), cy: sy(p.y), r: 4.5, fill: s.color,
        stroke: 'var(--surface-1)', 'stroke-width': 2 }));
    });
    // direct label on the last point
    const last = pts[pts.length - 1];
    svg.appendChild(text(s.label, {
      x: Math.min(sx(last.x) + 8, W - pad.r), y: sy(last.y) - 10,
      class: 'series-label', 'text-anchor': sx(last.x) > W - 120 ? 'end' : 'start'
    }));
  });

  // crosshair + tooltip
  const cross = el('line', { class: 'crosshair', y1: pad.t, y2: pad.t + ih, opacity: 0 });
  svg.appendChild(cross);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;

  const hit = el('rect', { x: pad.l, y: pad.t, width: iw, height: ih, fill: 'transparent' });
  svg.appendChild(hit);

  svg.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.hidden = true; });
  svg.addEventListener('pointermove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    if (px < pad.l || px > W - pad.r) { cross.setAttribute('opacity', 0); tip.hidden = true; return; }
    let best = allX[0], bestD = Infinity;
    allX.forEach((iso) => { const d = Math.abs(sx(iso) - px); if (d < bestD) { bestD = d; best = iso; } });
    cross.setAttribute('x1', sx(best)); cross.setAttribute('x2', sx(best)); cross.setAttribute('opacity', 1);
    const rows = live.map((s) => {
      const p = s.points.find((q) => q.x === best);
      return p ? `<span class="tip-row"><i style="background:${s.color}"></i>${s.label} <b>${formatY(p.y)}</b></span>` : '';
    }).filter(Boolean).join('');
    tip.innerHTML = `<strong>${shortDate(best)}</strong>${rows}`;
    tip.hidden = false;
    const hostBox = host.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(ev.clientX - hostBox.left, 8), hostBox.width - 8)}px`;
    tip.style.top = `${Math.max(ev.clientY - hostBox.top - 12, 0)}px`;
  });

  host.appendChild(svg);
  host.appendChild(tip);
}

/**
 * Horizontal bar chart — one series, one color. Used for the grade pyramid.
 * rows: [{ label, value, highlight }]
 */
export function barChart(host, { rows, emptyText = 'Nothing logged yet.', formatV = (v) => v }) {
  host.textContent = '';
  if (!rows.length) { host.appendChild(emptyNote(emptyText)); return; }

  const rowH = 26, gap = 2;
  const W = 640;
  const pad = { t: 8, r: 46, b: 8, l: 62 };
  const H = pad.t + pad.b + rows.length * (rowH + gap);
  const iw = W - pad.l - pad.r;
  const max = Math.max(...rows.map((r) => r.value), 1);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': 'Sends by grade' });
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;

  rows.forEach((r, i) => {
    const y = pad.t + i * (rowH + gap);
    const w = Math.max((r.value / max) * iw, r.value ? 3 : 0);
    svg.appendChild(text(r.label, { x: pad.l - 10, y: y + rowH / 2 + 4,
      class: 'axis-label' + (r.highlight ? ' is-strong' : ''), 'text-anchor': 'end' }));
    if (w) {
      const bar = el('rect', { x: pad.l, y: y + 3, width: w, height: rowH - 6, rx: 4,
        fill: r.highlight ? 'var(--series-2)' : 'var(--series-1)' });
      bar.addEventListener('pointerenter', (ev) => {
        tip.innerHTML = `<strong>${r.label}</strong><span class="tip-row">${formatV(r.value)}</span>`;
        tip.hidden = false;
        const hb = host.getBoundingClientRect();
        tip.style.left = `${ev.clientX - hb.left}px`;
        tip.style.top = `${ev.clientY - hb.top - 12}px`;
      });
      bar.addEventListener('pointerleave', () => { tip.hidden = true; });
      svg.appendChild(bar);
    }
    svg.appendChild(text(formatV(r.value), { x: pad.l + w + 8, y: y + rowH / 2 + 4, class: 'axis-label' }));
  });

  host.appendChild(svg);
  host.appendChild(tip);
}

function emptyNote(msg) {
  const p = document.createElement('p');
  p.className = 'chart-empty';
  p.textContent = msg;
  return p;
}

function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined,
    { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function seriesColor(i) {
  return `var(${SERIES_VARS[i % SERIES_VARS.length]})`;
}
