import { ROUTES, ROLE_LABELS } from '../core/router.js?v=1.3.5';
import { APP_VERSION } from '../core/app.js?v=1.3.5';
import { getRunningPeriod, getNextDueDate, formatDayMonth } from '../utils/date.utils.js?v=1.3.5';

let drawerOpen = false;
let tipEl = null;
let sessionInterval = null;

function ensureTip() {
  if (tipEl && document.body.contains(tipEl)) return tipEl;
  tipEl = document.createElement('div');
  tipEl.id = 'sb-tip';
  tipEl.className = 'sb-tip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  return tipEl;
}

function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

function buildSessionCard(ctx, dueDay) {
  const rp = getRunningPeriod(ctx, new Date());
  const card = document.createElement('div');
  card.className = 'sb-session';
  const top = document.createElement('div');
  top.className = 'ss-top';
  const label = document.createElement('span');
  label.className = 'sl-label';
  label.textContent = rp.kindLabel;
  const pct = document.createElement('b');
  pct.textContent = rp.percent + '%';
  top.appendChild(label); top.appendChild(pct);
  card.appendChild(top);
  const name = document.createElement('div');
  name.className = 'ss-name';
  name.textContent = rp.name;
  card.appendChild(name);
  const bar = document.createElement('div');
  bar.className = 'ss-bar';
  const fill = document.createElement('i');
  fill.style.width = rp.percent + '%';
  bar.appendChild(fill);
  card.appendChild(bar);
  const meta = document.createElement('div');
  meta.className = 'ss-meta';
  if (ctx === 'youth') {
    if (rp.daysLeft === 0) meta.textContent = 'Ends today';
    else if (rp.daysLeft === 1) meta.textContent = 'Ends ' + formatDayMonth(rp.end) + ' · 1 day left';
    else meta.textContent = 'Ends ' + formatDayMonth(rp.end) + ' · ' + rp.daysLeft + ' days left';
  } else {
    meta.textContent = 'Next fee due ' + formatDayMonth(getNextDueDate(new Date(), dueDay));
  }
  card.appendChild(meta);
  return card;
}

export function refreshSessionCard(ctx) {
  const footer = document.querySelector('#sidebar .sb-footer');
  if (!footer) return;
  const old = footer.querySelector('.sb-session');
  const dueDay = (window.APP_CACHE && window.APP_CACHE.org && Number.isInteger(window.APP_CACHE.org.fineAfterDay)) ? window.APP_CACHE.org.fineAfterDay : 10;
  const card = buildSessionCard(ctx, dueDay);
  if (old) old.replaceWith(card);
}

