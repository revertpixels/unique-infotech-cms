// Reusable multi-select dropdown for courses (batches page).
// Value shape: { allCourses: boolean, courseIds: string[] }.
// Closed field shows: placeholder "Select courses" / "All courses" / plain text codes ("CFASLAT - ..." / "CFASLAT, CDTPLAT" / "CFASLAT, CDTPLAT +N more").
// Open panel: search input, "Select all" checkbox row (or "Select all results" when searching),
// divider, then one checkbox row per course: "CODE - Name".
// Keyboard: Esc closes, Up/Down moves, Space/Enter toggles. Click outside closes.
// Panel max-height 280px, scrolls. Styling matches ui-select.

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

export function createMultiSelect(host, opts) {
  let options = (opts && opts.options) || []; // [{ value, label }]
  let value = { allCourses: false, courseIds: [] };
  if (opts && opts.value) value = Object.assign({ allCourses: false, courseIds: [] }, opts.value);
  const onChange = (opts && opts.onChange) || (() => {});

  host.classList.add('ui-multi');
  host.textContent = '';

  const btn = mk('button', 'ui-multi-btn');
  btn.type = 'button';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  if (opts && opts.ariaLabel) btn.setAttribute('aria-label', opts.ariaLabel);

  // Leading book-open icon (same as ui-select icon)
  const leadIcon = icon('book-open');
  btn.appendChild(leadIcon);

  const labelWrap = mk('span', 'ui-multi-label-wrap');
  btn.appendChild(labelWrap);

  const chev = mk('i', 'ui-multi-chev ui-select-chev');
  chev.setAttribute('data-lucide', 'chevron-down');
  btn.appendChild(chev);

  const list = mk('div', 'ui-multi-list');
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  host.append(btn, list);

  // --- search ---
  const searchWrap = mk('div', 'ui-multi-search');
  const searchInp = mk('input');
  searchInp.type = 'search';
  searchInp.placeholder = 'Search courses...';
  const searchIcon = icon('search');
  searchIcon.className = 'ui-multi-search-icon';
  searchWrap.appendChild(searchIcon);
  searchWrap.appendChild(searchInp);
  list.appendChild(searchWrap);

  // --- select all row (created in renderOptions, directly under search) ---
  // divider ---
  const divider = mk('div', 'ui-multi-divider');
  list.appendChild(divider);

  // --- options container ---
  const optsContainer = mk('div', 'ui-multi-options');
  list.appendChild(optsContainer);

  let filtered = options.slice();
  let rows = []; // { li, cb, labelSpan, value }

  function labelFor(id) {
    const o = options.find((x) => x.value === id);
    return o ? o.label : id;
  }

  function codeFor(id) {
    const o = options.find((x) => x.value === id);
    if (!o) return id;
    const parts = o.label.split(' - ');
    return parts[0] || o.label;
  }

  // Selection-state helpers.
  function isChecked(id) {
    return value.allCourses || value.courseIds.includes(id);
  }
  function allTicked() {
    return value.allCourses || (options.length > 0 && options.every((o) => value.courseIds.includes(o.value)));
  }

  function paintClosed() {
    labelWrap.textContent = '';
    if (value.allCourses) {
      labelWrap.textContent = 'All courses';
    } else if (value.courseIds.length === 0) {
      const ph = mk('span', 'ui-multi-placeholder');
      ph.textContent = 'Select courses';
      labelWrap.appendChild(ph);
    } else if (value.courseIds.length === 1) {
      labelWrap.textContent = labelFor(value.courseIds[0]);
    } else if (value.courseIds.length <= 3) {
      labelWrap.textContent = value.courseIds.map(codeFor).join(', ');
    } else {
      labelWrap.textContent = value.courseIds.slice(0, 2).map(codeFor).join(', ') + ' +' + (value.courseIds.length - 2) + ' more';
    }
    btn.title = value.allCourses ? 'All courses' : (value.courseIds.length ? value.courseIds.map(labelFor).join(', ') : 'Select courses');
  }

  function renderOptions() {
    filtered = options.filter((o) => {
      const q = searchInp.value.toLowerCase();
      if (!q) return true;
      const lab = (o.label || '').toLowerCase();
      return lab.includes(q);
    });
    optsContainer.textContent = '';
    rows = [];
    const anyQ = searchInp.value.trim().length > 0;

    // Select all row (single row, directly under the search box).
    const selAllLi = mk('li', 'ui-multi-opt ui-multi-opt-selectall');
    selAllLi.setAttribute('role', 'option');
    selAllLi.tabIndex = -1;
    selAllLi.dataset.value = '__all__';
    const selAllCheckbox = mk('span', 'ui-multi-checkbox ui-multi-checkbox-custom');
    const selAllCheckSvg = mk('span', 'ui-multi-checkbox-check');
    selAllCheckSvg.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    selAllCheckbox.appendChild(selAllCheckSvg);
    const selAllText = anyQ ? 'Select all results' : 'Select all';
    const selAllLab = mk('label', '', selAllText);
    selAllLab.style.fontWeight = '600';
    selAllLi.appendChild(selAllCheckbox);
    selAllLi.appendChild(selAllLab);
    selAllLi.addEventListener('click', (ev) => { ev.stopPropagation(); toggleSelectAll(); });
    selAllLi.addEventListener('keydown', (ev) => {
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggleSelectAll(); }
    });
    optsContainer.appendChild(selAllLi);
    rows.push({ li: selAllLi, cb: selAllCheckbox, focusEl: selAllLi, value: '__all__' });

    filtered.forEach((o) => {
      const li = mk('li', 'ui-multi-opt');
      li.setAttribute('role', 'option');
      li.tabIndex = -1;
      li.dataset.value = o.value;
      li.title = o.label;

      const checkbox = mk('span', 'ui-multi-checkbox ui-multi-checkbox-custom');
      const checkSvg = mk('span', 'ui-multi-checkbox-check');
      checkSvg.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      checkbox.appendChild(checkSvg);

      const lab = mk('label', '', '');
      const codeSpan = mk('span', 'ui-multi-opt-code');
      codeSpan.textContent = o.label;
      lab.appendChild(codeSpan);

      li.appendChild(checkbox);
      li.appendChild(lab);
      li.addEventListener('click', (ev) => { ev.stopPropagation(); toggleOpt(o.value); });
      optsContainer.appendChild(li);
      rows.push({ li, cb: checkbox, focusEl: li, value: o.value });
    });

    refreshChecks();
  }

  function refreshChecks() {
    const anyQ = searchInp.value.trim().length > 0;
    rows.forEach((r) => {
      if (r.value === '__all__') {
        let checked, indeterminate;
        if (anyQ) {
          checked = filtered.length > 0 && filtered.every((o) => isChecked(o.value));
          indeterminate = !checked && filtered.some((o) => isChecked(o.value));
        } else {
          checked = allTicked();
          indeterminate = !checked && value.courseIds.length > 0;
        }
        r.cb.classList.toggle('checked', checked);
        r.cb.classList.toggle('indeterminate', indeterminate);
        r.cb.setAttribute('aria-checked', checked ? 'true' : indeterminate ? 'mixed' : 'false');
        return;
      }
      const checked = isChecked(r.value);
      r.cb.classList.toggle('checked', checked);
      r.cb.setAttribute('aria-checked', checked ? 'true' : 'false');
    });
  }

  function toggleOpt(id) {
    if (value.allCourses) {
      value = { allCourses: false, courseIds: options.map((o) => o.value).filter((x) => x !== id) };
    } else {
      const idx = value.courseIds.indexOf(id);
      if (idx >= 0) value.courseIds.splice(idx, 1);
      else value.courseIds.push(id);
    }
    if (options.length && options.every((o) => value.courseIds.includes(o.value))) {
      value = { allCourses: true, courseIds: [] };
    }
    paint();
    onChange(getValue());
  }

  function toggleSelectAll() {
    const anyQ = searchInp.value.trim().length > 0;
    if (!anyQ) {
      if (allTicked()) {
        value = { allCourses: false, courseIds: [] };
      } else {
        value = { allCourses: true, courseIds: [] };
      }
    } else {
      const ids = filtered.map((o) => o.value);
      const base = value.allCourses ? options.map((o) => o.value) : value.courseIds.slice();
      if (ids.every((id) => base.includes(id))) {
        base = base.filter((id) => !ids.includes(id));
      } else {
        ids.forEach((id) => { if (!base.includes(id)) base.push(id); });
      }
      value = (options.length && options.every((o) => base.includes(o.value)))
        ? { allCourses: true, courseIds: [] }
        : { allCourses: false, courseIds: base };
    }
    paint();
    onChange(getValue());
  }

  function getValue() {
    if (value.allCourses) return { allCourses: true, courseIds: [] };
    return { allCourses: false, courseIds: value.courseIds.slice() };
  }

  function setValue(v) {
    value = Object.assign({ allCourses: false, courseIds: [] }, v || {});
    paintClosed();
    renderOptions();
  }

  function paint() {
    paintClosed();
    renderOptions();
  }

  function setOptions(newOpts) {
    options = newOpts || [];
    // Keep current value; drop courseIds not present in the new options (unless allCourses).
    if (!value.allCourses) {
      const ids = new Set(options.map((o) => o.value));
      value.courseIds = value.courseIds.filter((id) => ids.has(id));
    }
    paint();
  }

  function open() {
    list.hidden = false;
    host.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    searchInp.value = '';
    renderOptions();
    searchInp.focus();
    reposition();
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('resize', reposition, true);
    window.addEventListener('scroll', reposition, true);
  }

  function close() {
    list.hidden = true;
    host.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('resize', reposition, true);
    window.removeEventListener('scroll', reposition, true);
  }

  function reposition() {
    try {
      const rect = btn.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < 300 && spaceAbove > spaceBelow) {
        host.classList.add('up');
      } else {
        host.classList.remove('up');
      }
    } catch (e) {
      // ignore reposition errors (e.g. element detached)
    }
  }

  function onOutside(ev) {
    if (!host.contains(ev.target)) close();
  }

  function onKeyDown(ev) {
    if (list.hidden) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); open(); }
      return;
    }
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key === 'Tab') { close(); return; }
    const active = document.activeElement;
    if (active === searchInp) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); focusRow(0); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); focusRow(rows.length - 1); }
      return;
    }
    const idx = rows.findIndex((r) => r.li === active || r.li.contains(active));
    if (idx >= 0) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); focusRow(idx + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); focusRow(idx - 1); }
      else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggleOpt(rows[idx].value); }
    }
  }

  function focusRow(idx) {
    if (idx < 0) idx = 0;
    if (idx >= rows.length) idx = rows.length - 1;
    const r = rows[idx];
    if (r && r.focusEl) r.focusEl.focus();
  }

  searchInp.addEventListener('input', () => { renderOptions(); });
  btn.addEventListener('click', () => { if (list.hidden) open(); else close(); });
  btn.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); open(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  });
  list.addEventListener('keydown', onKeyDown);

  paint();
  return {
    get value() { return getValue(); },
    set value(v) { setValue(v); },
    setOptions(newOpts) { setOptions(newOpts); },
    open() { open(); },
    close() { close(); },
    focus() { btn.focus(); }
  };
}
