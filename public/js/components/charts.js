// charts.js — Zero-dependency plain-SVG & HTML data visuals in calm reference style.
// Reuses white/grey + brand purple (--primary) palette; red ONLY for overdue money; square 90-degree bars/swatches.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const CHART_PALETTE = [
  '#323A85', // Primary brand purple-indigo
  '#6366F1', // Soft indigo
  '#475569', // Charcoal slate
  '#94A3B8', // Medium cool grey
  '#CBD5E1'  // Pale slate
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
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="9" opacity="0.4"></circle>' +
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
 * Small Donut Chart (~150px) with center readout and side legend (Payment Mode & Fee Type).
 */
export function renderDonutChart(host, {
  slices = [],
  centerLabel = 'Total',
  centerValue = '',
  valueFormatter = defaultFmt,
  size = 150,
  thickness = 22,
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
  const cx = 82;
  const cy = 82;
  const r = 58;
  const circ = 2 * Math.PI * r;

  const svg = svgEl('svg', {
    viewBox: '0 0 164 164',
    width: size,
    height: size,
    class: 'uich-svg uich-donut-svg',
    role: 'img',
    'aria-label': centerLabel || 'Donut chart'
  });

  svg.appendChild(svgEl('circle', {
    cx,
    cy,
    r,
    fill: 'none',
    stroke: '#F1F5F9',
    'stroke-width': thickness
  }));

  const sliceEls = [];
  let offsetAcc = 0;

  valid.forEach((s, idx) => {
    const frac = s.value / total;
    const pct = Math.round(frac * 100);
    const gap = valid.length > 1 ? Math.min(2, circ * 0.008) : 0;
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
        el.setAttribute('stroke-width', j === idx ? String(thickness + 3) : String(thickness));
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

  const cValText = centerValue || valueFormatter(total);
  const valFontSize = String(cValText).length > 9 ? '12.5' : (String(cValText).length > 6 ? '14' : '15.5');
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
    y: cy + 14,
    'text-anchor': 'middle',
    fill: '#8A8A8A',
    'font-size': '10',
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
        el.setAttribute('stroke-width', j === idx ? String(thickness + 3) : String(thickness));
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
 * Plain-SVG Vertical Bar Chart with dashed #EAEAEA gridlines, square corners (rx=0, ry=0), and max ~48px bar width.
 */
export function renderBarChart(host, {
  items = [],
  valueFormatter = defaultFmt,
  viewWidth = 560,
  height = 210,
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

  const ctx = ensureContainer(host, 'uich-bar-wrap');
  const W = viewWidth;
  const H = height;
  const padL = 48;
  const padR = 14;
  const padT = 18;
  const padB = 34;
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
      stroke: '#EAEAEA',
      'stroke-dasharray': tk === 0 ? null : '3 4',
      'stroke-width': '1'
    }));
    svg.appendChild(svgEl('text', {
      x: padL - 8,
      y: (y + 3.5).toFixed(1),
      'text-anchor': 'end',
      fill: '#8A8A8A',
      'font-size': '10.5',
      'font-family': 'Plus Jakarta Sans, sans-serif'
    }, shortAxisNum(tk)));
  });

  const step = plotW / valid.length;
  const barW = valid.length <= 2
    ? Math.min(46, Math.max(24, step * 0.28))
    : Math.max(14, Math.min(48, step * 0.5));
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
      rx: 0,
      ry: 0,
      fill: it.color,
      style: onBarClick ? 'cursor:pointer;' : 'cursor:default;'
    });
    bar.addEventListener('mouseenter', (ev) => {
      bar.setAttribute('opacity', '0.84');
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
        y: Math.max(11, y - 5).toFixed(1),
        'text-anchor': 'middle',
        fill: '#525252',
        'font-size': '10.5',
        'font-weight': '700',
        'font-family': 'Plus Jakarta Sans, sans-serif'
      }, shortAxisNum(it.value)));
    }

    if (idx % skipStep === 0 || idx === valid.length - 1) {
      svg.appendChild(svgEl('text', {
        x: cx.toFixed(1),
        y: (H - 12).toFixed(1),
        'text-anchor': 'middle',
        fill: '#525252',
        'font-size': '10.5',
        'font-weight': '500',
        'font-family': 'Plus Jakarta Sans, sans-serif'
      }, truncLabel(it.shortLabel, valid.length <= 4 ? 20 : 12)));
    }
  });

  ctx.wrap.appendChild(svg);
}

