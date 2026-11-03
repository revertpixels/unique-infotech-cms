import { getRunningPeriod, getPeriodOptions } from '../utils/date.utils.js?v=1.3.8';

let listenersRegistered = false;

function initials(profile) {
  const name = (profile && profile.name) ? profile.name.trim() : '';
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const email = (profile && profile.email) ? profile.email.trim() : '';
  return email.slice(0, 2).toUpperCase();
}

function roleLabel(role) {
  if (role === 'superadmin') return 'Super Admin';
  if (role === 'branch_head') return 'Branch Head';
  if (role === 'school_head') return 'School Head';
  return role || '';
}

export function renderTopbar({ profile, ctx, canSwitch, onMenu, onSwitch }) {
  const topbar = document.getElementById('topbar');
  topbar.textContent = '';

  // 1. hamburger
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
    const app = document.getElementById('app');
    const open = app.classList.contains('drawer-open') || !app.classList.contains('sb-collapsed');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  topbar.appendChild(menuBtn);

  // 2. title
  const title = document.createElement('h1');
  title.id = 'page-title';
  title.textContent = 'Dashboard';
  topbar.appendChild(title);

  // 3. context switch
  if (canSwitch) {
    const group = document.createElement('div');
    group.className = 'ctx-switch';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Section');

    const youthBtn = document.createElement('button');
    youthBtn.type = 'button';
    youthBtn.className = 'ctx-btn';
    youthBtn.dataset.ctx = 'youth';
    youthBtn.setAttribute('aria-pressed', ctx === 'youth' ? 'true' : 'false');
    const youthIcon = document.createElement('i');
    youthIcon.setAttribute('data-lucide', 'users');
    youthBtn.appendChild(youthIcon);
    const youthText = document.createElement('span');
    youthText.textContent = 'Youth Centre';
    youthBtn.appendChild(youthText);
    youthBtn.addEventListener('click', () => { if (onSwitch) onSwitch('youth'); });
    group.appendChild(youthBtn);

    const schoolBtn = document.createElement('button');
    schoolBtn.type = 'button';
    schoolBtn.className = 'ctx-btn';
    schoolBtn.dataset.ctx = 'school';
    schoolBtn.setAttribute('aria-pressed', ctx === 'school' ? 'true' : 'false');
    const schoolIcon = document.createElement('i');
    schoolIcon.setAttribute('data-lucide', 'graduation-cap');
    schoolBtn.appendChild(schoolIcon);
    const schoolText = document.createElement('span');
    schoolText.textContent = 'Unique Kids';
    schoolBtn.appendChild(schoolText);
    schoolBtn.addEventListener('click', () => { if (onSwitch) onSwitch('school'); });
    group.appendChild(schoolBtn);

    topbar.appendChild(group);
  }

  // 5. session
  const sessionWrap = document.createElement('div');
  sessionWrap.className = 'tb-session';
  const sessionBtn = document.createElement('button');
  sessionBtn.type = 'button';
  sessionBtn.id = 'session-btn';
  sessionBtn.setAttribute('aria-haspopup', 'listbox');
  sessionBtn.setAttribute('aria-expanded', 'false');
  const calIcon = document.createElement('i');
  calIcon.setAttribute('data-lucide', 'calendar');
  sessionBtn.appendChild(calIcon);
  const sessionLabel = document.createElement('span');
  sessionLabel.className = 'tb-session-label';
  const running = getRunningPeriod(ctx, new Date());
  sessionLabel.textContent = 'Session ' + running.name;
  sessionBtn.appendChild(sessionLabel);
  const chevIcon = document.createElement('i');
  chevIcon.setAttribute('data-lucide', 'chevron-down');
  sessionBtn.appendChild(chevIcon);
  sessionWrap.appendChild(sessionBtn);

  const menu = document.createElement('ul');
  menu.className = 'tb-menu';
  menu.setAttribute('role', 'listbox');
  const options = getPeriodOptions(ctx, new Date());
  let saved = null;
  try { saved = localStorage.getItem('uicms.session'); } catch (e) {}
  let selectedValue = saved && options.some(o => o.label === saved) ? saved : (options[0] ? options[0].label : null);
  if (selectedValue) sessionLabel.textContent = 'Session ' + selectedValue;
  for (const opt of options) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.textContent = opt.label;
    li.dataset.value = opt.label;
    if (opt.label === selectedValue) li.setAttribute('aria-selected', 'true');
    li.addEventListener('click', () => {
      selectedValue = opt.label;
      sessionLabel.textContent = 'Session ' + opt.label;
      try { localStorage.setItem('uicms.session', opt.label); } catch (e) {}
      menu.querySelectorAll('li').forEach(x => x.removeAttribute('aria-selected'));
      li.setAttribute('aria-selected', 'true');
      sessionWrap.classList.remove('open');
      sessionBtn.setAttribute('aria-expanded', 'false');
    });
    menu.appendChild(li);
  }
  sessionWrap.appendChild(menu);
  sessionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !sessionWrap.classList.contains('open');
    sessionWrap.classList.toggle('open', open);
    sessionBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  topbar.appendChild(sessionWrap);

  // 6. bell
  const notifBtn = document.createElement('button');
  notifBtn.type = 'button';
  notifBtn.id = 'notif-btn';
  notifBtn.className = 'icon-btn';
  notifBtn.setAttribute('aria-label', 'Notifications');
  const bellIcon = document.createElement('i');
  bellIcon.setAttribute('data-lucide', 'bell');
  notifBtn.appendChild(bellIcon);
  const dot = document.createElement('span');
  dot.className = 'tb-dot';
  dot.hidden = true;
  notifBtn.appendChild(dot);
  topbar.appendChild(notifBtn);

  // 7. user chip
  const chip = document.createElement('div');
  chip.className = 'user-chip';
  const avatar = document.createElement('span');
  avatar.className = 'chip-avatar';
  avatar.textContent = initials(profile);
  chip.appendChild(avatar);
  const chipText = document.createElement('div');
  chipText.className = 'chip-text';
  const chipName = document.createElement('div');
  chipName.className = 'chip-name';
  chipName.textContent = (profile && (profile.name || profile.email)) || '';
  chipText.appendChild(chipName);
  const chipRole = document.createElement('div');
  chipRole.className = 'chip-role';
  chipRole.textContent = roleLabel(profile && profile.role);
  chipText.appendChild(chipRole);
  chip.appendChild(chipText);
  topbar.appendChild(chip);

  if (!listenersRegistered) {
    listenersRegistered = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tb-session')) {
        document.querySelectorAll('.tb-session.open').forEach(el => {
          el.classList.remove('open');
          const b = el.querySelector('#session-btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        });
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.tb-session.open').forEach(el => {
          el.classList.remove('open');
          const b = el.querySelector('#session-btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        });
      }
    });
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export function setPageTitle(text) {
  const el = document.getElementById('page-title');
  if (el) el.textContent = text;
}

export function setSwitcherActive(ctx) {
  const btns = document.querySelectorAll('.ctx-switch .ctx-btn');
  for (const b of btns) {
    b.setAttribute('aria-pressed', b.dataset.ctx === ctx ? 'true' : 'false');
  }
}

export function setNotifCount(n) {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  const dot = btn.querySelector('.tb-dot');
  const count = Number(n) > 0 ? Number(n) : 0;
  if (dot) dot.hidden = count === 0;
  btn.setAttribute('aria-label', count > 0 ? 'Notifications (' + count + ' new)' : 'Notifications');
}