export function renderSidebar({ profile, ctx, orgName, tagline, onNavigate, onLogout }) {
  const sidebar = document.getElementById('sidebar');
  sidebar.textContent = '';

  if (sessionInterval) { clearInterval(sessionInterval); sessionInterval = null; }

  // brand
  const brand = document.createElement('div');
  brand.className = 'sb-brand';
  const logoBox = document.createElement('div');
  logoBox.className = 'logo-box';
  const img = document.createElement('img');
  img.src = '/assets/images/logo-192.jpg';
  img.alt = '';
  logoBox.appendChild(img);
  brand.appendChild(logoBox);
  const brandTxt = document.createElement('div');
  brandTxt.className = 'brand-txt';
  const h3 = document.createElement('h3');
  h3.textContent = orgName || 'Unique Infotech CMS';
  brandTxt.appendChild(h3);
  if (tagline) {
    const p = document.createElement('p');
    p.textContent = tagline;
    brandTxt.appendChild(p);
  }
  brand.appendChild(brandTxt);
  sidebar.appendChild(brand);

  // nav
  const nav = document.createElement('nav');
  nav.className = 'sb-nav';
  nav.setAttribute('aria-label', 'Main navigation');

  const filtered = Object.values(ROUTES).filter(r => r.ctx.includes(ctx) && r.roles.includes(profile.role));
  const groups = {};
  const groupOrder = [];
  for (const r of filtered) {
    if (!groups[r.group]) { groups[r.group] = []; groupOrder.push(r.group); }
    groups[r.group].push(r);
  }

  for (const groupName of groupOrder) {
    const section = document.createElement('div');
    section.className = 'sb-section';
    const glabel = document.createElement('div');
    glabel.className = 'sb-section-label';
    const slText = document.createElement('span');
    slText.className = 'sl-text';
    slText.textContent = groupName;
    glabel.appendChild(slText);
    nav.appendChild(glabel);
    for (const r of groups[groupName]) {
      const a = document.createElement('a');
      a.className = 'sb-item';
      a.href = '#/' + r.key;
      a.setAttribute('data-key', r.key);
      a.setAttribute('data-label', r.label);
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', r.icon);
      a.appendChild(icon);
      const span = document.createElement('span');
      span.className = 'nl';
      span.textContent = r.label;
      a.appendChild(span);
      a.addEventListener('click', () => {
        if (onNavigate) onNavigate();
        closeDrawer();
      });
      nav.appendChild(a);
    }
  }
  sidebar.appendChild(nav);

  // footer
  const footer = document.createElement('div');
  footer.className = 'sb-footer';

  const dueDay = (window.APP_CACHE && window.APP_CACHE.org && Number.isInteger(window.APP_CACHE.org.fineAfterDay)) ? window.APP_CACHE.org.fineAfterDay : 10;
  const sessionCard = buildSessionCard(ctx, dueDay);
  footer.appendChild(sessionCard);

  // temporary identity row
  const identity = document.createElement('div');
  identity.className = 'sb-identity';
  // TEMPORARY - moves to the topbar user menu in Step 5c-3
  const idLeft = document.createElement('div');
  const idName = document.createElement('div');
  idName.className = 'sb-identity-name';
  idName.textContent = profile.name || profile.email || '';
  idLeft.appendChild(idName);
  const idRole = document.createElement('div');
  idRole.className = 'sb-identity-role';
  idRole.textContent = ROLE_LABELS[profile.role] || profile.role;
  idLeft.appendChild(idRole);
  identity.appendChild(idLeft);
  const signout = document.createElement('button');
  signout.type = 'button';
  signout.className = 'sb-identity-btn';
  signout.title = 'Sign out';
  signout.setAttribute('aria-label', 'Sign out');
  const signoutIcon = document.createElement('i');
  signoutIcon.setAttribute('data-lucide', 'log-out');
  signout.appendChild(signoutIcon);
  signout.addEventListener('click', () => { if (onLogout) onLogout(); });
  identity.appendChild(signout);
  footer.appendChild(identity);

  const ver = document.createElement('div');
  ver.className = 'sb-ver';
  const vspan = document.createElement('span');
  vspan.textContent = 'v' + APP_VERSION;
  ver.appendChild(vspan);
  const bd = document.createElement('span');
  bd.className = 'bd';
  ver.appendChild(bd);
  footer.appendChild(ver);

  sidebar.appendChild(footer);

  // tooltip element
  ensureTip();

  // collapsed title handling
  const app = document.getElementById('app');
  const collapsed = app.classList.contains('sb-collapsed');
  document.querySelectorAll('#sidebar .sb-item').forEach(el => {
    if (collapsed) el.removeAttribute('title');
    else el.title = el.getAttribute('data-label') || '';
  });

  // tooltip handlers
  document.querySelectorAll('#sidebar .sb-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      if (!app.classList.contains('sb-collapsed')) return;
      if (window.innerWidth <= 768) return;
      const tip = ensureTip();
      tip.textContent = el.getAttribute('data-label') || '';
      const rect = el.getBoundingClientRect();
      tip.style.left = (rect.right + 10) + 'px';
      tip.style.top = (rect.top + rect.height / 2) + 'px';
      tip.classList.add('show');
    });
    el.addEventListener('mouseleave', () => { ensureTip().classList.remove('show'); });
    el.addEventListener('focus', () => {
      if (!app.classList.contains('sb-collapsed')) return;
      if (window.innerWidth <= 768) return;
      const tip = ensureTip();
      tip.textContent = el.getAttribute('data-label') || '';
      const rect = el.getBoundingClientRect();
      tip.style.left = (rect.right + 10) + 'px';
      tip.style.top = (rect.top + rect.height / 2) + 'px';
      tip.classList.add('show');
    });
    el.addEventListener('blur', () => { ensureTip().classList.remove('show'); });
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // interval
  sessionInterval = setInterval(() => {
    const c = document.body.getAttribute('data-ctx') || ctx;
    refreshSessionCard(c);
  }, 600000);
  refreshSessionCard(ctx);
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
  if (bool) app.classList.add('sb-collapsed');
  else app.classList.remove('sb-collapsed');
  // title handling
  document.querySelectorAll('#sidebar .sb-item').forEach(el => {
    if (bool) el.removeAttribute('title');
    else el.title = el.getAttribute('data-label') || '';
  });
  try { sessionStorage.setItem('uic_sb', String(bool)); } catch (e) {}
}

export function toggleDrawer(open) {
  const app = document.getElementById('app');
  const btn = document.getElementById('menu-btn');
  if (open === undefined) open = !drawerOpen;
  if (open) {
    app.classList.add('drawer-open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  } else {
    app.classList.remove('drawer-open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  drawerOpen = open;
}

export function closeDrawer() { toggleDrawer(false); }

function loadSavedCollapsed() {
  try { return sessionStorage.getItem('uic_sb') === 'true'; } catch (e) { return false; }
}

export function initSidebar() { setCollapsed(loadSavedCollapsed()); }

export function setNavCount(key, count, isAlert) {
  document.querySelectorAll('#sidebar .sb-item').forEach(el => {
    if (el.getAttribute('data-key') !== key) return;
    let pill = el.querySelector('.nav-count');
    if (!count || count <= 0) {
      if (pill) pill.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'nav-count';
      el.appendChild(pill);
    }
    pill.textContent = count > 99 ? '99+' : String(count);
    if (isAlert) pill.classList.add('alert'); else pill.classList.remove('alert');
  });
}