/**
 * Plain-SVG Stacked / Grouped Bar Chart matching reference `drawStack` (square corners, dashed grid, max 48px bar width).
 */
export function renderStackedBarChart(host, {
  categories = [],
  series = [],
  grouped = false,
  valueFormatter = defaultFmt,
  viewWidth = 560,
  height = 215,
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
  const W = viewWidth;
  const H = height;
  const padL = 48;
  const padR = 14;
  const padT = 14;
  const padB = 34;
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
      stroke: '#EAEAEA',
      'stroke-dasharray': tk === 0 ? null : '3 4',
      'stroke-width': '1'
    }));
    svg.appendChild(svgEl('text', {
      x: padL - 8,
      y: (y + 3.5).toFixed(1),
      'text-anchor': 'end',
      fill: '#8A8A8A',
      'font-size': '10.5',
      'font-family': 'Plus Jakarta Sans, sans-serif'
    }, shortAxisNum(tk)));
  });

  const groupStep = plotW / categories.length;
  categories.forEach((cat, idx) => {
    const gx = padL + idx * groupStep;
    const center = gx + groupStep / 2;

    if (grouped) {
      const gap = 3;
      const maxSubW = categories.length <= 2 ? 32 : 26;
      const innerW = Math.min(groupStep * 0.68, series.length * maxSubW + (series.length - 1) * gap);
      const subW = Math.min(maxSubW, Math.max(10, (innerW - (series.length - 1) * gap) / series.length));
      const startX = center - (series.length * subW + (series.length - 1) * gap) / 2;

      series.forEach((sr, si) => {
        const val = Math.max(0, Number(cat.values?.[sr.key] || 0));
        const bh = Math.max(val > 0 ? 3 : 0, (val / top) * plotH);
        const bx = startX + si * (subW + gap);
        const by = padT + plotH - bh;
        const rect = svgEl('rect', {
          x: bx.toFixed(1),
          y: by.toFixed(1),
          width: subW.toFixed(1),
          height: bh.toFixed(1),
          rx: 0,
          ry: 0,
          fill: sr.color || CHART_PALETTE[si % CHART_PALETTE.length],
          style: 'cursor:pointer;'
        });
        const detail = series.map((sItem) => `${sItem.label}: ${valueFormatter(cat.values?.[sItem.key] || 0)}`).join(' · ');
        rect.addEventListener('mouseenter', (ev) => { rect.setAttribute('opacity', '0.84'); ctx.showTip(ev, cat.label, detail); });
        rect.addEventListener('mousemove', (ev) => ctx.showTip(ev, cat.label, detail));
        rect.addEventListener('mouseleave', () => { rect.setAttribute('opacity', '1'); ctx.hideTip(); });
        svg.appendChild(rect);
      });
    } else {
      const bw = Math.max(18, Math.min(48, groupStep * 0.48));
      const bx = center - bw / 2;
      let accY = padT + plotH;
      let firstSeg = true;
      series.forEach((sr, si) => {
        const val = Math.max(0, Number(cat.values?.[sr.key] || 0));
        if (val <= 0) return;
        const bh = Math.max(2, (val / top) * plotH);
        if (!firstSeg) accY -= 1; // Crisp 1px gap between stacked bars like temp_ref_dashboard
        firstSeg = false;
        accY -= bh;
        const rect = svgEl('rect', {
          x: bx.toFixed(1),
          y: accY.toFixed(1),
          width: bw.toFixed(1),
          height: bh.toFixed(1),
          rx: 0,
          ry: 0,
          fill: sr.color || CHART_PALETTE[si % CHART_PALETTE.length],
          'fill-opacity': sr.opacity || '1',
          style: 'cursor:pointer;'
        });
        const detail = series.map((sItem) => `${sItem.label}: ${valueFormatter(cat.values?.[sItem.key] || 0)}`).join(' · ');
        rect.addEventListener('mouseenter', (ev) => { rect.setAttribute('opacity', '0.84'); ctx.showTip(ev, cat.label, detail); });
        rect.addEventListener('mousemove', (ev) => ctx.showTip(ev, cat.label, detail));
        rect.addEventListener('mouseleave', () => { rect.setAttribute('opacity', '1'); ctx.hideTip(); });
        svg.appendChild(rect);
      });
    }

    svg.appendChild(svgEl('text', {
      x: center.toFixed(1),
      y: (H - 12).toFixed(1),
      'text-anchor': 'middle',
      fill: '#525252',
      'font-size': '10.5',
      'font-weight': '500',
      'font-family': 'Plus Jakarta Sans, sans-serif'
    }, truncLabel(cat.shortLabel || cat.label, categories.length <= 4 ? 22 : 14)));
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
 * Plain-SVG Line & Area Chart with dashed #EAEAEA gridlines and calm purple stroke.
 */
export function renderLineChart(host, {
  points = [],
  valueFormatter = defaultFmt,
  viewWidth = 760,
  height = 205,
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

  if (valid.length === 1) {
    renderBarChart(host, { items: valid, valueFormatter, viewWidth, height, color, emptyText });
    return;
  }

  const ctx = ensureContainer(host, 'uich-line-wrap');
  const W = viewWidth;
  const H = height;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 34;
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
      stroke: '#EAEAEA',
      'stroke-dasharray': tk === 0 ? null : '3 4',
      'stroke-width': '1'
    }));
    svg.appendChild(svgEl('text', {
      x: padL - 8,
      y: (y + 3.5).toFixed(1),
      'text-anchor': 'end',
      fill: '#8A8A8A',
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
    'fill-opacity': '0.09'
  }));
  svg.appendChild(svgEl('polyline', {
    points: linePts,
    fill: 'none',
    stroke: color,
    'stroke-width': '2.2',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round'
  }));

  const skipStep = valid.length > 10 ? Math.ceil(valid.length / 10) : 1;
  coords.forEach((c, idx) => {
    const dot = svgEl('circle', {
      cx: c.x.toFixed(1),
      cy: c.y.toFixed(1),
      r: '3',
      fill: '#FFFFFF',
      stroke: color,
      'stroke-width': '2',
      style: 'cursor:pointer;'
    });
    dot.addEventListener('mouseenter', (ev) => {
      dot.setAttribute('r', '4.5');
      ctx.showTip(ev, c.label, `${valueFormatter(c.value)}${c.sub ? ' · ' + c.sub : ''}`);
    });
    dot.addEventListener('mousemove', (ev) => {
      ctx.showTip(ev, c.label, `${valueFormatter(c.value)}${c.sub ? ' · ' + c.sub : ''}`);
    });
    dot.addEventListener('mouseleave', () => {
      dot.setAttribute('r', '3');
      ctx.hideTip();
    });
    svg.appendChild(dot);

    if (idx % skipStep === 0 || idx === coords.length - 1) {
      svg.appendChild(svgEl('text', {
        x: c.x.toFixed(1),
        y: (H - 12).toFixed(1),
        'text-anchor': idx === 0 ? 'start' : (idx === coords.length - 1 ? 'end' : 'middle'),
        fill: '#525252',
        'font-size': '10.5',
        'font-weight': '500',
        'font-family': 'Plus Jakarta Sans, sans-serif'
      }, truncLabel(c.shortLabel, 10)));
    }
  });

  ctx.wrap.appendChild(svg);
}

