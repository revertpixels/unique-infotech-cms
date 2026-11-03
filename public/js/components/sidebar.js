import { ROUTES, ROLE_LABELS } from '../core/router.js';
import { APP_VERSION } from '../core/app.js?v=1.2.0';

let drawerOpen = false;

export function renderSidebar({ profile, ctx, orgName, onNavigate, onLogout }) {
  const sidebar = document.getElementById('sidebar');
  sidebar.textContent = '';

  const brand = document.createElement('div');
  brand.className = 'sb-brand';
  const img = document.createElement('img');
  img.src = '/assets/images/logo.jpg';
  img.alt = '';
  img.width = 36;
  img.height = 36;
  brand.appendChild(img);
  const brandName = document.createElement('span');
  brandName.className = 'sb-brand-name';
  brandName.textContent = orgName || 'Unique Infotech CMS';
  brand.appendChild(brandName);
  sidebar.appendChild(brand);

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Main navigation');

  const filtered = Object.values(ROUTES).filter(r => r.ctx.includes(ctx) && r.roles.includes(profile.role));
  const groups = {};
  for (const r of filtered) {
    if (!groups[r.group]) groups[r.group] = [];
    groups[r.group].push(r);
  }

  for (const groupName of Object.keys(groups)) {
    const glabel = document.createElement('div');
    glabel.className = 'sb-group-label';
    glabel.textContent = groupName.toUpperCase();
    nav.appendChild(glabel);
    for (const r of groups[groupName]) {
      const a = document.createElement('a');
      a.className = 'sb-item';
      a.href = '#/' + r.key;
      a.setAttribute('data-key', r.key);
      a.title = r.label;
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', r.icon);
      a.appendChild(icon);
      const span = document.createElement('span');
      span.className = 'sb-label';
      span.textContent = r.label;
      a.appendChild(span);
      a.addEventListener('click', () => {
        if (onNavigate) onNavigate();
      });
      nav.appendChild(a);
    }
  }
  sidebar.appendChild(nav);

  const card = document.createElement('div');
  card.className = 'sb-session';
  const name = document.createElement('div');
  name.className = 'sb-session-name';
  name.textContent = profile.name || profile.email || '';
  card.appendChild(name);
  const roleLine = document.createElement('div');
  roleLine.className = 'sb-session-role';
  roleLine.textContent = ROLE_LABELS[profile.role] || profile.role;
  card.appendChild(roleLine);
  if (profile.branchName) {
    const branchLine = document.createElement('div');
    branchLine.className = 'sb-session-branch';
    branchLine.textContent = profile.branchName;
    card.appendChild(branchLine);
  }
  const signout = document.createElement('button');
  signout.type = 'button';
  signout.className = 'btn ghost sb-session-signout';
  const signoutIcon = document.createElement('i');
  signoutIcon.setAttribute('data-lucide', 'log-out');
  signout.appendChild(signoutIcon);
  const signoutText = document.createElement('span');
  signoutText.textContent = 'Sign out';
  signout.appendChild(signoutText);
  signout.addEventListener('click', () => {
    if (onLogout) onLogout();
  });
  card.appendChild(signout);
  const ver = document.createElement('div');
  ver.className = 'sb-session-version';
  ver.textContent = 'v' + APP_VERSION;
  card.appendChild(ver);
  sidebar.appendChild(card);

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

export function setActiveRoute(key) {
  document.querySelectorAll('#sidebar .sb-item').forEach(el => {
    el.removeAttribute('aria-current');
    el.classList.remove('active');
  });
  document.querySelectorAll('#sidebar .sb-item').forEach(el => {
    if (el.getAttribute('data-key') === key) {
      el.setAttribute('aria-current', 'page');
      el.classList.add('active');
    }
  });
}

export function setCollapsed(bool) {
  const app = document.getElementById('app');
  if (bool) {
    app.classList.add('sb-collapsed');
  } else {
    app.classList.remove('sb-collapsed');
  }
  try {
    sessionStorage.setItem('uic_sb', String(bool));
  } catch (e) {
    // silent
  }
}

export function toggleDrawer(open) {
  const app = document.getElementById('app');
  const btn = document.getElementById('menu-btn');
  if (open === undefined) {
    open = !drawerOpen;
  }
  if (open) {
    app.classList.add('drawer-open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  } else {
    app.classList.remove('drawer-open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  drawerOpen = open;
}

export function closeDrawer() {
  toggleDrawer(false);
}

function loadSavedCollapsed() {
  try {
    const v = sessionStorage.getItem('uic_sb');
    return v === 'true';
  } catch (e) {
    return false;
  }
}

export function initSidebar() {
  setCollapsed(loadSavedCollapsed());
}
