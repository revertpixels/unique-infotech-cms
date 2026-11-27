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

let activeClose = null;

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
  host.appendChild(btn);

  options.forEach((o) => {
    const li = mk('li', 'ui-select-opt');
    li.setAttribute('role', 'option');
    li.tabIndex = -1;
    li.dataset.value = o.value;
    li.appendChild(icon(o.icon || 'circle'));
    li.appendChild(mk('span', '', o.label));
    li.appendChild(icon('check', 'ui-select-tick'));
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      choose(o.value);
    });
    list.appendChild(li);
  });

  function paint() {
    const o = options.find((x) => x.value === current) || options[0];
    btn.textContent = '';
    btn.appendChild(icon(o ? (o.icon || 'circle') : 'circle'));
    btn.appendChild(mk('span', 'ui-select-label', o ? (o.shortLabel || o.label || '') : ''));
    btn.appendChild(icon('chevron-down', 'ui-select-chev'));
    btn.title = o ? (o.title !== undefined ? o.title : (o.label || '')) : '';
    list.querySelectorAll('.ui-select-opt').forEach((li) => {
      li.setAttribute('aria-selected', li.dataset.value === current ? 'true' : 'false');
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function onDown(e) {
    if (!host.contains(e.target) && !list.contains(e.target)) {
      close(false);
    }
  }

  function open() {
    if (activeClose && activeClose !== close) {
      activeClose(false);
    }
    activeClose = close;

    if (list.parentNode !== document.body) {
      document.body.appendChild(list);
    }
    list.hidden = false;
    host.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    list.classList.remove('up');
    reposition();

    const sel = list.querySelector('[aria-selected="true"]') || list.firstElementChild;
    if (sel) sel.focus();

    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', reposition, true);
    window.addEventListener('scroll', reposition, true);
  }

  function close(focusBtn) {
    if (activeClose === close) {
      activeClose = null;
    }
    list.hidden = true;
    host.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    if (list.parentNode === document.body) {
      document.body.removeChild(list);
    }
    document.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('resize', reposition, true);
    window.removeEventListener('scroll', reposition, true);
    if (focusBtn && btn.isConnected) btn.focus();
  }

  function reposition() {
    try {
      if (!btn.isConnected) {
        close(false);
        return;
      }
      const rect = btn.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        close(false);
        return;
      }

      list.style.position = 'fixed';
      list.style.zIndex = '10005';
      list.style.maxHeight = '260px';
      list.style.overflowY = 'auto';
      list.style.boxSizing = 'border-box';

      const minW = Math.max(rect.width, 200);
      list.style.minWidth = minW + 'px';
      list.style.maxWidth = Math.min(480, window.innerWidth - 16) + 'px';
      list.style.width = 'max-content';

      const listH = Math.min(list.scrollHeight || 220, 260);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      if (spaceBelow < listH + 12 && spaceAbove > spaceBelow) {
        list.classList.add('up');
        list.style.top = `${Math.max(8, rect.top - listH - 6)}px`;
        list.style.bottom = 'auto';
      } else {
        list.classList.remove('up');
        const top = rect.bottom + 6;
        const maxTop = window.innerHeight - listH - 8;
        list.style.top = `${Math.min(top, maxTop)}px`;
        list.style.bottom = 'auto';
      }

      let left = rect.left;
      const listW = list.offsetWidth || minW;
      if (left + listW > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - listW - 8);
      }
      if (left < 8) left = 8;
      list.style.left = `${left}px`;
      list.style.right = 'auto';
    } catch (e) {
      // ignore reposition errors
    }
  }

  function choose(v) {
    const changed = v !== current;
    current = v;
    paint();
    close(true);
    if (changed) {
      host.dispatchEvent(new Event('input', { bubbles: true }));
      host.dispatchEvent(new Event('change', { bubbles: true }));
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
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        choose(o.value);
      });
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

  let isDisabled = Boolean(opts && opts.disabled);
  function applyDisabled() {
    btn.disabled = isDisabled;
    host.classList.toggle('is-disabled', isDisabled);
    if (isDisabled && !list.hidden) close(false);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isDisabled) return;
    if (list.hidden) open();
    else close(false);
  });

  btn.addEventListener('keydown', (e) => {
    if (isDisabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(false); }
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
  applyDisabled();
  return {
    get value() { return current; },
    set value(v) { current = v; paint(); },
    get disabled() { return isDisabled; },
    set disabled(v) { isDisabled = Boolean(v); applyDisabled(); },
    setValue(v) { current = v; paint(); },
    setDisabled(v) { isDisabled = Boolean(v); applyDisabled(); },
    setOptions,
    focus() { if (!isDisabled) btn.focus(); },
    close() { close(false); }
  };
}