/**
 * Reference "Students by Centre" thin square-ended bar list + bottom summary row.
 */
export function renderThinBarList(host, {
  items = [],
  valueFormatter = defaultFmt,
  totalLabel = '',
  totalText = '',
  danger = false,
  emptyText = 'No data'
} = {}) {
  if (!host) return;
  host.innerHTML = '';

  const list = (items || []).filter(Boolean);
  if (!list.length) {
    renderEmptyState(host, emptyText);
    return;
  }

  const maxVal = Math.max(1, ...list.map((it) => Number(it.maxValue ?? it.value ?? 0)));
  const frag = document.createDocumentFragment();

  list.forEach((it) => {
    const row = htmlEl('div', 'rc-hb');
    const top = htmlEl('div', 'rc-hb-top');
    const left = htmlEl('span', 'rc-hb-name', it.label || '-');

    const right = htmlEl('b', 'rc-hb-val');
    right.textContent = it.valueText || valueFormatter(it.value || 0);
    if (it.subText) {
      const sub = htmlEl('span', `rc-hb-sub${it.subDanger ? ' is-danger' : ''}`, it.subText);
      right.appendChild(sub);
    }
    top.append(left, right);

    const track = htmlEl('div', `rc-hb-track${danger || it.danger ? ' is-danger' : ''}`);
    const pct = it.pct !== undefined && it.pct !== null
      ? Math.min(100, Math.max(0, Number(it.pct)))
      : (maxVal > 0 ? Math.min(100, Math.round((Number(it.value || 0) / maxVal) * 1000) / 10) : 0);
    const fill = document.createElement('i');
    fill.style.width = `${pct}%`;
    track.appendChild(fill);

    row.append(top, track);
    frag.appendChild(row);
  });

  if (totalLabel || totalText) {
    const note = htmlEl('div', 'rc-total-note');
    note.append(htmlEl('span', '', totalLabel), htmlEl('b', '', totalText));
    frag.appendChild(note);
  }

  host.appendChild(frag);
}

