import { getRunningPeriod, getPeriodOptions } from '../utils/date.utils.js?v=1.8.168';
import { loadSessions, getSelectedSessionId, setSelectedSession } from '../core/sessions.js?v=1.8.168';
import { confirmLeave } from '../utils/unsaved-guard.js?v=1.8.168';
import { formatPersonName } from '../utils/formatter.js?v=1.8.168';
import { getRoleTitle, getUserTitle, resolveUserDisplay } from '../services/user-directory.service.js?v=1.8.168';
import { openProfileModal } from './profile-modal.js?v=1.8.168';

let topbarProfileCleanup = null;

function roleLabel(role) {
  return role ? getRoleTitle(role) : '';
}

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

function getPeriodLabelCompat(role) {
  return roleLabel(role);
}

export function renderTopbar({ profile, ctx, canSwitch, onMenu, onSwitch, onOpenOrganisation, onLogout }) {
  const topbar = document.getElementById('topbar');
  topbar.textContent = '';
  const onOpenOrgCb = typeof onOpenOrganisation === 'function' ? onOpenOrganisation : () => { location.hash = '#/org'; };
  const onLogoutCb = typeof onLogout === 'function' ? onLogout : () => {};

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

  // 5. session (Youth Centre only)
  if (ctx === 'youth') {
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
    sessionLabel.textContent = 'Session ...';
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
        li.addEventListener('click', async () => {
          if (s.id === (selected && selected.id)) {
            closeSessionMenu();
            return;
          }
          if (!(await confirmLeave())) {
            closeSessionMenu();
            return;
          }
          pick(s);
          closeSessionMenu();
        });
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
  } else {
    // Kids context: clear stale session-filler reference so the shared
    // uic:sessions-changed listener does not call a stale closure.
    window.__uicFillSessions = null;
    sessionsListenerRegistered = false;
  }

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

  // 7. interactive user profile menu
  if (topbarProfileCleanup) {
    topbarProfileCleanup();
    topbarProfileCleanup = null;
  }

  const chip = document.createElement('div');
  chip.className = 'user-chip';

  const chipBtn = document.createElement('button');
  chipBtn.type = 'button';
  chipBtn.className = 'user-chip-btn';
  chipBtn.setAttribute('aria-haspopup', 'menu');
  chipBtn.setAttribute('aria-expanded', 'false');
  chipBtn.setAttribute('aria-label', 'Account menu');

  const avatar = document.createElement('span');
  avatar.className = 'chip-avatar';
  chipBtn.appendChild(avatar);

  const chipText = document.createElement('div');
  chipText.className = 'chip-text';
  const chipName = document.createElement('div');
  chipName.className = 'chip-name';
  chipText.appendChild(chipName);
  const chipRole = document.createElement('div');
  chipRole.className = 'chip-role';
  chipText.appendChild(chipRole);
  chipBtn.appendChild(chipText);

  const chevIcon = document.createElement('i');
  chevIcon.setAttribute('data-lucide', 'chevron-down');
  chevIcon.className = 'user-chip-chev';
  chipBtn.appendChild(chevIcon);

  const profileMenu = document.createElement('div');
  profileMenu.className = 'tb-profile-menu';
  profileMenu.setAttribute('role', 'menu');
  profileMenu.hidden = true;

  const menuHead = document.createElement('div');
  menuHead.className = 'tb-profile-head';
  const menuHeadName = document.createElement('b');
  const menuHeadRole = document.createElement('span');
  const menuHeadEmail = document.createElement('small');
  menuHead.append(menuHeadName, menuHeadRole, menuHeadEmail);
  profileMenu.appendChild(menuHead);

  const itemProfile = document.createElement('button');
  itemProfile.type = 'button';
  itemProfile.className = 'tb-profile-item';
  itemProfile.setAttribute('role', 'menuitem');
  itemProfile.innerHTML = '<i data-lucide="user"></i><span>Profile</span>';
  profileMenu.appendChild(itemProfile);

  let itemOrg = null;
  if (profile && profile.role === 'superadmin') {
    itemOrg = document.createElement('button');
    itemOrg.type = 'button';
    itemOrg.className = 'tb-profile-item';
    itemOrg.setAttribute('role', 'menuitem');
    itemOrg.innerHTML = '<i data-lucide="landmark"></i><span>Organisation</span>';
    profileMenu.appendChild(itemOrg);
  }

  const sep = document.createElement('hr');
  sep.className = 'tb-profile-sep';
  profileMenu.appendChild(sep);

  const itemLogout = document.createElement('button');
  itemLogout.type = 'button';
  itemLogout.className = 'tb-profile-item danger';
  itemLogout.setAttribute('role', 'menuitem');
  itemLogout.innerHTML = '<i data-lucide="log-out"></i><span>Logout</span>';
  profileMenu.appendChild(itemLogout);

  function syncTopbarIdentity() {
    const disp = resolveUserDisplay(
      profile && profile.email,
      profile && profile.name,
      profile && profile.designation
    );
    const displayName = disp.name || formatPersonName(profile && (profile.name || profile.email)) || '';
    const displayRole = getUserTitle(profile) || disp.designation || roleLabel(profile && profile.role);

    avatar.textContent = '';
    if (disp.photoUrl) {
      const img = document.createElement('img');
      img.src = disp.photoUrl;
      img.alt = displayName;
      avatar.appendChild(img);
    } else {
      avatar.textContent = initials(profile);
    }
    chipName.textContent = displayName;
    chipRole.textContent = displayRole;
    menuHeadName.textContent = displayName;
    menuHeadRole.textContent = displayRole;
    menuHeadEmail.textContent = (profile && profile.email) || '';
  }

  function closeProfileMenu() {
    profileMenu.hidden = true;
    chipBtn.setAttribute('aria-expanded', 'false');
  }

  function openProfileMenu() {
    syncTopbarIdentity();
    profileMenu.hidden = false;
    chipBtn.setAttribute('aria-expanded', 'true');
  }

  chipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (profileMenu.hidden) openProfileMenu();
    else closeProfileMenu();
  });

  itemProfile.addEventListener('click', () => {
    closeProfileMenu();
    openProfileModal({
      profile,
      onOpenOrganisation: () => {
        location.hash = '#/org?tab=authorised';
      }
    });
  });

  if (itemOrg) {
    itemOrg.addEventListener('click', () => {
      closeProfileMenu();
      onOpenOrgCb();
    });
  }

  itemLogout.addEventListener('click', () => {
    closeProfileMenu();
    onLogoutCb();
  });

  const onDocClick = (e) => {
    if (!chip.contains(e.target)) closeProfileMenu();
  };
  const onDocKey = (e) => {
    if (e.key === 'Escape') closeProfileMenu();
  };
  const onProfileChange = () => syncTopbarIdentity();

  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKey);
  window.addEventListener('uic:profile-updated', onProfileChange);
  window.addEventListener('uic:users-updated', onProfileChange);
  window.addEventListener('uic:branding-updated', onProfileChange);

  topbarProfileCleanup = () => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKey);
    window.removeEventListener('uic:profile-updated', onProfileChange);
    window.removeEventListener('uic:users-updated', onProfileChange);
    window.removeEventListener('uic:branding-updated', onProfileChange);
  };

  syncTopbarIdentity();
  chip.append(chipBtn, profileMenu);
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
















