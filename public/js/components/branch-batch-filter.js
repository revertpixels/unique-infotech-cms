// branch-batch-filter.js — Reusable paired [ Branch ] -> [ Batch ] filter box.
// Keeps branch/batch selection persisted across session reloads in sessionStorage/APP_CACHE,
// locks branch for Branch Heads (and single-branch Kids mode), and locks Batch until a branch
// is chosen for Super Admin.

import { createSelect } from './ui-select.js?v=1.8.181';

const STORAGE_PREFIX = 'uicms.bb.';

function readPersisted(key) {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writePersisted(key, val) {
  if (!key) return;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
  } catch (_) {}
}

export function clearPersistedBranchBatchFilters(subPrefix = '') {
  try {
    const fullPrefix = STORAGE_PREFIX + String(subPrefix || '');
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(fullPrefix)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch (_) {}
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Mounts a single bordered [ Branch v ] -> [ Batch v ] filter box into `host`.
 * @param {HTMLElement} host
 * @param {Object} opts
 * @param {string} opts.persistKey - Unique storage key (e.g. 'pending', 'payments', 'admissions')
 * @param {Object} opts.profile - Auth profile ({ role, branchId, branchName })
 * @param {string} [opts.ctx='youth'] - 'youth' | 'school'
 * @param {string} [opts.sessionId=''] - Active toolbar session ID (Youth)
 * @param {Array} [opts.branches=[]]
 * @param {Array} [opts.batches=[]]
 * @param {Array} [opts.courses=[]] - Optional course map/array to show course code on batch label
 * @param {Function} [opts.onChange] - Called with ({ branchId, batchId })
 */
export function createBranchBatchFilter(host, opts = {}) {
  const persistKey = opts.persistKey || '';
  const profile = opts.profile || {};
  const isBranchHead = profile.role === 'branch_head' && !!profile.branchId;

  let ctx = opts.ctx === 'school' ? 'school' : 'youth';
  let sessionId = opts.sessionId || '';
  let branches = Array.isArray(opts.branches) ? opts.branches : [];
  let batches = Array.isArray(opts.batches) ? opts.batches : [];
  let coursesById = normalizeCourses(opts.courses);
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};

  const saved = readPersisted(persistKey);
  let branchId = ctx === 'school'
    ? 'HO'
    : (isBranchHead ? profile.branchId : (saved?.branchId || 'all'));
  let batchId = saved?.batchId || 'all';

  // DOM structure inside one bordered group box
  const wrap = el('div', 'lp-bb-group');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Branch and batch filter');

  const brWrap = el('div', 'lp-filter');
  const brLabel = el('span', 'lp-filter-label', 'Branch');
  const brHost = el('div', 'lp-filter-select');
  brWrap.append(brLabel, brHost);

  const arrow = el('span', 'lp-bb-arrow');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = '<i data-lucide="arrow-right"></i>';

  const btWrap = el('div', 'lp-filter');
  const btLabelRow = el('span', 'lp-filter-label', 'Batch');
  const btHint = el('span', 'lp-filter-hint', '');
  btLabelRow.appendChild(btHint);
  const btHost = el('div', 'lp-filter-select');
  btWrap.append(btLabelRow, btHost);

  wrap.append(brWrap, arrow, btWrap);
  if (host) {
    host.textContent = '';
    host.appendChild(wrap);
  }

  let branchSel = null;
  let batchSel = null;

  branchSel = createSelect(brHost, {
    options: [{ value: 'all', label: 'All branches', icon: 'git-branch' }],
    value: branchId,
    ariaLabel: 'Branch',
    disabled: isBranchHead || ctx === 'school',
    onChange: (val) => {
      branchId = val || 'all';
      batchId = 'all';
      paintBatchOptions();
      persistAndEmit();
    }
  });

  batchSel = createSelect(btHost, {
    options: [{ value: 'all', label: 'All batches', icon: 'layers' }],
    value: batchId,
    ariaLabel: 'Batch',
    disabled: false,
    onChange: (val) => {
      batchId = val || 'all';
      persistAndEmit();
    }
  });

  function normalizeCourses(list) {
    if (!list) return {};
    if (!Array.isArray(list)) return list;
    const map = {};
    list.forEach((c) => { if (c && c.id) map[c.id] = c; });
    return map;
  }

  function persistAndEmit() {
    writePersisted(persistKey, { branchId, batchId });
    onChange({ branchId, batchId });
  }

  function resolveBranchLabel(id) {
    if (id === 'HO') return 'Head Office';
    const found = branches.find((b) => b.id === id);
    if (found && found.name) return found.name;
    if (isBranchHead && profile.branchName) return profile.branchName;
    return id || 'Branch';
  }

  function paintBranchOptions() {
    if (ctx === 'school') {
      branchId = 'HO';
      branchSel.setOptions([{ value: 'HO', label: 'Head Office', icon: 'git-branch' }]);
      branchSel.setValue('HO');
      branchSel.setDisabled(true);
      return;
    }

    if (isBranchHead) {
      branchId = profile.branchId;
      branchSel.setOptions([{ value: branchId, label: resolveBranchLabel(branchId), icon: 'lock' }]);
      branchSel.setValue(branchId);
      branchSel.setDisabled(true);
      return;
    }

    const sorted = branches
      .filter((b) => (!b.ctx || b.ctx === 'youth') && (b.status || 'active') === 'active')
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const opts = [{ value: 'all', label: 'All branches', icon: 'git-branch' }]
      .concat(sorted.map((b) => ({
        value: b.id,
        label: b.name || b.code || b.id,
        icon: 'git-branch'
      })));

    if (branchId !== 'all' && !sorted.some((b) => b.id === branchId)) {
      branchId = 'all';
      batchId = 'all';
    }
    branchSel.setOptions(opts);
    branchSel.setValue(branchId);
    branchSel.setDisabled(false);
  }

  function paintBatchOptions() {
    const branchChosen = ctx === 'school' || isBranchHead || (branchId && branchId !== 'all');

    if (!branchChosen) {
      batchId = 'all';
      batchSel.setOptions([{ value: 'all', label: 'All batches', icon: 'lock' }]);
      batchSel.setValue('all');
      batchSel.setDisabled(true);
      btHint.textContent = '· Select branch first';
      btWrap.title = 'Select branch first';
      return;
    }

    btHint.textContent = '';
    btWrap.title = '';
    batchSel.setDisabled(false);

    const matching = batches.filter((b) => {
      const bCtx = b.ctx || 'youth';
      if (ctx === 'school') {
        if (bCtx !== 'school') return false;
      } else {
        if (bCtx !== 'youth') return false;
        if (sessionId && b.sessionId && b.sessionId !== sessionId) return false;
        if (branchId && branchId !== 'all' && b.branchId !== branchId) return false;
      }
      return true;
    }).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const opts = [{ value: 'all', label: 'All batches', icon: 'layers' }]
      .concat(matching.map((b) => {
        const cr = b.courseId ? coursesById[b.courseId] : null;
        const suffix = cr && (cr.courseCode || cr.code) ? ` (${cr.courseCode || cr.code})` : '';
        return {
          value: b.id,
          label: (b.name || b.id) + suffix,
          icon: 'layers'
        };
      }));

    if (batchId !== 'all' && !matching.some((b) => b.id === batchId)) {
      batchId = 'all';
    }
    batchSel.setOptions(opts);
    batchSel.setValue(batchId);
  }

  function refreshUI() {
    paintBranchOptions();
    paintBatchOptions();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  refreshUI();

  return {
    el: wrap,
    getValue() {
      return { branchId, batchId };
    },
    setValue(next = {}) {
      if (ctx === 'school') {
        branchId = 'HO';
      } else if (isBranchHead) {
        branchId = profile.branchId;
      } else if (next.branchId !== undefined) {
        branchId = next.branchId || 'all';
      }
      if (next.batchId !== undefined) {
        batchId = branchId === 'all' ? 'all' : (next.batchId || 'all');
      }
      writePersisted(persistKey, { branchId, batchId });
      refreshUI();
    },
    reset() {
      branchId = ctx === 'school' ? 'HO' : (isBranchHead ? profile.branchId : 'all');
      batchId = 'all';
      writePersisted(persistKey, { branchId, batchId });
      refreshUI();
    },
    updateData(next = {}) {
      if (next.ctx !== undefined) ctx = next.ctx === 'school' ? 'school' : 'youth';
      if (next.sessionId !== undefined) sessionId = next.sessionId || '';
      if (next.branches !== undefined) branches = Array.isArray(next.branches) ? next.branches : [];
      if (next.batches !== undefined) batches = Array.isArray(next.batches) ? next.batches : [];
      if (next.courses !== undefined) coursesById = normalizeCourses(next.courses);
      refreshUI();
      writePersisted(persistKey, { branchId, batchId });
    }
  };
}