/**
 * Reference "Students by Semester" thin stacked horizontal segment bar + square-dot legend below.
 */
export function renderSegmentedBar(host, {
  segments = [],
  title = '',
  valueFormatter = defaultFmt,
  emptyText = 'No data'
} = {}) {
  if (!host) return;
  host.innerHTML = '';

  const valid = (segments || [])
    .map((s, idx) => ({
      label: String(s.label || `Item ${idx + 1}`),
      value: Math.max(0, Number(s.value || 0)),
      color: s.color || CHART_PALETTE[idx % CHART_PALETTE.length]
    }))
    .filter((s) => s.value > 0);

  const total = valid.reduce((sum, s) => sum + s.value, 0);
  if (!valid.length || total <= 0) {
    if (title) host.appendChild(htmlEl('div', 'rc-seg-title', title));
    const empty = htmlEl('div', 'uich-empty');
    empty.appendChild(htmlEl('span', 'uich-empty-text', emptyText));
    host.appendChild(empty);
    return;
  }

  if (title) host.appendChild(htmlEl('div', 'rc-seg-title', title));

  const bar = htmlEl('div', 'rc-seg-bar');
  valid.forEach((s) => {
    const seg = document.createElement('i');
    const pct = (s.value / total) * 100;
    seg.style.width = `${pct.toFixed(2)}%`;
    seg.style.background = s.color;
    seg.title = `${s.label}: ${valueFormatter(s.value)} (${Math.round(pct)}%)`;
    bar.appendChild(seg);
  });

  const leg = htmlEl('div', 'rc-seg-legend');
  valid.forEach((s) => {
    const sp = document.createElement('span');
    const dot = document.createElement('i');
    dot.style.background = s.color;
    const lbl = document.createTextNode(`${s.label} `);
    const val = htmlEl('b', '', valueFormatter(s.value));
    sp.append(dot, lbl, val);
    leg.appendChild(sp);
  });

  host.append(bar, leg);
}
