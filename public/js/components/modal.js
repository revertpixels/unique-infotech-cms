// Shared popup helper used by all status-based three-dots menu popups on Students pages (v1.8.90)
// Usage:
//   const popup = openPopup({
//     title: 'View details',
//     subtitle: 'HARANATH SAHA — 20260001 — Advanced / COMMON BATCH',
//     icon: 'eye',
//     tone: 'default',          // 'default' (teal) | 'success' (green) | 'danger' (red) | 'amber' (amber)
//     wide: false,              // true for 680px max-width (default 600px)
//     onClose: () => {},        // optional; called when popup closes
//     saving: () => savingFlag, // optional getter; blocks Escape/backdrop while true
//   });
//   popup.container.appendChild(myContentElement);
//   popup.close();              // programmatically close
export function openPopup({ title = '', subtitle = '', icon = '', tone = 'default', wide = false, onClose, saving } = {}) {
  const prevFocus = document.activeElement;

  const back = document.createElement('div');
  back.className = 'ui-modal-back';
  const box = document.createElement('div');
  box.className = 'ui-modal' + (wide ? ' wide' : '');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('data-tone', tone || 'default');

  const head = document.createElement('div');
  head.className = 'adm-view-head';

  const left = document.createElement('div');
  left.className = 'adm-view-head-left';

  // 40px rounded icon tile matching stat cards
  if (icon) {
    const tile = document.createElement('div');
    tile.className = 'adm-view-tile ' + (tone || 'default');
    tile.innerHTML = `<i data-lucide="${icon}" width="19" height="19"></i>`;
    left.appendChild(tile);
  }

  const titles = document.createElement('div');
  titles.className = 'adm-view-titles';

  const titleEl = document.createElement('h3');
  titleEl.className = 'adm-view-title';
  titleEl.textContent = title;
  titles.appendChild(titleEl);

  if (subtitle) {
    const subEl = document.createElement('p');
    subEl.className = 'adm-view-subtitle';
    subEl.textContent = subtitle;
    titles.appendChild(subEl);
  }
  left.appendChild(titles);
  head.appendChild(left);

  // Ghost icon button matching topbar / refresh button
  const xBtn = document.createElement('button');
  xBtn.type = 'button';
  xBtn.className = 'ui-btn ghost adm-view-close';
  xBtn.setAttribute('aria-label', 'Close');
  xBtn.innerHTML = '<i data-lucide="x" width="18" height="18"></i>';
  xBtn.addEventListener('click', (ev) => { ev.stopPropagation(); close(); });

  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'adm-view-head-actions';
  actionsWrap.appendChild(xBtn);
  head.appendChild(actionsWrap);
  box.appendChild(head);

  const container = document.createElement('div');
  container.className = 'adm-view-body';
  box.appendChild(container);

  // 1. Append box inside back BEFORE attaching to DOM
  back.appendChild(box);

  let closed = false;

  function close() {
    if (closed) return;
    if (saving && typeof saving === 'function' && saving()) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown);
    document.body.style.overflow = '';
    back.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch (_) { /* silent */ }
    }
    if (typeof onClose === 'function') onClose();
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape') {
      if (saving && typeof saving === 'function' && saving()) return;
      close();
    }
  }

  back.addEventListener('click', (ev) => {
    if (ev.target === back) {
      if (saving && typeof saving === 'function' && saving()) return;
      close();
    }
  });
  document.addEventListener('keydown', onKeydown);

  document.body.style.overflow = 'hidden';

  document.body.appendChild(back);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  requestAnimationFrame(() => {
    // Focus first interactive element inside content container (avoiding header action/close buttons)
    const focusable = container.querySelector('input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (focusable) {
      focusable.focus();
    } else {
      box.tabIndex = -1;
      box.focus({ preventScroll: true });
    }
  });

  return { el: box, box, head, actions: actionsWrap, close, container, backdrop: back };
}
