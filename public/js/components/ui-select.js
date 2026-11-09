function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function icon(name, cls) {
  const i = document.createElement('i');
  i.setAttribute('data-lucide', name);
  if (cls) i.className = cls;
  return i;
}

export function createSelect(host, opts) {
  let options = (opts && opts.options) || [];
  let current = (opts && opts.value !== undefined) ? opts.value : (options[0] ? options[0].value : '');
  host.classList.add('ui-select');
  host.textContent = '';
  const btn = mk('button', 'ui-select-btn');
  btn.type = 'button';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  if (opts && opts.ariaLabel) btn.setAttribute('aria-label', opts.ariaLabel);
  const list = mk('ul', 'ui-select-list');
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  host.append(btn, list);

  options.forEach((o) => {
    const li = mk('li', 'ui-select-opt');
    li.setAttribute('role', 'option');
    li.tabIndex = -1;
    li.dataset.value = o.value;
    li.appendChild(icon(o.icon || 'circle'));
    li.appendChild(mk('span', '', o.label));
    li.appendChild(icon('check', 'ui-select-tick'));
    li.addEventListener('click', () => choose(o.value));
    list.appendChild(li);
  });

  function paint() {
    const o = options.find((x) => x.value === current) || options[0];
    btn.textContent = '';
    btn.appendChild(icon(o ? (o.icon || 'circle') : 'circle'));
    btn.appendChild(mk('span', 'ui-select-label', o ? o.label : ''));
    btn.appendChild(icon('chevron-down', 'ui-select-chev'));
    btn.title = o ? (o.label || '') : '';
    list.querySelectorAll('.ui-select-opt').forEach((li) => {
      li.setAttribute('aria-selected', li.dataset.value === current ? 'true' : 'false');
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function onDown(e) { if (!host.contains(e.target)) close(false); }

  function open() {
    list.hidden = false;
    host.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    list.classList.remove('up');
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < 200 && spaceAbove > spaceBelow) list.classList.add('up');
    const sel = list.querySelector('[aria-selected="true"]') || list.firstElementChild;
    if (sel) sel.focus();
    document.addEventListener('mousedown', onDown, true);
  }

  function close(focusBtn) {
    list.hidden = true;
    host.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDown, true);
    if (focusBtn) btn.focus();
  }

  function choose(v) {
    const changed = v !== current;
    current = v;
    paint();
    close(true);
    if (changed) {
      host.dispatchEvent(new Event('input', { bubbles: true }));
      if (opts && opts.onChange) opts.onChange(v);
    }
  }

  function rebuild() {
    list.textContent = '';
    options.forEach((o) => {
      const li = mk('li', 'ui-select-opt');
      li.setAttribute('role', 'option');
      li.tabIndex = -1;
      li.dataset.value = o.value;
      li.appendChild(icon(o.icon || 'circle'));
      li.appendChild(mk('span', '', o.label));
      li.appendChild(icon('check', 'ui-select-tick'));
      li.addEventListener('click', () => choose(o.value));
      list.appendChild(li);
    });
    paint();
  }
  function setOptions(newOpts) {
    const prev = current;
    options = newOpts || [];
    if (!options.some(o => o.value === prev)) current = options.length ? options[0].value : '';
    else current = prev;
    rebuild();
  }

  btn.addEventListener('click', () => { if (list.hidden) open(); else close(false); });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
  });
  list.addEventListener('keydown', (e) => {
    const items = Array.from(list.children);
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[idx - 1] || items[items.length - 1]).focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (items[idx]) choose(items[idx].dataset.value); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') { close(false); }
  });

  paint();
  return {
    get value() { return current; },
    set value(v) { current = v; paint(); },
    setOptions,
    focus() { btn.focus(); }
  };
}
