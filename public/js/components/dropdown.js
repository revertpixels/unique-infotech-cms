export function renderDropdown({ id, label, options, value, onChange, disabled }) {
  const container = document.createElement('div');
  container.className = 'dd';
  container.setAttribute('role', 'combobox');
  container.setAttribute('aria-haspopup', 'listbox');
  container.setAttribute('aria-expanded', 'false');
  if (id) container.id = id;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  btn.setAttribute('aria-controls', id ? id + '-menu' : '');
  btn.setAttribute('aria-disabled', String(!!disabled));
  if (disabled) btn.disabled = true;

  const btnLabel = document.createElement('span');
  btnLabel.className = 'dd-btn-label';
  btnLabel.textContent = value || label || '';
  btn.appendChild(btnLabel);

  const btnIcon = document.createElement('i');
  btnIcon.className = 'dd-btn-icon';
  btnIcon.setAttribute('data-lucide', 'chevron-down');
  btn.appendChild(btnIcon);

  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  menu.setAttribute('role', 'listbox');
  if (id) menu.id = id + '-menu';
  menu.style.display = 'none';

  let selectedIndex = options.findIndex(o => o.value === value);
  if (selectedIndex === -1) selectedIndex = 0;

  options.forEach((opt, idx) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dd-item' + (idx === selectedIndex ? ' dd-item-selected' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(idx === selectedIndex));
    if (opt.icon) {
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', opt.icon);
      item.appendChild(icon);
    }
    const txt = document.createElement('span');
    txt.className = 'dd-item-text';
    txt.textContent = opt.label;
    item.appendChild(txt);
    item.addEventListener('click', () => {
      selectedIndex = idx;
      btnLabel.textContent = opt.label;
      container.setAttribute('aria-expanded', 'false');
      menu.style.display = 'none';
      document.querySelectorAll('#' + menu.id + ' .dd-item').forEach(el => {
        el.classList.remove('dd-item-selected');
        el.setAttribute('aria-selected', 'false');
      });
      item.classList.add('dd-item-selected');
      item.setAttribute('aria-selected', 'true');
      if (typeof lucide !== 'undefined') lucide.createIcons();
      if (onChange) onChange(opt.value, opt.label);
    });
    menu.appendChild(item);
  });

  btn.addEventListener('click', (e) => {
    if (disabled) return;
    e.stopPropagation();
    const isOpen = container.getAttribute('aria-expanded') === 'true';
    container.setAttribute('aria-expanded', String(!isOpen));
    menu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen && typeof lucide !== 'undefined') lucide.createIcons();
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      container.setAttribute('aria-expanded', 'false');
      menu.style.display = 'none';
    }
  });

  container.appendChild(btn);
  container.appendChild(menu);

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  return container;
}
