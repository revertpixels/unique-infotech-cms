import { APP_VERSION } from './app.js?v=1.8.190';
import { confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.190';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.190';

const htmlCache = new Map();
const htmlInflight = new Map();
const moduleCache = new Map();
const MAIN_PREFETCH_ROUTES = ['dashboard', 'students', 'pay-fees', 'pending', 'payments', 'reports', 'batches'];

function getBuildVersion() {
  return (typeof window !== 'undefined' && window.__BUILD__) ? String(window.__BUILD__) : APP_VERSION;
}

async function fetchPageHtml(pageName) {
  const v = getBuildVersion();
  const cacheKey = `${pageName}@${v}`;
  if (htmlCache.has(cacheKey)) {
    return { ok: true, html: htmlCache.get(cacheKey), empty: false };
  }
  if (htmlInflight.has(cacheKey)) {
    return htmlInflight.get(cacheKey);
  }
  const task = (async () => {
    const resp = await fetch(`/pages/${pageName}.html?v=${encodeURIComponent(v)}`);
    if (!resp.ok) return { ok: false, html: '', empty: false };
    const html = (await resp.text()).trim();
    if (!html) return { ok: true, html: '', empty: true };
    htmlCache.set(cacheKey, html);
    return { ok: true, html, empty: false };
  })().finally(() => {
    htmlInflight.delete(cacheKey);
  });
  htmlInflight.set(cacheKey, task);
  return task;
}

function importPageModule(pageName) {
  const v = getBuildVersion();
  const cacheKey = `${pageName}@${v}`;
  if (moduleCache.has(cacheKey)) {
    return Promise.resolve(moduleCache.get(cacheKey));
  }
  const url = `/js/pages/${pageName}.page.js?v=${encodeURIComponent(v)}`;
  const promise = import(url).then((mod) => {
    moduleCache.set(cacheKey, mod);
    return mod;
  }).catch((err) => {
    moduleCache.delete(cacheKey);
    throw err;
  });
  moduleCache.set(cacheKey, promise);
  return promise;
}

async function loadPageAssets(pageName) {
  const [htmlResult, modResult] = await Promise.allSettled([
    fetchPageHtml(pageName),
    importPageModule(pageName)
  ]);
  return { htmlResult, modResult };
}

export function prefetchMainPages(profile, ctx = 'youth') {
  if (typeof window === 'undefined' || !profile) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const pages = [];
  for (const routeKey of MAIN_PREFETCH_ROUTES) {
    const r = ROUTES[routeKey];
    if (!r || !r.page) continue;
    if (!r.roles.includes(profile.role)) continue;
    if (!r.ctx.includes(ctx) && profile.role !== 'superadmin') continue;
    if (!pages.includes(r.page)) pages.push(r.page);
  }
  const v = getBuildVersion();
  const queue = pages.filter((p) => {
    const key = `${p}@${v}`;
    return !htmlCache.has(key) || !moduleCache.has(key);
  });
  if (!queue.length) return;
  const schedule = typeof window.requestIdleCallback === 'function'
    ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
    : (fn) => setTimeout(fn, 150);

  let idx = 0;
  const pump = () => {
    if (idx >= queue.length) return;
    const pageName = queue[idx++];
    Promise.allSettled([fetchPageHtml(pageName), importPageModule(pageName)]).finally(() => {
      if (idx < queue.length) schedule(pump);
    });
  };
  schedule(pump);
}

export const ROLE_LABELS = {
  get superadmin() { return getRoleTitle('superadmin'); },
  get branch_head() { return getRoleTitle('branch_head'); },
  get school_head() { return getRoleTitle('school_head'); }
};

export const ROUTES = {
  dashboard: { label: 'Dashboard', icon: 'layout-dashboard', group: 'Main', page: 'dashboard', ctx: ['youth', 'school'], roles: ['superadmin', 'branch_head', 'school_head'] },
  branches: { label: 'Branches', icon: 'git-branch', group: 'Academics', page: 'branches', ctx: ['youth'], roles: ['superadmin'] },
  courses: { label: 'Courses & Packages', icon: 'layers', group: 'Academics', page: 'courses', ctx: ['youth', 'school'], roles: ['superadmin', 'branch_head'] },
  batches: { label: 'Batches', icon: 'users-round', group: 'Academics', page: 'batches', ctx: ['youth', 'school'], roles: ['superadmin', 'branch_head'] },
  students: { label: 'Students', icon: 'users', group: 'Students', page: 'admissions', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  admissions: { label: 'Admissions', icon: 'user-plus', group: 'Students', redirect: 'students', ctx: ['youth'], roles: ['superadmin', 'branch_head'], nav: false },
  'school-admissions': { label: 'Kids Admissions', icon: 'user-plus', group: 'Students', redirect: 'school-students', ctx: ['school'], roles: ['superadmin'], nav: false },
  'pay-fees': { label: 'Pay Fees', icon: 'wallet', group: 'Fees', page: 'pay-fees', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  pending: { label: 'Pending & Overdue', icon: 'alarm-clock', group: 'Fees', page: 'pending', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  payments: { label: 'Payment History', icon: 'history', group: 'Fees', page: 'payments', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  'school-students': { label: 'Students', icon: 'baby', group: 'Students', page: 'school-admissions', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-fees': { label: 'Collect Fees', icon: 'wallet', group: 'Fees', page: 'school-fees', ctx: ['school'], roles: ['superadmin'] },
  'school-pending': { label: 'Pending & Overdue', icon: 'alarm-clock', group: 'Fees', page: 'pending', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-payments': { label: 'Payment History', icon: 'receipt', group: 'Fees', page: 'payments', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-levels': { label: 'Levels & Fees', icon: 'sliders-horizontal', group: 'Setup', page: 'school-levels', ctx: ['school'], roles: ['superadmin'] },
  'school-transfer': { label: 'Change Batch', icon: 'shuffle', group: 'Students', page: 'school-transfer', ctx: ['school'], roles: ['superadmin'], nav: false },
  'school-end': { label: 'End Course', icon: 'x-circle', group: 'Students', page: 'school-end', ctx: ['school'], roles: ['superadmin'], nav: false },
  'school-break': { label: 'Break Management', icon: 'pause-circle', group: 'Students', page: 'school-break', ctx: ['school'], roles: ['superadmin'] },
  'school-delete': { label: 'Permanent Delete', icon: 'trash-2', group: 'Students', page: 'school-delete', ctx: ['school'], roles: ['superadmin'], nav: false },
  'youth-transfer': { label: 'Change Batch', icon: 'shuffle', group: 'Students', page: 'school-transfer', ctx: ['youth'], roles: ['superadmin'], nav: false },
  'youth-end': { label: 'End Course', icon: 'x-circle', group: 'Students', page: 'school-end', ctx: ['youth'], roles: ['superadmin'], nav: false },
  reports: { label: 'Reports', icon: 'bar-chart-3', group: 'Insights', page: 'reports', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  archives: { label: 'Archives', icon: 'archive', group: 'Insights', page: 'archives', ctx: ['youth'], roles: ['superadmin', 'branch_head'] },
  'branch-heads': { label: 'Users', icon: 'user-cog', group: 'Administration', page: 'org-details', nav: false, redirect: 'org?tab=users', ctx: ['youth', 'school'], roles: ['superadmin'] },
  sessions: { label: 'Sessions', icon: 'calendar-clock', group: 'Administration', page: 'sessions', ctx: ['youth'], roles: ['superadmin'] },
  org: { label: 'Organisation', icon: 'landmark', group: 'Administration', page: 'org-details', ctx: ['youth', 'school'], roles: ['superadmin'] }
};

for (const key of Object.keys(ROUTES)) {
  ROUTES[key].title = ROUTES[key].label;
  ROUTES[key].key = key;
}

let currentModule = null;
let navCounter = 0;
let activeCleanup = null;

export function stopRouter() {
  navCounter++;
  if (currentModule && typeof currentModule.unmount === 'function') {
    try { currentModule.unmount(); } catch (_) {}
  }
  currentModule = null;
  if (activeCleanup) {
    try { activeCleanup(); } catch (_) {}
    activeCleanup = null;
  }
  const view = typeof document !== 'undefined' ? document.getElementById('view') : null;
  if (view) view.textContent = '';
}

export function clearRouterCache() {
  stopRouter();
  htmlCache.clear();
  htmlInflight.clear();
  moduleCache.clear();
}

export function startRouter({ profile, getContext, setContext, onRouteChange }) {
  stopRouter();
  const view = document.getElementById('view');
  const orgName = (window.APP_CACHE && window.APP_CACHE.org && window.APP_CACHE.org.orgName) ? window.APP_CACHE.org.orgName : 'Unique Infotech CMS';

  function setTitle(text) {
    document.title = text + ' - ' + orgName;
    const pageTitleEl = document.getElementById('page-title');
    if (pageTitleEl) pageTitleEl.textContent = text;
  }

  function resetScroll() {
    const viewEl = document.getElementById('view');
    if (viewEl) {
      if (typeof viewEl.focus === 'function') {
        viewEl.focus({ preventScroll: true });
      }
      viewEl.scrollTop = 0;
    }
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }

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

  async function mountRoutePage({
    thisNav,
    pageName,
    routeKey,
    routeObj = null,
    title,
    missingMsg,
    emptyMsg,
    mountArgs = {},
    throwOnModuleError = false,
    retryOnNetworkError = false,
    networkErrorHeading = "Couldn't load this page",
    networkErrorLine = 'Check your internet connection and try again.'
  }) {
    if (typeof window !== 'undefined') {
      window.__uicNavInFlight = (window.__uicNavInFlight || 0) + 1;
    }
    try {
      let assets;
      try {
        assets = await loadPageAssets(pageName);
      } catch (e) {
        if (thisNav !== navCounter) return;
        console.error(e);
        renderEmpty('inbox', networkErrorHeading, networkErrorLine);
        setTitle(title);
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(routeKey, routeObj);
        return;
      }
      if (thisNav !== navCounter) return;

      const { htmlResult, modResult } = assets;
      if (htmlResult.status === 'rejected') {
        console.error(htmlResult.reason);
        renderEmpty('inbox', networkErrorHeading, networkErrorLine);
        if (retryOnNetworkError) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn pri';
          btn.textContent = 'Try again';
          btn.addEventListener('click', () => render(routeKey));
          view.appendChild(btn);
        }
        setTitle(title);
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(routeKey, routeObj);
        return;
      }

      const htmlRes = htmlResult.value;
      if (!htmlRes.ok || htmlRes.empty) {
        renderEmpty('inbox', "This page isn't available yet", htmlRes.empty ? emptyMsg : missingMsg);
        setTitle(title);
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(routeKey, routeObj);
        return;
      }

      view.innerHTML = htmlRes.html;
      if (thisNav !== navCounter) return;

      try {
        if (modResult.status === 'rejected') throw modResult.reason;
        const mod = modResult.value;
        if (thisNav !== navCounter) return;
        if (mod && typeof mod.mount === 'function') {
          currentModule = mod;
          await mod.mount({ container: document.getElementById('view'), profile, ctx: getContext(), ...mountArgs });
        } else {
          currentModule = null;
        }
      } catch (e) {
        if (thisNav !== navCounter) return;
        console.error(e);
        if (throwOnModuleError) {
          renderEmpty('alert-triangle', 'Failed to load page: ' + pageName + '.page.js', e.message || String(e));
          setTitle('Error loading ' + title);
          if (onRouteChange) onRouteChange(routeKey, routeObj);
          return;
        }
      }

      if (thisNav !== navCounter) return;
      resetScroll();
      setTitle(title);
      if (onRouteChange) onRouteChange(routeKey, routeObj);
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('uic:route-mounted', { detail: { pageName, routeKey } }));
      }
    } finally {
      if (typeof window !== 'undefined') {
        window.__uicNavInFlight = Math.max(0, (window.__uicNavInFlight || 1) - 1);
      }
    }
  }

  function renderSubRoute(pageName, routeKey, title, subject, extraMountArgs = {}) {
    const thisNav = ++navCounter;
    return mountRoutePage({
      thisNav,
      pageName,
      routeKey,
      routeObj: null,
      title,
      missingMsg: `The ${subject} page could not be loaded.`,
      emptyMsg: `The ${subject} page has no content yet.`,
      mountArgs: extraMountArgs,
      throwOnModuleError: false
    });
  }

  async function render(fullKey) {
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
    resetScroll();

    // Strip query string for route pattern matching while preserving fullKey
    const [key] = (fullKey || '').split('?');
    const route = Object.prototype.hasOwnProperty.call(ROUTES, key) ? ROUTES[key] : null;
    const ctx = getContext();

    // Dynamic student profile route #/students/<studentId>
    if (key.startsWith('students/') && key.length > 'students/'.length) {
      renderSubRoute('student-profile', fullKey, 'Student Profile', 'student profile');
      return;
    }

    // T1: dynamic admission receipt route #/admissions/<admissionId>/receipt
    if (key.startsWith('admissions/') && key.endsWith('/receipt') && key.length > 'admissions/'.length + '/receipt'.length) {
      renderSubRoute('admission-receipt', fullKey, 'Admission Receipt', 'receipt');
      return;
    }

    // Dynamic payment receipt route #/payments/<studentDocId>/<paymentId>/receipt
    if (key.startsWith('payments/') && key.endsWith('/receipt')) {
      renderSubRoute('payment-receipt', fullKey, 'Payment Receipt', 'payment receipt');
      return;
    }

    // Kids admission receipt route #/school-admissions/<studentId>/receipt
    if (key.startsWith('school-admissions/') && key.endsWith('/receipt') && key.length > 'school-admissions/'.length + '/receipt'.length) {
      renderSubRoute('school-admission-receipt', fullKey, 'Kids Admission Receipt', 'receipt');
      return;
    }

    // Kids/Youth batch transfer route #/school-transfer/<studentId> or #/youth-transfer/<studentId>
    if ((key.startsWith('school-transfer/') || key.startsWith('youth-transfer/')) && key.length > 'school-transfer/'.length + 1) {
      renderSubRoute('school-transfer', fullKey, 'Change Batch', 'transfer');
      return;
    }

    // Kids/Youth end course route #/school-end/<studentId> or #/youth-end/<studentId>
    if ((key.startsWith('school-end/') || key.startsWith('youth-end/')) && key.length > 'school-end/'.length + 1) {
      renderSubRoute('school-end', fullKey, 'End Course', 'end course');
      return;
    }

    // Kids/Youth permanent delete route #/school-delete/<studentId> or #/youth-delete/<studentId>
    if ((key.startsWith('school-delete/') || key.startsWith('youth-delete/')) && key.length > 'school-delete/'.length + 1) {
      renderSubRoute('school-delete', fullKey, 'Permanent Delete', 'delete');
      return;
    }

    // Kids monthly fee payment route #/school-fees/pay/<billId>
    if (key.startsWith('school-fees/pay/') && key.length > 'school-fees/pay/'.length + 1) {
      const billId = key.slice('school-fees/pay/'.length);
      renderSubRoute('school-fee-payment', fullKey, 'Record Payment', 'fee payment', { billId });
      return;
    }

    if (route && route.redirect) {
      const qIdx = (fullKey || '').indexOf('?');
      const incomingQuery = qIdx !== -1 ? fullKey.slice(qIdx) : '';
      let target = route.redirect;
      if (incomingQuery) {
        target += (target.includes('?') ? '&' : '?') + incomingQuery.slice(1);
      }
      try {
        location.replace('#/' + target);
      } catch (_) {
        location.hash = '#/' + target;
      }
      return;
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
    if (route && !route.roles.includes(profile.role)) {
      if (key !== 'dashboard') {
        try {
          location.replace('#/dashboard');
        } catch (_) {
          location.hash = '#/dashboard';
        }
        return;
      }
      renderEmpty('lock', "You don't have access to this page", `Ask the ${getRoleTitle('superadmin')} to grant access.`);
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

    await mountRoutePage({
      thisNav,
      pageName: route.page,
      routeKey: key,
      routeObj: route,
      title: route.title,
      missingMsg: 'The page "' + route.label + '" could not be loaded.',
      emptyMsg: 'The page "' + route.label + '" has no content yet.',
      throwOnModuleError: true,
      retryOnNetworkError: true
    });
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

  const syncReplacedHash = () => {
    if (location.hash) lastHash = location.hash;
  };
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('uic:route-url-replaced', syncReplacedHash);
  const rerenderActiveRoute = () => {
    const hash = location.hash;
    if (hash && hash.length > 2) {
      const key = hash.slice(2);
      render(key);
    }
  };
  window.addEventListener('uic:session-selected', rerenderActiveRoute);
  window.addEventListener('uic:ctx-changed', rerenderActiveRoute);
  activeCleanup = () => {
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('uic:route-url-replaced', syncReplacedHash);
    window.removeEventListener('uic:session-selected', rerenderActiveRoute);
    window.removeEventListener('uic:ctx-changed', rerenderActiveRoute);
  };
  onHashChange();
}

export function navigate(key) {
  location.hash = '#/' + key;
}
















