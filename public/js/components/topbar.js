import { getRunningPeriod, getPeriodOptions } from '../utils/date.utils.js?v=1.8.13';
import { loadSessions, getSelectedSessionId, setSelectedSession } from '../core/sessions.js?v=1.8.13';

let listenersRegistered = false;
let sessionsListenerRegistered = false;

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
  sessionLabel.textContent = 'Session …';
  sessionBtn.appendChild(sessionLabel);
  const chevIcon = document.createElement('i');
  chevIcon.setAttribute('data-lucide', 'chevron-down');
  sessionBtn.appendChild(chevIcon);
  sessionWrap.appendChild(sessionBtn);

  const menu = document.createElement('ul');
  menu.className = 'tb-menu';
  menu.setAttribute('role', 'listbox');
  sessionWrap.appendChild(menu);

  function closeSessionMenu() {
    sessionWrap.classList.remove('open');
    sessionBtn.setAttribute('aria-expanded', 'false');
  }

  async function fillSessions() {
    const list = await loadSessions(ctx);
    menu.textContent = '';
    if (!list.length) {
      sessionLabel.textContent = 'No session';
      const li = document.createElement('li');
      if (profile && profile.role === 'superadmin') {
        const ic = document.createElement('i');
        ic.setAttribute('data-lucide', 'plus');
        li.appendChild(ic);
        li.appendChild(document.createTextNode('Create a session'));
        li.addEventListener('click', () => { closeSessionMenu(); location.hash = '#/sessions'; });
      } else {
        li.textContent = 'No sessions yet';
        li.setAttribute('aria-disabled', 'true');
      }
      menu.appendChild(li);
      setSelectedSession(ctx, null);
      if (typeof lucide !== 'undefined') lucide.createIcons();
      window.dispatchEvent(new Event('uic:sessions-loaded'));
      return;
    }
    const savedId = getSelectedSessionId(ctx);
    const running = list.find((s) => s.status === 'running');
    let selected = list.find((s) => s.id === savedId) || running || list[0];

    function pick(s) {
      selected = s;
      sessionLabel.textContent = 'Session ' + s.name;
      menu.querySelectorAll('li').forEach((x) => {
        if (x.dataset.id === s.id) x.setAttribute('aria-selected', 'true');
        else x.removeAttribute('aria-selected');
      });
      setSelectedSession(ctx, s);
    }

    list.forEach((s) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.id = s.id;
      const ic = document.createElement('i');
      ic.setAttribute('data-lucide', s.status === 'running' ? 'play-circle' : 'calendar');
      li.appendChild(ic);
      const nm = document.createElement('span');
      nm.textContent = s.name;
      li.appendChild(nm);
      if (s.status === 'running') {
        const tag = document.createElement('span');
        tag.className = 'tb-tag';
        tag.textContent = 'Running';
        li.appendChild(tag);
      }
      li.addEventListener('click', () => { pick(s); closeSessionMenu(); });
      menu.appendChild(li);
    });
    pick(selected);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    window.dispatchEvent(new Event('uic:sessions-loaded'));
  }

  fillSessions();
  window.__uicFillSessions = fillSessions;
  if (!sessionsListenerRegistered) {
    sessionsListenerRegistered = true;
    window.addEventListener('uic:sessions-changed', () => {
      if (window.__uicFillSessions) window.__uicFillSessions();
    });
  }
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
