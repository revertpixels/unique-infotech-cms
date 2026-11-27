import { confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.179';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.179';

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
  const view = document.getElementById('view');
  if (view) view.textContent = '';
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

  // Dynamic student profile loader for #/students/<studentId>
  async function renderStudentProfile(studentId, routeKey) {
    const thisNav = ++navCounter;
    try {
      const resp = await fetch('/pages/student-profile.html?v=1.8.179', { cache: 'no-cache' });
      if (thisNav !== navCounter) return;
      if (!resp.ok) {
        renderEmpty('inbox', "This page isn't available yet", 'The student profile page could not be loaded.');
        setTitle('Student Profile');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(routeKey, null);
        return;
      }
      let html = await resp.text();
      if (thisNav !== navCounter) return;
      html = html.trim();
      if (!html) {
        renderEmpty('inbox', "This page isn't available yet", 'The student profile page has no content yet.');
        setTitle('Student Profile');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(routeKey, null);
        return;
      }
      view.innerHTML = html;
      if (thisNav !== navCounter) return;
      try {
        const mod = await import('/js/pages/student-profile.page.js?v=' + (window.__BUILD__ || Date.now()));
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
      resetScroll();
      setTitle('Student Profile');
      if (onRouteChange) onRouteChange(routeKey, null);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error(e);
      renderEmpty('alert-triangle', 'Failed to load Student Profile', e.message || String(e));
      setTitle('Error loading Student Profile');
      if (onRouteChange) onRouteChange(routeKey, null);
    }
  }

  async function renderAdmissionReceipt(key) {
    const thisNav = ++navCounter;
    try {
      const resp = await fetch('/pages/admission-receipt.html?v=1.8.179', { cache: 'no-cache' });
      if (thisNav !== navCounter) return;
      if (!resp.ok) {
        renderEmpty('inbox', "This page isn't available yet", 'The receipt page could not be loaded.');
        setTitle('Admission Receipt');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      let html = await resp.text();
      if (thisNav !== navCounter) return;
      html = html.trim();
      if (!html) {
        renderEmpty('inbox', "This page isn't available yet", 'The receipt page has no content yet.');
        setTitle('Admission Receipt');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      view.innerHTML = html;
      if (thisNav !== navCounter) return;
      try {
        const mod = await import('/js/pages/admission-receipt.page.js?v=' + (window.__BUILD__ || Date.now()));
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
      resetScroll();
      setTitle('Admission Receipt');
      if (onRouteChange) onRouteChange(key, null);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error(e);
      renderEmpty('alert-triangle', 'Failed to load page: ' + (route.page || key) + '.page.js', e.message || String(e));
      setTitle('Error loading ' + route.title);
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
  }

  async function renderSchoolAdmissionReceipt(key) {
    const thisNav = ++navCounter;
    try {
      const resp = await fetch('/pages/school-admission-receipt.html?v=1.8.179', { cache: 'no-cache' });
      if (thisNav !== navCounter) return;
      if (!resp.ok) {
        renderEmpty('inbox', "This page isn't available yet", 'The receipt page could not be loaded.');
        setTitle('Kids Admission Receipt');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      let html = await resp.text();
      if (thisNav !== navCounter) return;
      html = html.trim();
      if (!html) {
        renderEmpty('inbox', "This page isn't available yet", 'The receipt page has no content yet.');
        setTitle('Kids Admission Receipt');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      view.innerHTML = html;
      if (thisNav !== navCounter) return;
      try {
        const mod = await import('/js/pages/school-admission-receipt.page.js?v=' + (window.__BUILD__ || Date.now()));
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
      resetScroll();
      setTitle('Kids Admission Receipt');
      if (onRouteChange) onRouteChange(key, null);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error(e);
      renderEmpty('alert-triangle', 'Failed to load page: ' + (route.page || key) + '.page.js', e.message || String(e));
      setTitle('Error loading ' + route.title);
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
  }

  async function renderPaymentReceipt(key) {
    const thisNav = ++navCounter;
    try {
      const resp = await fetch('/pages/payment-receipt.html?v=1.8.179', { cache: 'no-cache' });
      if (thisNav !== navCounter) return;
      if (!resp.ok) {
        renderEmpty('inbox', "This page isn't available yet", 'The payment receipt page could not be loaded.');
        setTitle('Payment Receipt');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      let html = await resp.text();
      if (thisNav !== navCounter) return;
      html = html.trim();
      if (!html) {
        renderEmpty('inbox', "This page isn't available yet", 'The payment receipt page has no content yet.');
        setTitle('Payment Receipt');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      view.innerHTML = html;
      if (thisNav !== navCounter) return;
      try {
        const mod = await import('/js/pages/payment-receipt.page.js?v=' + (window.__BUILD__ || Date.now()));
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
      resetScroll();
      setTitle('Payment Receipt');
      if (onRouteChange) onRouteChange(key, null);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error(e);
      renderEmpty('alert-triangle', 'Failed to load Payment Receipt', e.message || String(e));
      setTitle('Error loading Payment Receipt');
      if (onRouteChange) onRouteChange(key, null);
    }
  }

  async function renderSchoolTransfer(key) {
    const thisNav = ++navCounter;
    try {
      const resp = await fetch('/pages/school-transfer.html?v=1.8.179', { cache: 'no-cache' });
      if (thisNav !== navCounter) return;
      if (!resp.ok) {
        renderEmpty('inbox', "This page isn't available yet", 'The transfer page could not be loaded.');
        setTitle('Change Batch');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      let html = await resp.text();
      if (thisNav !== navCounter) return;
      html = html.trim();
      if (!html) {
        renderEmpty('inbox', "This page isn't available yet", 'The transfer page has no content yet.');
        setTitle('Change Batch');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      view.innerHTML = html;
      if (thisNav !== navCounter) return;
      try {
        const mod = await import('/js/pages/school-transfer.page.js?v=' + (window.__BUILD__ || Date.now()));
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
      resetScroll();
      setTitle('Change Batch');
      if (onRouteChange) onRouteChange(key, null);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error(e);
      renderEmpty('alert-triangle', 'Failed to load page: ' + (route.page || key) + '.page.js', e.message || String(e));
      setTitle('Error loading ' + route.title);
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
  }

  async function renderSchoolEnd(key) {
    const thisNav = ++navCounter;
    try {
      const resp = await fetch('/pages/school-end.html?v=1.8.179', { cache: 'no-cache' });
      if (thisNav !== navCounter) return;
      if (!resp.ok) {
        renderEmpty('inbox', "This page isn't available yet", 'The end course page could not be loaded.');
        setTitle('End Course');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      let html = await resp.text();
      if (thisNav !== navCounter) return;
      html = html.trim();
      if (!html) {
        renderEmpty('inbox', "This page isn't available yet", 'The end course page has no content yet.');
        setTitle('End Course');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      view.innerHTML = html;
      if (thisNav !== navCounter) return;
      try {
        const mod = await import('/js/pages/school-end.page.js?v=' + (window.__BUILD__ || Date.now()));
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
      resetScroll();
      setTitle('End Course');
      if (onRouteChange) onRouteChange(key, null);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error(e);
      renderEmpty('alert-triangle', 'Failed to load page: ' + (route.page || key) + '.page.js', e.message || String(e));
      setTitle('Error loading ' + route.title);
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
  }

  async function renderSchoolDelete(key) {
    const thisNav = ++navCounter;
    try {
      const resp = await fetch('/pages/school-delete.html?v=1.8.179', { cache: 'no-cache' });
      if (thisNav !== navCounter) return;
      if (!resp.ok) {
        renderEmpty('inbox', "This page isn't available yet", 'The delete page could not be loaded.');
        setTitle('Permanent Delete');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      let html = await resp.text();
      if (thisNav !== navCounter) return;
      html = html.trim();
      if (!html) {
        renderEmpty('inbox', "This page isn't available yet", 'The delete page has no content yet.');
        setTitle('Permanent Delete');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      view.innerHTML = html;
      if (thisNav !== navCounter) return;
      try {
        const mod = await import('/js/pages/school-delete.page.js?v=' + (window.__BUILD__ || Date.now()));
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
      resetScroll();
      setTitle('Permanent Delete');
      if (onRouteChange) onRouteChange(key, null);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error(e);
      renderEmpty('alert-triangle', 'Failed to load page: ' + (route.page || key) + '.page.js', e.message || String(e));
      setTitle('Error loading ' + route.title);
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
  }

  async function renderSchoolFeePayment(key) {
    const thisNav = ++navCounter;
    const billId = key.slice('school-fees/pay/'.length);
    try {
      const resp = await fetch('/pages/school-fee-payment.html?v=1.8.179', { cache: 'no-cache' });
      if (thisNav !== navCounter) return;
      if (!resp.ok) {
        renderEmpty('inbox', "This page isn't available yet", 'The fee payment page could not be loaded.');
        setTitle('Record Payment');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      let html = await resp.text();
      if (thisNav !== navCounter) return;
      html = html.trim();
      if (!html) {
        renderEmpty('inbox', "This page isn't available yet", 'The fee payment page has no content yet.');
        setTitle('Record Payment');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        if (onRouteChange) onRouteChange(key, null);
        return;
      }
      view.innerHTML = html;
      if (thisNav !== navCounter) return;
      try {
        const mod = await import('/js/pages/school-fee-payment.page.js?v=' + (window.__BUILD__ || Date.now()));
        if (thisNav !== navCounter) return;
        if (mod && typeof mod.mount === 'function') {
          currentModule = mod;
          await mod.mount({ container: document.getElementById('view'), profile, ctx: getContext(), billId: billId });
        } else {
          currentModule = null;
        }
      } catch (e) {
        console.error(e);
      }
      if (thisNav !== navCounter) return;
      resetScroll();
      setTitle('Record Payment');
      if (onRouteChange) onRouteChange(key, null);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error(e);
      renderEmpty('alert-triangle', 'Failed to load page: ' + (route.page || key) + '.page.js', e.message || String(e));
      setTitle('Error loading ' + route.title);
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
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
      renderStudentProfile(key.slice('students/'.length), fullKey);
      return;
    }

    // T1: dynamic admission receipt route #/admissions/<admissionId>/receipt
    if (key.startsWith('admissions/') && key.endsWith('/receipt') && key.length > 'admissions/'.length + '/receipt'.length) {
      renderAdmissionReceipt(fullKey);
      return;
    }

    // Dynamic payment receipt route #/payments/<studentDocId>/<paymentId>/receipt
    if (key.startsWith('payments/') && key.endsWith('/receipt')) {
      renderPaymentReceipt(fullKey);
      return;
    }

    // Kids admission receipt route #/school-admissions/<studentId>/receipt
    if (key.startsWith('school-admissions/') && key.endsWith('/receipt') && key.length > 'school-admissions/'.length + '/receipt'.length) {
      renderSchoolAdmissionReceipt(fullKey);
      return;
    }

    // Kids/Youth batch transfer route #/school-transfer/<studentId> or #/youth-transfer/<studentId>
    if ((key.startsWith('school-transfer/') || key.startsWith('youth-transfer/')) && key.length > 'school-transfer/'.length + 1) {
      renderSchoolTransfer(fullKey);
      return;
    }

    // Kids/Youth end course route #/school-end/<studentId> or #/youth-end/<studentId>
    if ((key.startsWith('school-end/') || key.startsWith('youth-end/')) && key.length > 'school-end/'.length + 1) {
      renderSchoolEnd(fullKey);
      return;
    }

    // Kids/Youth permanent delete route #/school-delete/<studentId> or #/youth-delete/<studentId>
    if ((key.startsWith('school-delete/') || key.startsWith('youth-delete/')) && key.length > 'school-delete/'.length + 1) {
      renderSchoolDelete(fullKey);
      return;
    }

    // Kids monthly fee payment route #/school-fees/pay/<billId>
    if (key.startsWith('school-fees/pay/') && key.length > 'school-fees/pay/'.length + 1) {
      renderSchoolFeePayment(fullKey);
      return;
    }

    if (route && route.redirect) {
      location.hash = '#/' + route.redirect;
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

    let pageHtml;
    let html;
    try {
      const resp = await fetch('/pages/' + route.page + '.html?v=1.8.179', { cache: 'no-cache' });
      pageHtml = resp;
      if (thisNav !== navCounter) return;
      if (!pageHtml.ok) {
        renderEmpty('inbox', "This page isn't available yet", 'The page "' + route.label + '" could not be loaded.');
        setTitle(route.title);
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
        if (onRouteChange) onRouteChange(key, route);
        return;
      }
      html = await pageHtml.text();
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
    } catch (e) {
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
      renderEmpty('alert-triangle', 'Failed to load page: ' + (route.page || key) + '.page.js', e.message || String(e));
      setTitle('Error loading ' + route.title);
      if (onRouteChange) onRouteChange(key, route);
      return;
    }
    if (thisNav !== navCounter) return;
    resetScroll();
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
    window.removeEventListener('uic:session-selected', rerenderActiveRoute);
    window.removeEventListener('uic:ctx-changed', rerenderActiveRoute);
  };
  onHashChange();
}

export function navigate(key) {
  location.hash = '#/' + key;
}
















