// charts.js — Zero-dependency plain-SVG responsive & print-safe charts (donut, bar, stacked/grouped bar, line).
// All colors and typography are written directly onto SVG primitives so cloned <svg> nodes print identically in PDF/Print.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const CHART_PALETTE = [
  '#323A85', // Primary indigo
  '#0F766E', // Emerald teal
  '#D97706', // Warm amber
  '#0284C7', // Sky blue
  '#7C3AED', // Violet
  '#16A34A', // Success green
  '#DC2626', // Alert red
  '#EC4899', // Rose
  '#EA580C', // Orange
  '#0891B2'  // Cyan
];

function svgEl(tag, attrs = {}, text = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  }
  if (text !== null && text !== undefined) el.textContent = String(text);
  return el;
}

function htmlEl(tag, cls = '', text = null) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== null && text !== undefined) el.textContent = String(text);
  return el;
}

function defaultFmt(v) {
  return Math.round(Number(v || 0)).toLocaleString('en-IN');
}

function ensureContainer(host, extraCls = '') {
  if (!host) return null;
  host.innerHTML = '';
  const wrap = htmlEl('div', `uich-wrap ${extraCls}`.trim());
  const tip = htmlEl('div', 'uich-tooltip');
  tip.hidden = true;
  wrap.appendChild(tip);
  host.appendChild(wrap);
  return {
    wrap,
    tip,
    showTip(ev, title, detail) {
      tip.innerHTML = '';
      tip.appendChild(htmlEl('div', 'uich-tip-title', title));
      if (detail) tip.appendChild(htmlEl('div', 'uich-tip-val', detail));
      tip.hidden = false;
      const r = wrap.getBoundingClientRect();
      const x = Math.max(8, Math.min(r.width - 170, (ev.clientX - r.left) + 12));
      const y = Math.max(6, (ev.clientY - r.top) - 38);
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    },
    hideTip() {
      tip.hidden = true;
    }
  };
}

function renderEmptyState(host, text = 'No data') {
  if (!host) return;
  host.innerHTML = '';
  const empty = htmlEl('div', 'uich-empty');
  empty.innerHTML =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9" opacity="0.35" stroke-dasharray="3 3"></circle>' +
      '<line x1="8" y1="12" x2="16" y2="12"></line>' +
    '</svg>';
  empty.appendChild(htmlEl('span', 'uich-empty-text', text));
  host.appendChild(empty);
}

function niceTicks(maxVal, count = 4) {
  const m = Math.max(1, Number(maxVal || 0));
  const rawStep = m / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step = 1 * mag;
  if (norm > 5) step = 10 * mag;
  else if (norm > 2) step = 5 * mag;
  else if (norm > 1) step = 2 * mag;
  const top = Math.max(step * count, Math.ceil(m / step) * step);
  const ticks = [];
  for (let i = 0; i <= count; i++) {
    ticks.push(Math.round((top / count) * i));
  }
  return { top, ticks };
}

