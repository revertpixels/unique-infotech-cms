// ui-datepicker.js — Custom floating Date & Month pickers (v1.8.96)
// No external libraries. Uses Lucide icons and clean responsive popups.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateDisplay(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  const mName = MONTH_SHORT[m - 1] || '';
  return `${d} ${mName} ${y}`;
}

function formatMonthDisplay(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || '';
  const [y, m] = ym.split('-').map(Number);
  const mName = MONTH_SHORT[m - 1] || '';
  return `${mName} ${y}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isBetween(val, min, max) {
  if (min && val < min) return false;
  if (max && val > max) return false;
  return true;
}

/**
 * Custom Date Picker
 * @param {HTMLElement} host - Container element to render trigger button
 * @param {Object} opts - { value, min, max, ariaLabel, onChange }
 */
export function createDatePicker(host, opts = {}) {
  let current = opts.value || '';
  let minVal = opts.min || '';
  let maxVal = opts.max || '';

  host.innerHTML = '';
  host.className = (host.className ? host.className + ' ' : '') + 'ui-dp-host';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-select-btn ui-dp-btn';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  if (opts.ariaLabel) btn.setAttribute('aria-label', opts.ariaLabel);

  const iconLeft = document.createElement('i');
  iconLeft.setAttribute('data-lucide', 'calendar');
  iconLeft.className = 'ui-select-icon';
  btn.appendChild(iconLeft);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'ui-select-label ui-dp-btn-label';
  btn.appendChild(labelSpan);

  const iconRight = document.createElement('i');
  iconRight.setAttribute('data-lucide', 'chevron-down');
  iconRight.className = 'ui-select-chev';
  btn.appendChild(iconRight);

  host.appendChild(btn);

  let viewYear = 0;
  let viewMonth = 0; // 0-indexed

  function syncViewToCurrent() {
    if (current && /^\d{4}-\d{2}-\d{2}$/.test(current)) {
      const [y, m] = current.split('-').map(Number);
      viewYear = y;
      viewMonth = m - 1;
    } else {
      const now = new Date();
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
    }
  }

  function paintButton() {
    labelSpan.textContent = current ? formatDateDisplay(current) : 'Select date';
    if (!current) {
      btn.classList.add('empty');
    } else {
      btn.classList.remove('empty');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // Floating Panel
  let panel = null;

  function reposition() {
    if (!panel || !panel.isConnected) return;
    const rect = btn.getBoundingClientRect();
    const panelHeight = panel.offsetHeight || 310;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    panel.style.position = 'fixed';
    panel.style.width = '280px';
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 288, rect.left))}px`;

    if (spaceBelow < panelHeight && spaceAbove > spaceBelow) {
      panel.style.top = `${Math.max(8, rect.top - panelHeight - 6)}px`;
    } else {
      panel.style.top = `${rect.bottom + 6}px`;
    }
  }

  function buildCalendar() {
    if (!panel) return;
    panel.innerHTML = '';

    // Head: < Month Year >
    const head = document.createElement('div');
    head.className = 'ui-dp-panel-head';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'ui-dp-nav-btn';
    prevBtn.innerHTML = '<i data-lucide="chevron-left" width="16" height="16"></i>';
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth--;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
      }
      buildCalendar();
      reposition();
    });

    const titleDiv = document.createElement('div');
    titleDiv.className = 'ui-dp-panel-title';
    titleDiv.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'ui-dp-nav-btn';
    nextBtn.innerHTML = '<i data-lucide="chevron-right" width="16" height="16"></i>';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth++;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
      }
      buildCalendar();
      reposition();
    });

    head.appendChild(prevBtn);
    head.appendChild(titleDiv);
    head.appendChild(nextBtn);
    panel.appendChild(head);

    // Weekdays Mo..Su
    const weekdays = document.createElement('div');
    weekdays.className = 'ui-dp-weekdays';
    DAY_HEADERS.forEach((dh) => {
      const sp = document.createElement('span');
      sp.textContent = dh;
      weekdays.appendChild(sp);
    });
    panel.appendChild(weekdays);

    // Days Grid
    const grid = document.createElement('div');
    grid.className = 'ui-dp-days-grid';

    const firstDay = new Date(viewYear, viewMonth, 1);
    // Sunday is 0 in JS. We want Monday = 0.. Sunday = 6
    let startDayIdx = firstDay.getDay() - 1;
    if (startDayIdx === -1) startDayIdx = 6;

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = todayISO();

    // Blank cells before first day
    for (let i = 0; i < startDayIdx; i++) {
      const blank = document.createElement('span');
      blank.className = 'ui-dp-cell empty';
      grid.appendChild(blank);
    }

    // Month days
    for (let day = 1; day <= daysInMonth; day++) {
      const dayISO = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`;
      const dayBtn = document.createElement('button');
      dayBtn.type = 'button';
      dayBtn.className = 'ui-dp-cell day';
      dayBtn.textContent = String(day);

      if (dayISO === today) dayBtn.classList.add('today');
      if (dayISO === current) dayBtn.classList.add('selected');

      const allowed = isBetween(dayISO, minVal, maxVal);
      if (!allowed) {
        dayBtn.classList.add('disabled');
        dayBtn.disabled = true;
      } else {
        dayBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectDate(dayISO);
        });
      }

      grid.appendChild(dayBtn);
    }

    panel.appendChild(grid);

    // Footer with "Today" button
    const foot = document.createElement('div');
    foot.className = 'ui-dp-panel-foot';
    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'ui-dp-today-btn';
    todayBtn.textContent = 'Today';
    todayBtn.disabled = !isBetween(today, minVal, maxVal);
    todayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectDate(today);
    });
    foot.appendChild(todayBtn);
    panel.appendChild(foot);

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function open() {
    if (panel) close();
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    syncViewToCurrent();

    panel = document.createElement('div');
    panel.className = 'ui-datepicker-panel';
    panel.setAttribute('role', 'dialog');
    document.body.appendChild(panel);

    buildCalendar();
    reposition();

    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('resize', reposition, true);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  function close() {
    if (!panel) return;
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('resize', reposition, true);
    window.removeEventListener('scroll', reposition, true);
    document.removeEventListener('keydown', onKeydown, true);
    panel.remove();
    panel = null;
  }

  function onDocDown(e) {
    if (panel && !panel.contains(e.target) && !btn.contains(e.target)) {
      close();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      btn.focus();
    }
  }

  function selectDate(val) {
    const changed = val !== current;
    current = val;
    paintButton();
    close();
    btn.focus();
    if (changed) {
      host.dispatchEvent(new Event('input', { bubbles: true }));
      host.dispatchEvent(new Event('change', { bubbles: true }));
      if (opts.onChange) opts.onChange(current);
    }
  }

  btn.addEventListener('click', () => {
    if (panel) close();
    else open();
  });

  paintButton();

  return {
    get value() { return current; },
    set value(v) {
      current = v || '';
      paintButton();
    },
    setMin(m) {
      minVal = m || '';
      if (current && minVal && current < minVal) {
        current = minVal;
        paintButton();
      }
    },
    setMax(m) {
      maxVal = m || '';
      if (current && maxVal && current > maxVal) {
        current = maxVal;
        paintButton();
      }
    },
    focus() { btn.focus(); }
  };
}

/**
 * Custom Month Picker
 * @param {HTMLElement} host - Container element
 * @param {Object} opts - { value, min, max, ariaLabel, onChange }
 */
export function createMonthPicker(host, opts = {}) {
  let current = opts.value || '';
  let minVal = opts.min || '';
  let maxVal = opts.max || '';

  host.innerHTML = '';
  host.className = (host.className ? host.className + ' ' : '') + 'ui-dp-host';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-select-btn ui-dp-btn';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  if (opts.ariaLabel) btn.setAttribute('aria-label', opts.ariaLabel);

  const iconLeft = document.createElement('i');
  iconLeft.setAttribute('data-lucide', 'calendar');
  iconLeft.className = 'ui-select-icon';
  btn.appendChild(iconLeft);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'ui-select-label ui-dp-btn-label';
  btn.appendChild(labelSpan);

  const iconRight = document.createElement('i');
  iconRight.setAttribute('data-lucide', 'chevron-down');
  iconRight.className = 'ui-select-chev';
  btn.appendChild(iconRight);

  host.appendChild(btn);

  let viewYear = 0;

  function syncViewToCurrent() {
    if (current && /^\d{4}-\d{2}$/.test(current)) {
      viewYear = Number(current.split('-')[0]);
    } else {
      viewYear = new Date().getFullYear();
    }
  }

  function paintButton() {
    labelSpan.textContent = current ? formatMonthDisplay(current) : 'Select month';
    if (!current) {
      btn.classList.add('empty');
    } else {
      btn.classList.remove('empty');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  let panel = null;

  function reposition() {
    if (!panel || !panel.isConnected) return;
    const rect = btn.getBoundingClientRect();
    const panelHeight = panel.offsetHeight || 220;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    panel.style.position = 'fixed';
    panel.style.width = '280px';
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 288, rect.left))}px`;

    if (spaceBelow < panelHeight && spaceAbove > spaceBelow) {
      panel.style.top = `${Math.max(8, rect.top - panelHeight - 6)}px`;
    } else {
      panel.style.top = `${rect.bottom + 6}px`;
    }
  }

  function buildMonthGrid() {
    if (!panel) return;
    panel.innerHTML = '';

    // Head: < Year >
    const head = document.createElement('div');
    head.className = 'ui-dp-panel-head';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'ui-dp-nav-btn';
    prevBtn.innerHTML = '<i data-lucide="chevron-left" width="16" height="16"></i>';
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewYear--;
      buildMonthGrid();
      reposition();
    });

    const titleDiv = document.createElement('div');
    titleDiv.className = 'ui-dp-panel-title';
    titleDiv.textContent = String(viewYear);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'ui-dp-nav-btn';
    nextBtn.innerHTML = '<i data-lucide="chevron-right" width="16" height="16"></i>';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewYear++;
      buildMonthGrid();
      reposition();
    });

    head.appendChild(prevBtn);
    head.appendChild(titleDiv);
    head.appendChild(nextBtn);
    panel.appendChild(head);

    // 4x3 Month grid
    const grid = document.createElement('div');
    grid.className = 'ui-dp-month-grid';

    MONTH_SHORT.forEach((mShort, idx) => {
      const ym = `${viewYear}-${pad2(idx + 1)}`;
      const mBtn = document.createElement('button');
      mBtn.type = 'button';
      mBtn.className = 'ui-dp-month-cell';
      mBtn.textContent = mShort;

      if (ym === current) mBtn.classList.add('selected');

      const allowed = isBetween(ym, minVal, maxVal);
      if (!allowed) {
        mBtn.classList.add('disabled');
        mBtn.disabled = true;
      } else {
        mBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectMonth(ym);
        });
      }

      grid.appendChild(mBtn);
    });

    panel.appendChild(grid);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function open() {
    if (panel) close();
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    syncViewToCurrent();

    panel = document.createElement('div');
    panel.className = 'ui-datepicker-panel';
    panel.setAttribute('role', 'dialog');
    document.body.appendChild(panel);

    buildMonthGrid();
    reposition();

    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('resize', reposition, true);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('keydown', onKeydown, true);
  }

  function close() {
    if (!panel) return;
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('resize', reposition, true);
    window.removeEventListener('scroll', reposition, true);
    document.removeEventListener('keydown', onKeydown, true);
    panel.remove();
    panel = null;
  }

  function onDocDown(e) {
    if (panel && !panel.contains(e.target) && !btn.contains(e.target)) {
      close();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      btn.focus();
    }
  }

  function selectMonth(val) {
    const changed = val !== current;
    current = val;
    paintButton();
    close();
    btn.focus();
    if (changed) {
      host.dispatchEvent(new Event('input', { bubbles: true }));
      host.dispatchEvent(new Event('change', { bubbles: true }));
      if (opts.onChange) opts.onChange(current);
    }
  }

  btn.addEventListener('click', () => {
    if (panel) close();
    else open();
  });

  paintButton();

  return {
    get value() { return current; },
    set value(v) {
      current = v || '';
      paintButton();
    },
    setMin(m) {
      minVal = m || '';
      if (current && minVal && current < minVal) {
        current = minVal;
        paintButton();
      }
    },
    setMax(m) {
      maxVal = m || '';
      if (current && maxVal && current > maxVal) {
        current = maxVal;
        paintButton();
      }
    },
    focus() { btn.focus(); }
  };
}
