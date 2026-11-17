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
  const selects = {};
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
    selects[f.id] = sel;
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
  const api = { el: bar, state, setFilterOptions: (id, opts) => { if (selects[id]) selects[id].setOptions(opts); } };
  return api;
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

// Renders a shared pagination footer into `container`.
// opts: { page, pageSize, totalItems, onPageChange(page) }
// Hides the container when there is only one page.
export function renderPager(container, opts) {
  const o = opts || {};
  const page = Math.max(1, o.page || 1);
  const pageSize = Math.max(1, o.pageSize || 10);
  const totalItems = Math.max(0, o.totalItems || 0);
  const onPageChange = o.onPageChange || (() => {});
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  container.innerHTML = '';
  if (totalPages <= 1) { container.hidden = true; return; }
  container.hidden = false;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);
  container.appendChild(el('span', null, 'Showing ' + from + '-' + to + ' of ' + totalItems));
  const wrap = el('div', 'adm-pager');
  wrap.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-left:16px;';
  const prev = el('button', 'ui-btn ghost' + (page <= 1 ? ' disabled' : ''), 'Prev');
  prev.type = 'button';
  prev.disabled = page <= 1;
  prev.addEventListener('click', () => { if (page > 1) onPageChange(page - 1); });
  wrap.appendChild(prev);
  for (let p = 1; p <= totalPages; p++) {
    const b = el('button', 'ui-btn ghost' + (p === page ? ' active' : ''), String(p));
    b.type = 'button';
    b.addEventListener('click', () => { onPageChange(p); });
    wrap.appendChild(b);
  }
  const next = el('button', 'ui-btn ghost' + (page >= totalPages ? ' disabled' : ''), 'Next');
  next.type = 'button';
  next.disabled = page >= totalPages;
  next.addEventListener('click', () => { if (page < totalPages) onPageChange(page + 1); });
  wrap.appendChild(next);
  container.appendChild(wrap);
}