function shortAxisNum(v) {
  const n = Number(v || 0);
  if (n >= 10000000) return (n / 10000000).toFixed(1).replace(/\.0$/, '') + 'Cr';
  if (n >= 100000) return (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

function truncLabel(s, max = 14) {
  const str = String(s || '');
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Plain-SVG Donut / Pie Chart with center readout, hover tooltips, and legend.
 */
export function renderDonutChart(host, {
  slices = [],
  centerLabel = 'Total',
  centerValue = '',
  valueFormatter = defaultFmt,
  size = 176,
  thickness = 28,
  emptyText = 'No data'
} = {}) {
  const valid = (slices || [])
    .map((s, idx) => ({
      label: String(s.label || `Item ${idx + 1}`),
      value: Math.max(0, Number(s.value || 0)),
      color: s.color || CHART_PALETTE[idx % CHART_PALETTE.length],
      sub: s.sub || ''
    }))
    .filter((s) => s.value > 0);

  const total = valid.reduce((sum, s) => sum + s.value, 0);
  if (!valid.length || total <= 0) {
    renderEmptyState(host, emptyText);
    return;
  }

  const ctx = ensureContainer(host, 'uich-donut-wrap');
  const cx = 90;
  const cy = 90;
  const r = 64;
  const circ = 2 * Math.PI * r;

  const svg = svgEl('svg', {
    viewBox: '0 0 180 180',
    width: size,
    height: size,
    class: 'uich-svg uich-donut-svg',
    role: 'img',
    'aria-label': centerLabel || 'Donut chart'
  });

  // Subtle track circle
  svg.appendChild(svgEl('circle', {
    cx,
    cy,
    r,
    fill: 'none',
    stroke: '#ECEEF4',
    'stroke-width': thickness
  }));

  const sliceEls = [];
  let offsetAcc = 0;

  valid.forEach((s, idx) => {
    const frac = s.value / total;
    const pct = Math.round(frac * 100);
    const gap = valid.length > 1 ? Math.min(2.2, circ * 0.008) : 0;
    const dashLen = Math.max(1.5, frac * circ - gap);
    const arc = svgEl('circle', {
      cx,
      cy,
      r,
      fill: 'none',
      stroke: s.color,
      'stroke-width': thickness,
      'stroke-dasharray': `${dashLen.toFixed(2)} ${(circ - dashLen).toFixed(2)}`,
      'stroke-dashoffset': (-offsetAcc).toFixed(2),
      transform: `rotate(-90 ${cx} ${cy})`,
      style: 'cursor:pointer;transition:stroke-width .15s,opacity .15s;'
    });
    offsetAcc += frac * circ;

    const onEnter = (ev) => {
      sliceEls.forEach((el, j) => {
        el.setAttribute('opacity', j === idx ? '1' : '0.45');
        el.setAttribute('stroke-width', j === idx ? String(thickness + 4) : String(thickness));
      });
      ctx.showTip(ev, s.label, `${valueFormatter(s.value)} (${pct}%)${s.sub ? ' · ' + s.sub : ''}`);
    };
    const onLeave = () => {
      sliceEls.forEach((el) => {
        el.setAttribute('opacity', '1');
        el.setAttribute('stroke-width', String(thickness));
      });
      ctx.hideTip();
    };
    arc.addEventListener('mouseenter', onEnter);
    arc.addEventListener('mousemove', onEnter);
    arc.addEventListener('mouseleave', onLeave);

    svg.appendChild(arc);
    sliceEls.push(arc);
  });

  // Center text rendered in SVG so print/PDF preserves it natively
  const cValText = centerValue || valueFormatter(total);
  const valFontSize = String(cValText).length > 9 ? '13' : (String(cValText).length > 6 ? '15' : '17');
  svg.appendChild(svgEl('text', {
    x: cx,
    y: cy - 2,
    'text-anchor': 'middle',
    fill: '#171717',
    'font-size': valFontSize,
    'font-weight': '800',
    'font-family': 'Plus Jakarta Sans, sans-serif'
  }, cValText));
  svg.appendChild(svgEl('text', {
    x: cx,
    y: cy + 15,
    'text-anchor': 'middle',
    fill: '#6B7280',
    'font-size': '10.5',
    'font-weight': '600',
    'font-family': 'Plus Jakarta Sans, sans-serif'
  }, truncLabel(centerLabel, 14)));

  const legend = htmlEl('ul', 'uich-legend');
  valid.forEach((s, idx) => {
    const pct = Math.round((s.value / total) * 100);
    const li = htmlEl('li', 'uich-leg-item');
    const dot = htmlEl('span', 'uich-leg-dot');
    dot.style.background = s.color;
    const lbl = htmlEl('span', 'uich-leg-label', s.label);
    const right = htmlEl('span', 'uich-leg-val', `${valueFormatter(s.value)} (${pct}%)`);
    li.append(dot, lbl, right);
    li.addEventListener('mouseenter', (ev) => {
      sliceEls.forEach((el, j) => {
        el.setAttribute('opacity', j === idx ? '1' : '0.45');
        el.setAttribute('stroke-width', j === idx ? String(thickness + 4) : String(thickness));
      });
      ctx.showTip(ev, s.label, `${valueFormatter(s.value)} (${pct}%)`);
    });
    li.addEventListener('mouseleave', () => {
      sliceEls.forEach((el) => {
        el.setAttribute('opacity', '1');
        el.setAttribute('stroke-width', String(thickness));
      });
      ctx.hideTip();
    });
    legend.appendChild(li);
  });

  ctx.wrap.append(svg, legend);
}

/**
 * Plain-SVG Bar Chart (vertical or horizontal) with tooltips and responsive viewBox.
 */
export function renderBarChart(host, {
  items = [],
  horizontal = false,
  valueFormatter = defaultFmt,
  height = 225,
  color = '#323A85',
  emptyText = 'No data',
  showValues = true,
  onBarClick = null
} = {}) {
  const valid = (items || []).map((it, idx) => ({
    label: String(it.label || `Item ${idx + 1}`),
    shortLabel: String(it.shortLabel || it.label || `Item ${idx + 1}`),
    value: Math.max(0, Number(it.value || 0)),
    color: it.color || color,
    sub: it.sub || '',
    raw: it
  }));

  if (!valid.length || valid.every((it) => it.value === 0)) {
    renderEmptyState(host, emptyText);
    return;
  }

  const ctx = ensureContainer(host, horizontal ? 'uich-hbar-wrap' : 'uich-bar-wrap');

  if (horizontal) {
    const rowH = 30;
    const padL = 128;
    const padR = 72;
    const padT = 10;
    const padB = 12;
    const W = 540;
    const H = Math.max(120, padT + padB + valid.length * rowH);
    const maxVal = Math.max(1, ...valid.map((v) => v.value));
    const plotW = W - padL - padR;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      width: '100%',
      class: 'uich-svg uich-bar-svg',
      role: 'img',
      'aria-label': 'Horizontal bar chart'
    });

    valid.forEach((it, idx) => {
      const y = padT + idx * rowH;
      const barW = Math.max(3, (it.value / maxVal) * plotW);

      svg.appendChild(svgEl('text', {
        x: padL - 8,
        y: y + 17,
        'text-anchor': 'end',
        fill: '#374151',
        'font-size': '11.5',
        'font-weight': '600',
        'font-family': 'Plus Jakarta Sans, sans-serif'
      }, truncLabel(it.shortLabel, 18)));

      svg.appendChild(svgEl('rect', {
        x: padL,
        y: y + 5,
        width: plotW,
        height: 16,
        rx: 4,
        fill: '#F1F5F9'
      }));

      const bar = svgEl('rect', {
        x: padL,
        y: y + 5,
        width: barW.toFixed(1),
        height: 16,
        rx: 4,
        fill: it.color,
        style: onBarClick ? 'cursor:pointer;' : 'cursor:default;'
      });
      bar.addEventListener('mouseenter', (ev) => {
        bar.setAttribute('opacity', '0.82');
        ctx.showTip(ev, it.label, `${valueFormatter(it.value)}${it.sub ? ' · ' + it.sub : ''}`);
      });
      bar.addEventListener('mousemove', (ev) => {
        ctx.showTip(ev, it.label, `${valueFormatter(it.value)}${it.sub ? ' · ' + it.sub : ''}`);
      });
      bar.addEventListener('mouseleave', () => {
        bar.setAttribute('opacity', '1');
        ctx.hideTip();
      });
      if (onBarClick) bar.addEventListener('click', () => onBarClick(it.raw));

      svg.appendChild(bar);
      svg.appendChild(svgEl('text', {
        x: padL + plotW + 8,
        y: y + 17,
        fill: '#171717',
        'font-size': '11.5',
        'font-weight': '700',
        'font-family': 'Plus Jakarta Sans, sans-serif'
      }, valueFormatter(it.value)));
    });

    ctx.wrap.appendChild(svg);
    return;
  }

  // Vertical bar chart
  const W = 560;
  const H = height;
  const padL = 52;
  const padR = 16;
  const padT = 18;
  const padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(1, ...valid.map((v) => v.value));
  const { top, ticks } = niceTicks(maxVal, 4);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    class: 'uich-svg uich-bar-svg',
    role: 'img',
    'aria-label': 'Bar chart'
  });

  ticks.forEach((tk) => {
    const y = padT + plotH - (tk / top) * plotH;
    svg.appendChild(svgEl('line', {
      x1: padL,
      y1: y.toFixed(1),
      x2: W - padR,
      y2: y.toFixed(1),
      stroke: tk === 0 ? '#CBD5E1' : '#EEF1F6',
      'stroke-width': '1'
    }));
    svg.appendChild(svgEl('text', {
      x: padL - 7,
      y: (y + 3.5).toFixed(1),
      'text-anchor': 'end',
      fill: '#6B7280',
      'font-size': '10.5',
      'font-family': 'Plus Jakarta Sans, sans-serif'
    }, shortAxisNum(tk)));
  });

  const step = plotW / valid.length;
  const barW = Math.max(8, Math.min(40, step * 0.56));
  const maxXLabels = 10;
  const skipStep = valid.length > maxXLabels ? Math.ceil(valid.length / maxXLabels) : 1;

  valid.forEach((it, idx) => {
    const cx = padL + step * (idx + 0.5);
    const barH = Math.max(it.value > 0 ? 3 : 0, (it.value / top) * plotH);
    const x = cx - barW / 2;
    const y = padT + plotH - barH;

    const bar = svgEl('rect', {
      x: x.toFixed(1),
      y: y.toFixed(1),
      width: barW.toFixed(1),
      height: barH.toFixed(1),
      rx: Math.min(4, barW / 2),
      fill: it.color,
      style: onBarClick ? 'cursor:pointer;' : 'cursor:default;'
    });
    bar.addEventListener('mouseenter', (ev) => {
      bar.setAttribute('opacity', '0.82');
      ctx.showTip(ev, it.label, `${valueFormatter(it.value)}${it.sub ? ' · ' + it.sub : ''}`);
    });
    bar.addEventListener('mousemove', (ev) => {
      ctx.showTip(ev, it.label, `${valueFormatter(it.value)}${it.sub ? ' · ' + it.sub : ''}`);
    });
    bar.addEventListener('mouseleave', () => {
      bar.setAttribute('opacity', '1');
      ctx.hideTip();
    });
    if (onBarClick) bar.addEventListener('click', () => onBarClick(it.raw));
    svg.appendChild(bar);

    if (showValues && valid.length <= 10 && it.value > 0) {
      svg.appendChild(svgEl('text', {
        x: cx.toFixed(1),
        y: Math.max(12, y - 5).toFixed(1),
        'text-anchor': 'middle',
        fill: '#374151',
        'font-size': '10',
        'font-weight': '700',
        'font-family': 'Plus Jakarta Sans, sans-serif'
      }, shortAxisNum(it.value)));
    }

    if (idx % skipStep === 0 || idx === valid.length - 1) {
      svg.appendChild(svgEl('text', {
        x: cx.toFixed(1),
        y: (H - 18).toFixed(1),
        'text-anchor': 'middle',
        fill: '#525252',
        'font-size': '10.5',
        'font-weight': '600',
        'font-family': 'Plus Jakarta Sans, sans-serif'
      }, truncLabel(it.shortLabel, 10)));
    }
  });

  ctx.wrap.appendChild(svg);
}

