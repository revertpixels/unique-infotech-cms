export function renderTopbar({ profile, ctx, canSwitch, onMenu, onSwitch }) {
  const topbar = document.getElementById('topbar');
  topbar.textContent = '';

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.id = 'menu-btn';
  menuBtn.className = 'icon-btn';
  menuBtn.setAttribute('aria-label', 'Toggle menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  const menuIcon = document.createElement('i');
  menuIcon.setAttribute('data-lucide', 'menu');
  menuBtn.appendChild(menuIcon);
  menuBtn.addEventListener('click', () => {
    if (onMenu) onMenu();
  });
  topbar.appendChild(menuBtn);

  const title = document.createElement('h1');
  title.id = 'page-title';
  title.textContent = 'Dashboard';
  topbar.appendChild(title);

  if (canSwitch) {
    const group = document.createElement('div');
    group.className = 'ctx-switch';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Section');

    const youthBtn = document.createElement('button');
    youthBtn.type = 'button';
    youthBtn.className = 'ctx-btn';
    youthBtn.setAttribute('aria-pressed', ctx === 'youth' ? 'true' : 'false');
    const youthIcon = document.createElement('i');
    youthIcon.setAttribute('data-lucide', 'users');
    youthBtn.appendChild(youthIcon);
    const youthText = document.createElement('span');
    youthText.textContent = 'Youth Centre';
    youthBtn.appendChild(youthText);
    youthBtn.addEventListener('click', () => {
      if (onSwitch) onSwitch('youth');
    });
    group.appendChild(youthBtn);

    const schoolBtn = document.createElement('button');
    schoolBtn.type = 'button';
    schoolBtn.className = 'ctx-btn';
    schoolBtn.setAttribute('aria-pressed', ctx === 'school' ? 'true' : 'false');
    const schoolIcon = document.createElement('i');
    schoolIcon.setAttribute('data-lucide', 'graduation-cap');
    schoolBtn.appendChild(schoolIcon);
    const schoolText = document.createElement('span');
    schoolText.textContent = 'Unique Kids';
    schoolBtn.appendChild(schoolText);
    schoolBtn.addEventListener('click', () => {
      if (onSwitch) onSwitch('school');
    });
    group.appendChild(schoolBtn);

    topbar.appendChild(group);
  }

  const chip = document.createElement('div');
  chip.className = 'user-chip';
  const name = document.createElement('div');
  name.className = 'chip-name';
  name.textContent = profile.name || profile.email || '';
  chip.appendChild(name);
  const role = document.createElement('div');
  role.className = 'chip-role';
  role.textContent = (profile.role === 'superadmin' ? 'Super Admin' : profile.role === 'branch_head' ? 'Branch Head' : 'School Head');
  chip.appendChild(role);
  topbar.appendChild(chip);

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

export function setPageTitle(text) {
  const el = document.getElementById('page-title');
  if (el) el.textContent = text;
}

export function setSwitcherActive(ctx) {
  const btns = document.querySelectorAll('.ctx-switch .ctx-btn');
  for (const b of btns) {
    const isYouth = b.textContent.trim() === 'Youth Centre';
    b.setAttribute('aria-pressed', (ctx === 'youth') === isYouth ? 'true' : 'false');
  }
}
