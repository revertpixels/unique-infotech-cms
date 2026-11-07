import { createSelect } from './ui-select.js';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function icon(name) { const i = document.createElement('i'); i.setAttribute('data-lucide', name); return i; }
function paint() { if (typeof lucide !== 'undefined') lucide.createIcons(); }

// Default icons for common filter values (used when an option has no icon).
const OPT_ICONS = {
  all: 'layers', running: 'play-circle', upcoming: 'clock', closed: 'check-circle', archived: 'archive',
  active: 'check-circle', inactive: 'pause-circle', paid: 'badge-check', unpaid: 'alert-circle', partial: 'pie-chart'
};

// items: [{ label, value, sub, icon, tone }]  tone: indigo|green|amber|red|sky|violet|pink
export function buildStats(items) {
  const wrap = el('div', 'lp-stats');
  const refs = [];
  items.forEach((it) => {
    const card = el('div', 'lp-stat ' + (it.tone || 'indigo'));
    const ic = el('div', 'lp-stat-ic');
    ic.appendChild(icon(it.icon || 'layers'));
    const txt = el('div', 'lp-stat-txt');
    const label = el('span', 'lp-stat-label', it.label);
    const value = el('span', 'lp-stat-value', it.value != null ? String(it.value) : '—');
    const sub = el('span', 'lp-stat-sub', it.sub || '');
    txt.append(label, value, sub);
    card.append(ic, txt);
    wrap.appendChild(card);
    refs.push({ value, sub });
  });
  paint();
  return { el: wrap, update(i, v, s) { if (!refs[i]) return; refs[i].value.textContent = String(v); if (s != null) refs[i].sub.textContent = s; } };
}

// opts: { placeholder, filters: [{ id, label, options: [{ value, label, icon }] }], onChange(state), onRefresh() }
export function buildToolbar(opts) {
  const o = opts || {};
  const bar = el('div', 'lp-toolbar');
  const state = { q: '' };
  const s = el('div', 'lp-search');
  s.appendChild(icon('search'));
  const inp = el('input');
  inp.type = 'search';
  inp.placeholder = o.placeholder || 'Search';
  s.appendChild(inp);
  bar.appendChild(s);
  let t = null;
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = inp.value.trim().toLowerCase(); if (o.onChange) o.onChange(state); }, 150); });
  (o.filters || []).forEach((f) => {
    const w = el('div', 'lp-filter');
    w.appendChild(el('span', 'lp-filter-label', f.label));
    const host = el('div', 'lp-filter-select');
    w.appendChild(host);
    bar.appendChild(w);
    const options = f.options.map((op) => ({ value: op.value, label: op.label, icon: op.icon || OPT_ICONS[op.value] || 'circle' }));
    state[f.id] = options[0] ? options[0].value : '';
    const sel = createSelect(host, {
      options,
      value: state[f.id],
      ariaLabel: f.label,
      onChange: (v) => { state[f.id] = v; host.dataset.value = v; if (o.onChange) o.onChange(state); }
    });
    host.dataset.value = state[f.id];
    host.addEventListener('input', (e) => e.stopPropagation());
    void sel;
  });
  if (o.onRefresh) {
    const r = el('button', 'lp-refresh');
    r.type = 'button';
    r.setAttribute('aria-label', 'Refresh');
    r.title = 'Refresh';
    r.appendChild(icon('refresh-cw'));
    r.addEventListener('click', () => { r.classList.remove('spin'); void r.offsetWidth; r.classList.add('spin'); o.onRefresh(); });
    bar.appendChild(r);
  }
  paint();
  return { el: bar, state };
}

// opts: { title, icon }
export function buildTableCard(opts) {
  const o = opts || {};
  const card = el('div', 'lp-card');
  const head = el('div', 'lp-card-head');
  const title = el('div', 'lp-card-title');
  title.append(icon(o.icon || 'list'), el('span', null, o.title || ''));
  const count = el('span', 'lp-count', '0');
  head.append(title, count);
  const body = el('div', 'lp-scroll');
  const foot = el('div', 'lp-card-foot', '');
  card.append(head, body, foot);
  paint();
  return {
    el: card, body,
    setCount(shown, total, noun) {
      count.textContent = total + ' ' + (noun || 'items');
      foot.textContent = shown === total ? 'Showing all ' + total : 'Showing ' + shown + ' of ' + total;
      foot.hidden = total === 0;
    }
  };
}