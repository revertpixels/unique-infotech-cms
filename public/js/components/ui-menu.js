let current = null;

export function closeMenu() {
  if (!current) return;
  current.el.remove();
  current.anchor.setAttribute('aria-expanded', 'false');
  document.removeEventListener('mousedown', current.onDown, true);
  document.removeEventListener('keydown', current.onKey, true);
  window.removeEventListener('resize', closeMenu);
  window.removeEventListener('scroll', closeMenu, true);
  current = null;
}

export function openMenu(anchor, items) {
  if (current && current.anchor === anchor) { closeMenu(); return; }
  closeMenu();
  const el = document.createElement('div');
  el.className = 'ui-menu';
  el.setAttribute('role', 'menu');
  items.forEach((it) => {
    if (it === 'sep') { el.appendChild(document.createElement('hr')); return; }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (it.danger) b.className = 'danger';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', it.icon);
    b.appendChild(i);
    b.appendChild(document.createTextNode(it.label));
    b.addEventListener('click', () => { closeMenu(); it.onClick(); });
    el.appendChild(b);
  });
  document.body.appendChild(el);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
  let left = r.right - mw;
  if (left < 8) left = 8;
  el.style.top = top + 'px';
  el.style.left = left + 'px';
  anchor.setAttribute('aria-expanded', 'true');

  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { const a = anchor; closeMenu(); a.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const btns = Array.from(el.querySelectorAll('button'));
      const idx = btns.indexOf(document.activeElement);
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (btns[idx + 1] || btns[0]) : (btns[idx - 1] || btns[btns.length - 1]);
      next.focus();
    }
  };
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);
  current = { el, anchor, onDown, onKey };
  const first = el.querySelector('button');
  if (first) first.focus();
}
