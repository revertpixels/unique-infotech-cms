import { confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.90';

export const ROLE_LABELS = {
  superadmin: 'Super Admin',
  branch_head: 'Branch Head',
  school_head: 'School Head'
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
  'school-fees': { label: 'Collect Fees', icon: 'wallet', group: 'Fees', page: 'school-fees', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-pending': { label: 'Pending & Overdue', icon: 'alarm-clock', group: 'Fees', page: 'school-pending', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-payments': { label: 'Payment History', icon: 'receipt', group: 'Fees', page: 'school-payments', ctx: ['school'], roles: ['superadmin', 'school_head'] },
  'school-levels': { label: 'Levels & Fees', icon: 'sliders-horizontal', group: 'Setup', page: 'school-levels', ctx: ['school'], roles: ['superadmin'] },
  'school-transfer': { label: 'Change Batch', icon: 'shuffle', group: 'Students', page: 'school-transfer', ctx: ['school'], roles: ['superadmin'], nav: false },
  'school-end': { label: 'End Course', icon: 'x-circle', group: 'Students', page: 'school-end', ctx: ['school'], roles: ['superadmin'], nav: false },
  'school-break': { label: 'Break Management', icon: 'pause-circle', group: 'Students', page: 'school-break', ctx: ['school'], roles: ['superadmin'] },
  'school-delete': { label: 'Permanent Delete', icon: 'trash-2', group: 'Students', page: 'school-delete', ctx: ['school'], roles: ['superadmin'], nav: false },
  'youth-transfer': { label: 'Change Batch', icon: 'shuffle', group: 'Students', page: 'school-transfer', ctx: ['youth'], roles: ['superadmin'], nav: false },
  'youth-end': { label: 'End Course', icon: 'x-circle', group: 'Students', page: 'school-end', ctx: ['youth'], roles: ['superadmin'], nav: false },
  reports: { label: 'Reports', icon: 'bar-chart-3', group: 'Insights', page: 'reports', ctx: ['youth', 'school'], roles: ['superadmin'] },
  archives: { label: 'Archives', icon: 'archive', group: 'Insights', page: 'archives', ctx: ['youth', 'school'], roles: ['superadmin'] },
  'branch-heads': { label: 'Branch Heads', icon: 'user-cog', group: 'Administration', page: 'branch-heads', ctx: ['youth'], roles: ['superadmin'] },
  sessions: { label: 'Sessions', icon: 'calendar-clock', group: 'Administration', page: 'sessions', ctx: ['youth'], roles: ['superadmin'] },
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
  const orgName = (window.APP_CACHE && window.APP_CACHE.org && window.APP_CACHE.org.orgName) ? window.APP_CACHE.org.orgName : 'Unique Infotech CMS';

  function setTitle(text) {
    document.title = text + ' - ' + orgName;
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

  // T6: simple "coming soon" student profile card for #/students/<studentId>
  function renderStudentProfile(studentId, routeKey) {
    view.textContent = '';
    const box = document.createElement('div');
    box.className = 'empty-state';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-lucide', 'user');
    svg.setAttribute('aria-hidden', 'true');
    box.appendChild(svg);
    const h = document.createElement('h3');
    h.textContent = 'Student profile - coming soon';
    box.appendChild(h);
    const p = document.createElement('p');
    p.textContent = 'Student ID: ' + studentId;
    box.appendChild(p);
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn pri';
    back.textContent = 'Back';
    back.addEventListener('click', () => { location.hash = '#/admissions'; });
    box.appendChild(back);
    view.appendChild(box);
    setTitle('Student profile');
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    if (onRouteChange) onRouteChange(routeKey, null);
  }

  async function renderAdmissionReceipt(key) {
    const thisNav = ++navCounter;
    try {
      const resp = await fetch('/pages/admission-receipt.html', { cache: 'no-cache' });
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
      const viewEl = document.getElementById('view');
      if (viewEl) {
        viewEl.focus();
        viewEl.scrollTop = 0;
      }
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
      const resp = await fetch('/pages/school-admission-receipt.html', { cache: 'no-cache' });
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
      const viewEl = document.getElementById('view');
      if (viewEl) {
        viewEl.focus();
        viewEl.scrollTop = 0;
      }
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

  async function renderSchoolTransfer(key) {
    const thisNav = ++navCounter;
    try {
      const resp = await fetch('/pages/school-transfer.html', { cache: 'no-cache' });
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
      const viewEl = document.getElementById('view');
      if (viewEl) {
        viewEl.focus();
        viewEl.scrollTop = 0;
      }
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
      const resp = await fetch('/pages/school-end.html', { cache: 'no-cache' });
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
      const viewEl = document.getElementById('view');
      if (viewEl) {
        viewEl.focus();
        viewEl.scrollTop = 0;
      }
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
      const resp = await fetch('/pages/school-delete.html', { cache: 'no-cache' });
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
      const viewEl = document.getElementById('view');
      if (viewEl) {
        viewEl.focus();
        viewEl.scrollTop = 0;
      }
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
      const resp = await fetch('/pages/school-fee-payment.html', { cache: 'no-cache' });
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
      const viewEl = document.getElementById('view');
      if (viewEl) {
        viewEl.focus();
        viewEl.scrollTop = 0;
      }
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

    // T6: dynamic student profile route #/students/<studentId>
    if (key.startsWith('students/') && key.length > 'students/'.length) {
      renderStudentProfile(key.slice('students/'.length));
      return;
    }

    // T1: dynamic admission receipt route #/admissions/<admissionId>/receipt
    if (key.startsWith('admissions/') && key.endsWith('/receipt') && key.length > 'admissions/'.length + '/receipt'.length) {
      renderAdmissionReceipt(key);
      return;
    }

    // Kids admission receipt route #/school-admissions/<studentId>/receipt
    if (key.startsWith('school-admissions/') && key.endsWith('/receipt') && key.length > 'school-admissions/'.length + '/receipt'.length) {
      renderSchoolAdmissionReceipt(key);
      return;
    }

    // Kids/Youth batch transfer route #/school-transfer/<studentId> or #/youth-transfer/<studentId>
    if ((key.startsWith('school-transfer/') || key.startsWith('youth-transfer/')) && key.length > 'school-transfer/'.length + 1) {
      renderSchoolTransfer(key);
      return;
    }

    // Kids/Youth end course route #/school-end/<studentId> or #/youth-end/<studentId>
    if ((key.startsWith('school-end/') || key.startsWith('youth-end/')) && key.length > 'school-end/'.length + 1) {
      renderSchoolEnd(key);
      return;
    }

    // Kids/Youth permanent delete route #/school-delete/<studentId> or #/youth-delete/<studentId>
    if ((key.startsWith('school-delete/') || key.startsWith('youth-delete/')) && key.length > 'school-delete/'.length + 1) {
      renderSchoolDelete(key);
      return;
    }

    // Kids monthly fee payment route #/school-fees/pay/<billId>
    if (key.startsWith('school-fees/pay/') && key.length > 'school-fees/pay/'.length + 1) {
      renderSchoolFeePayment(key);
      return;
    }

    if (route.redirect) {
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

    let pageHtml;
    let html;
    try {
      const resp = await fetch('/pages/' + route.page + '.html', { cache: 'no-cache' });
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
