/**
 * Plain-SVG Grouped or Stacked Bar Chart for multi-series comparison.
 * series: [{ key, label, color }]
 * categories: [{ label, shortLabel, values: { [key]: number } }]
 */
export function renderStackedBarChart(host, {
  categories = [],
  series = [],
  grouped = false,
  valueFormatter = defaultFmt,
  height = 248,
  emptyText = 'No data'
} = {}) {
  if (!categories.length || !series.length) {
    renderEmptyState(host, emptyText);
    return;
  }

  let maxVal = 0;
  categories.forEach((cat) => {
    if (grouped) {
      series.forEach((sr) => {
        maxVal = Math.max(maxVal, Number(cat.values?.[sr.key] || 0));
      });
    } else {
      const sum = series.reduce((acc, sr) => acc + Math.max(0, Number(cat.values?.[sr.key] || 0)), 0);
      maxVal = Math.max(maxVal, sum);
    }
  });

  if (maxVal <= 0) {
    renderEmptyState(host, emptyText);
    return;
  }

  const ctx = ensureContainer(host, 'uich-stacked-wrap');
  const W = 580;
  const H = height;
  const padL = 54;
  const padR = 16;
  const padT = 14;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const { top, ticks } = niceTicks(maxVal, 4);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    class: 'uich-svg uich-stacked-svg',
    role: 'img',
    'aria-label': grouped ? 'Grouped bar chart' : 'Stacked bar chart'
  });

  ticks.forEach((tk) => {
    const y = padT + plotH - (tk / top) * plotH;
    svg.appendChild(svgEl('line', {
      x1: padL,
      y1: y.toFixed(1),
      x2: W - padR,
      y2: y.toFixed(1),
      stroke: tk === 0 ? '#CBD5E1' : '#EEF1F6',
      'stroke-width': '1'
    }));
    svg.appendChild(svgEl('text', {
      x: padL - 7,
      y: (y + 3.5).toFixed(1),
      'text-anchor': 'end',
      fill: '#6B7280',
      'font-size': '10.5',
      'font-family': 'Plus Jakarta Sans, sans-serif'
    }, shortAxisNum(tk)));
  });

  const groupStep = plotW / categories.length;
  categories.forEach((cat, idx) => {
    const gx = padL + idx * groupStep;
    const center = gx + groupStep / 2;

    if (grouped) {
      const innerW = Math.min(groupStep * 0.72, series.length * 24);
      const subW = Math.max(6, (innerW - (series.length - 1) * 3) / series.length);
      const startX = center - (series.length * subW + (series.length - 1) * 3) / 2;

      series.forEach((sr, si) => {
        const val = Math.max(0, Number(cat.values?.[sr.key] || 0));
        const bh = Math.max(val > 0 ? 3 : 0, (val / top) * plotH);
        const bx = startX + si * (subW + 3);
        const by = padT + plotH - bh;
        const rect = svgEl('rect', {
          x: bx.toFixed(1),
          y: by.toFixed(1),
          width: subW.toFixed(1),
          height: bh.toFixed(1),
          rx: 3,
          fill: sr.color || CHART_PALETTE[si % CHART_PALETTE.length],
          style: 'cursor:pointer;'
        });
        const detail = series.map((sItem) => `${sItem.label}: ${valueFormatter(cat.values?.[sItem.key] || 0)}`).join(' · ');
        rect.addEventListener('mouseenter', (ev) => { rect.setAttribute('opacity', '0.82'); ctx.showTip(ev, cat.label, detail); });
        rect.addEventListener('mousemove', (ev) => ctx.showTip(ev, cat.label, detail));
        rect.addEventListener('mouseleave', () => { rect.setAttribute('opacity', '1'); ctx.hideTip(); });
        svg.appendChild(rect);
      });
    } else {
      const bw = Math.max(12, Math.min(42, groupStep * 0.55));
      const bx = center - bw / 2;
      let accY = padT + plotH;
      series.forEach((sr, si) => {
        const val = Math.max(0, Number(cat.values?.[sr.key] || 0));
        if (val <= 0) return;
        const bh = Math.max(2, (val / top) * plotH);
        accY -= bh;
        const rect = svgEl('rect', {
          x: bx.toFixed(1),
          y: accY.toFixed(1),
          width: bw.toFixed(1),
          height: bh.toFixed(1),
          rx: 2,
          fill: sr.color || CHART_PALETTE[si % CHART_PALETTE.length],
          style: 'cursor:pointer;'
        });
        const detail = `${sr.label}: ${valueFormatter(val)}`;
        rect.addEventListener('mouseenter', (ev) => { rect.setAttribute('opacity', '0.82'); ctx.showTip(ev, cat.label, detail); });
        rect.addEventListener('mousemove', (ev) => ctx.showTip(ev, cat.label, detail));
        rect.addEventListener('mouseleave', () => { rect.setAttribute('opacity', '1'); ctx.hideTip(); });
        svg.appendChild(rect);
      });
    }

    svg.appendChild(svgEl('text', {
      x: center.toFixed(1),
      y: (H - 16).toFixed(1),
      'text-anchor': 'middle',
      fill: '#374151',
      'font-size': '11',
      'font-weight': '600',
      'font-family': 'Plus Jakarta Sans, sans-serif'
    }, truncLabel(cat.shortLabel || cat.label, 12)));
  });

  const leg = htmlEl('ul', 'uich-legend uich-legend-row');
  series.forEach((sr, si) => {
    const li = htmlEl('li', 'uich-leg-item');
    const dot = htmlEl('span', 'uich-leg-dot');
    dot.style.background = sr.color || CHART_PALETTE[si % CHART_PALETTE.length];
    li.append(dot, htmlEl('span', 'uich-leg-label', sr.label));
    leg.appendChild(li);
  });

  ctx.wrap.append(leg, svg);
}

