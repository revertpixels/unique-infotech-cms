import { confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.13';

export const ROLE_LABELS = {
  superadmin: 'Super Admin',
  branch_head: 'Branch Head',
  school_head: 'School Head'
};

export const ROUTES = {
  dashboard: { label: 'Dashboard', icon: 'layout-dashboard', group: 'Main', page: 'dashboard', ctx: ['youth', 'school'], roles: ['superadmin', 'branch_head', 'school_head'] },
  branches: { label: 'Branches', icon: 'git-branch', group: 'Academics', page: 'branches', ctx: ['youth'], roles: ['superadmin'] },
  courses: { label: 'Courses & Packages', icon: 'layers', group: 'Academics', page: 'courses', ctx: ['youth', 'school'], roles: ['superadmin'] },
  batches: { label: 'Batches', icon: 'users-round', group: 'Academics', page: 'batches', ctx: ['youth', 'school'], roles: ['superadmin'] },
  students: { label: 'All Students', icon: 'users', group: 'Students', page: 'students', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  admissions: { label: 'Admissions', icon: 'user-plus', group: 'Students', page: 'admissions', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  'pay-fees': { label: 'Pay Fees', icon: 'wallet', group: 'Fees', page: 'pay-fees', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  pending: { label: 'Pending & Overdue', icon: 'alarm-clock', group: 'Fees', page: 'pending', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  payments: { label: 'Payment History', icon: 'history', group: 'Fees', page: 'payments', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  'school-students': { label: 'All Students', icon: 'baby', group: 'Students', page: 'school-students', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-fees': { label: 'Collect Fees', icon: 'wallet', group: 'Fees', page: 'school-fees', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-pending': { label: 'Pending & Overdue', icon: 'alarm-clock', group: 'Fees', page: 'school-pending', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-payments': { label: 'Payment History', icon: 'receipt', group: 'Fees', page: 'school-payments', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-levels': { label: 'Levels & Fees', icon: 'sliders-horizontal', group: 'Setup', page: 'school-levels', ctx: ['school'], roles: ['superadmin'] },
  reports: { label: 'Reports', icon: 'bar-chart-3', group: 'Insights', page: 'reports', ctx: ['youth', 'school'], roles: ['superadmin'] },
  archives: { label: 'Archives', icon: 'archive', group: 'Insights', page: 'archives', ctx: ['youth', 'school'], roles: ['superadmin'] },
  'branch-heads': { label: 'Branch Heads', icon: 'user-cog', group: 'Administration', page: 'branch-heads', ctx: ['youth'], roles: ['superadmin'] },
  sessions: { label: 'Sessions', icon: 'calendar-clock', group: 'Administration', page: 'sessions', ctx: ['youth', 'school'], roles: ['superadmin'] },
  org: { label: 'Organisation', icon: 'landmark', group: 'Administration', page: 'org-details', ctx: ['youth', 'school'], roles: ['superadmin'] }
};

for (const key of Object.keys(ROUTES)) {
  ROUTES[key].title = ROUTES[key].label;
  ROUTES[key].key = key;
}

let currentModule = null;
let navCounter = 0;

export function startRouter({ profile, getContext, setContext, onRouteChange }) {
  const view = document.getElementById('view');

  function emptyState(iconName, heading, line) {
    const box = document.createElement('div');
    box.className = 'empty-state';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-lucide', iconName);
    svg.setAttribute('aria-hidden', 'true');
    box.appendChild(svg);
    const h = document.createElement('h3');
    h.textContent = heading;
    box.appendChild(h);
    const p = document.createElement('p');
    p.textContent = line;
    box.appendChild(p);
    return box;
  }

  function renderEmpty(iconName, heading, line) {
    view.textContent = '';
    view.appendChild(emptyState(iconName, heading, line));
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  async function render(key) {
    const thisNav = ++navCounter;
    try {
      if (currentModule && typeof currentModule.unmount === 'function') {
        currentModule.unmount();
      }
    } catch (e) {
      // silent
    }
    currentModule = null;
    clearDirty();

    const route = Object.prototype.hasOwnProperty.call(ROUTES, key) ? ROUTES[key] : null;
    const ctx = getContext();
    const orgName = (window.APP_CACHE && window.APP_CACHE.org && window.APP_CACHE.org.orgName) ? window.APP_CACHE.org.orgName : 'Unique Infotech CMS';

    function setTitle(text) {
      document.title = text + ' - ' + orgName;
    }

    if (!route) {
      renderEmpty('inbox', 'Page not found', 'The requested page does not exist.');
      setTitle('Page not found');
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      if (onRouteChange) onRouteChange(key, null);
      return;
    }
    if (!route.roles.includes(profile.role)) {
      renderEmpty('lock', "You don't have access to this page", 'Ask the Super Admin to grant access.');
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn pri';
      back.textContent = 'Back to Dashboard';
      back.addEventListener('click', () => { location.hash = '#/dashboard'; });
      view.appendChild(back);
      setTitle(route.title);
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
    if (!route.ctx.includes(ctx)) {
      if (profile.role === 'superadmin') {
        setContext(route.ctx[0]);
      } else {
        renderEmpty('lock', "You don't have access to this page", 'This page is not available in the current section.');
        setTitle(route.title);
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
        if (onRouteChange) onRouteChange(key, route);
        return;
      }
    }

    let resp;
    try {
      resp = await fetch('/pages/' + route.page + '.html', { cache: 'no-cache' });
    } catch (e) {
      if (thisNav !== navCounter) return;
      renderEmpty('inbox', "Couldn't load this page", 'Check your internet connection and try again.');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn pri';
      btn.textContent = 'Try again';
      btn.addEventListener('click', () => render(key));
      view.appendChild(btn);
      setTitle(route.title);
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
    if (thisNav !== navCounter) return;
    if (!resp.ok) {
      renderEmpty('inbox', "This page isn't available yet", 'The page "' + route.label + '" could not be loaded.');
      setTitle(route.title);
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
    let html = await resp.text();
    if (thisNav !== navCounter) return;
    html = html.trim();
    if (!html) {
      renderEmpty('inbox', "This page isn't available yet", 'The page "' + route.label + '" has no content yet.');
      setTitle(route.title);
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
    view.innerHTML = html;
    if (thisNav !== navCounter) return;
    try {
      const mod = await import('/js/pages/' + route.page + '.page.js?v=' + (window.__BUILD__ || Date.now()));
      if (thisNav !== navCounter) return;
      if (mod && typeof mod.mount === 'function') {
        currentModule = mod;
        await mod.mount({ container: document.getElementById('view'), profile, ctx: getContext() });
      } else {
        currentModule = null;
      }
    } catch (e) {
      console.error(e);
    }
    if (thisNav !== navCounter) return;
    const viewEl = document.getElementById('view');
    if (viewEl) {
      viewEl.focus();
      viewEl.scrollTop = 0;
    }
    setTitle(route.title);
    if (onRouteChange) onRouteChange(key, route);
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  let lastHash = '';
  let reverting = false;
  async function onHashChange() {
    if (reverting) { reverting = false; return; }
    const hash = location.hash;
    if (!hash || hash === '#' || hash === '#/') {
      location.replace('#/dashboard');
      return;
    }
    if (lastHash && hash !== lastHash) {
      const ok = await confirmLeave();
      if (!ok) {
        reverting = true;
        location.hash = lastHash;
        return;
      }
    }
    lastHash = hash;
    const key = hash.slice(2);
    render(key);
  }

  window.addEventListener('hashchange', onHashChange);
  onHashChange();
}

export function navigate(key) {
  location.hash = '#/' + key;
}