/**
 * Plain-SVG Line & Area Chart for daily/monthly trends.
 * points: [{ label, shortLabel, value, sub }]
 */
export function renderLineChart(host, {
  points = [],
  valueFormatter = defaultFmt,
  height = 225,
  color = '#323A85',
  emptyText = 'No data'
} = {}) {
  const valid = (points || []).map((p, idx) => ({
    label: String(p.label || `Point ${idx + 1}`),
    shortLabel: String(p.shortLabel || p.label || ''),
    value: Math.max(0, Number(p.value || 0)),
    sub: p.sub || ''
  }));

  if (!valid.length || valid.every((p) => p.value === 0)) {
    renderEmptyState(host, emptyText);
    return;
  }

  // When only 1 point exists, render as vertical bar cleanly so trend looks solid
  if (valid.length === 1) {
    renderBarChart(host, { items: valid, valueFormatter, height, color, emptyText });
    return;
  }

  const ctx = ensureContainer(host, 'uich-line-wrap');
  const W = 580;
  const H = height;
  const padL = 52;
  const padR = 18;
  const padT = 18;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(1, ...valid.map((p) => p.value));
  const { top, ticks } = niceTicks(maxVal, 4);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    class: 'uich-svg uich-line-svg',
    role: 'img',
    'aria-label': 'Trend line chart'
  });

  ticks.forEach((tk) => {
    const y = padT + plotH - (tk / top) * plotH;
    svg.appendChild(svgEl('line', {
      x1: padL,
      y1: y.toFixed(1),
      x2: W - padR,
      y2: y.toFixed(1),
      stroke: tk === 0 ? '#CBD5E1' : '#EEF1F6',
      'stroke-width': '1'
    }));
    svg.appendChild(svgEl('text', {
      x: padL - 7,
      y: (y + 3.5).toFixed(1),
      'text-anchor': 'end',
      fill: '#6B7280',
      'font-size': '10.5',
      'font-family': 'Plus Jakarta Sans, sans-serif'
    }, shortAxisNum(tk)));
  });

  const coords = valid.map((p, idx) => {
    const x = padL + (idx / Math.max(1, valid.length - 1)) * plotW;
    const y = padT + plotH - (p.value / top) * plotH;
    return { x, y, ...p };
  });

  const linePts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const baseLineY = (padT + plotH).toFixed(1);
  const areaPts = `${coords[0].x.toFixed(1)},${baseLineY} ${linePts} ${coords[coords.length - 1].x.toFixed(1)},${baseLineY}`;

  svg.appendChild(svgEl('polygon', {
    points: areaPts,
    fill: color,
    'fill-opacity': '0.11'
  }));
  svg.appendChild(svgEl('polyline', {
    points: linePts,
    fill: 'none',
    stroke: color,
    'stroke-width': '2.5',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round'
  }));

  const skipStep = valid.length > 8 ? Math.ceil(valid.length / 8) : 1;
  coords.forEach((c, idx) => {
    const dot = svgEl('circle', {
      cx: c.x.toFixed(1),
      cy: c.y.toFixed(1),
      r: valid.length > 25 ? 3 : 4.2,
      fill: '#FFFFFF',
      stroke: color,
      'stroke-width': '2.2',
      style: 'cursor:pointer;'
    });
    dot.addEventListener('mouseenter', (ev) => {
      dot.setAttribute('r', '6');
      ctx.showTip(ev, c.label, `${valueFormatter(c.value)}${c.sub ? ' · ' + c.sub : ''}`);
    });
    dot.addEventListener('mousemove', (ev) => {
      ctx.showTip(ev, c.label, `${valueFormatter(c.value)}${c.sub ? ' · ' + c.sub : ''}`);
    });
    dot.addEventListener('mouseleave', () => {
      dot.setAttribute('r', valid.length > 25 ? '3' : '4.2');
      ctx.hideTip();
    });
    svg.appendChild(dot);

    if (idx % skipStep === 0 || idx === coords.length - 1) {
      svg.appendChild(svgEl('text', {
        x: c.x.toFixed(1),
        y: (H - 16).toFixed(1),
        'text-anchor': idx === 0 ? 'start' : (idx === coords.length - 1 ? 'end' : 'middle'),
        fill: '#525252',
        'font-size': '10.5',
        'font-weight': '600',
        'font-family': 'Plus Jakarta Sans, sans-serif'
      }, truncLabel(c.shortLabel, 10)));
    }
  });

  ctx.wrap.appendChild(svg);
}
