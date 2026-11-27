// archives.page.js — Youth Centre Archives UI (Phase 1: Download, Password Encryption, Verify & History)
import { getContext } from '../core/app.js?v=1.8.186';
import {
  PAGE_SIZE,
  buildStats,
  buildToolbar,
  buildTableCard,
  renderPager,
  renderEmptyTableState
} from '../components/list-page.js?v=1.8.186';
import { openPopup } from '../components/modal.js?v=1.8.186';
import { openMenu } from '../components/ui-menu.js?v=1.8.186';
import { showToast } from '../components/toast.js?v=1.8.186';
import { fmtDate } from '../utils/session-rules.js?v=1.8.186';
import { formatINR } from '../utils/formatter.js?v=1.8.186';
import {
  ENABLE_ARCHIVE_SESSION_DELETE,
  computeArchiveSessionStatus,
  formatBytesCompact,
  loadArchiveOverviewData,
  scanSessionForExport,
  buildAndDownloadArchiveZip,
  verifyLocalArchiveZip
} from '../services/archive.service.js?v=1.8.186';

let cleanups = [];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function ic(name) {
  const i = document.createElement('i');
  i.setAttribute('data-lucide', name);
  return i;
}

function paint() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function fmtLogTime(log) {
  if (!log) return '-';
  const opts = {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  if (log.createdAt && typeof log.createdAt.toDate === 'function') {
    return log.createdAt.toDate().toLocaleString('en-IN', opts);
  }
  if (log.createdAt && typeof log.createdAt.seconds === 'number') {
    return new Date(log.createdAt.seconds * 1000).toLocaleString('en-IN', opts);
  }
  if (log.createdAtISO) {
    const d = new Date(log.createdAtISO);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('en-IN', opts);
  }
  return log.dateISO ? fmtDate(log.dateISO) : '-';
}

function actionPillMeta(action) {
  const a = String(action || '').toUpperCase();
  if (a === 'DOWNLOAD') return { label: 'Downloaded', tone: 'paid' };
  if (a === 'VERIFY') return { label: 'Verified', tone: 'sky' };
  if (a === 'FAILED') return { label: 'Failed', tone: 'overdue' };
  if (a === 'LOCK') return { label: 'Locked', tone: 'warning' };
  if (a === 'DELETE') return { label: 'Deleted', tone: 'muted' };
  return { label: a || 'Log', tone: 'neutral' };
}

function copyText(text, label = 'Copied') {
  if (!text) return;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(String(text)).then(() => {
      showToast({ type: 'success', message: `${label} copied to clipboard.` });
    }).catch(() => {});
  }
}

export async function mount({ container, profile, ctx }) {
  unmount();
  if (!container) return;

  const activeCtx = ctx || getContext();
  if (activeCtx !== 'youth' || (profile?.role !== 'superadmin' && profile?.role !== 'branch_head')) {
    location.replace('#/dashboard');
    return;
  }

  let destroyed = false;
  let activeTab = 'sessions';
  let overview = null;

  const sessState = { q: '', status: 'all', page: 1 };
  const histState = { q: '', sessionId: 'all', action: 'all', dateFrom: '', dateTo: '', page: 1 };

  const tabsWrap = container.querySelector('#arx-tabs');
  const panelSessions = container.querySelector('#arx-panel-sessions');
  const panelHistory = container.querySelector('#arx-panel-history');
  const reminderHost = container.querySelector('#arx-reminder-host');
  const kpiHost = container.querySelector('#arx-kpi-host');
  const sessToolbarHost = container.querySelector('#arx-sess-toolbar-host');
  const sessTableHost = container.querySelector('#arx-sess-table-host');
  const histToolbarHost = container.querySelector('#arx-hist-toolbar-host');
  const histTableHost = container.querySelector('#arx-hist-table-host');
  const verifyFileInp = container.querySelector('#arx-verify-file');
  const verifyBtn = container.querySelector('#arx-open-verify-btn');
  const phaseNote = container.querySelector('#arx-phase-note');

  if (ENABLE_ARCHIVE_SESSION_DELETE && phaseNote) {
    phaseNote.hidden = true;
  }

  function switchTab(next) {
    activeTab = next === 'history' ? 'history' : 'sessions';
    if (tabsWrap) {
      tabsWrap.querySelectorAll('.org-tab').forEach((btn) => {
        const on = btn.dataset.tab === activeTab;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    if (panelSessions) panelSessions.hidden = activeTab !== 'sessions';
    if (panelHistory) panelHistory.hidden = activeTab !== 'history';
  }

  if (tabsWrap) {
    tabsWrap.querySelectorAll('.org-tab').forEach((btn) => {
      const onClick = () => switchTab(btn.dataset.tab);
      btn.addEventListener('click', onClick);
      cleanups.push(() => btn.removeEventListener('click', onClick));
    });
  }

  if (verifyBtn && verifyFileInp) {
    const openPicker = () => {
      verifyFileInp.value = '';
      verifyFileInp.click();
    };
    const onPick = () => {
      const f = verifyFileInp.files && verifyFileInp.files[0];
      if (f) openVerifyModal(f);
    };
    verifyBtn.addEventListener('click', openPicker);
    verifyFileInp.addEventListener('change', onPick);
    cleanups.push(() => {
      verifyBtn.removeEventListener('click', openPicker);
      verifyFileInp.removeEventListener('change', onPick);
    });
  }

  let sessToolbarApi = null;
  let histToolbarApi = null;

  function renderReminderBanner() {
    if (!reminderHost) return;
    reminderHost.innerHTML = '';
    const rem = overview?.reminders;
    if (!rem || (rem.unarchivedCount === 0 && !rem.staleArchive)) return;

    const parts = [];
    if (rem.unarchivedCount > 0) {
      const previewNames = rem.unarchivedNames.slice(0, 3).join(', ');
      const suffix = rem.unarchivedNames.length > 3 ? ` +${rem.unarchivedNames.length - 3} more` : '';
      parts.push(`${rem.unarchivedCount} completed session${rem.unarchivedCount === 1 ? '' : 's'} not downloaded yet (${previewNames}${suffix}).`);
    }
    if (rem.staleArchive) {
      if (rem.daysSinceLast === null) {
        parts.push('No archive has been downloaded yet.');
      } else {
        parts.push(`Last archive download was ${rem.daysSinceLast} days ago (older than 30 days).`);
      }
    }

    const box = el('div', 'arx-reminder' + (rem.unarchivedCount > 0 ? '' : ' is-info'));
    const left = el('div', 'arx-reminder-main');
    const icBox = el('div', 'arx-reminder-ic');
    icBox.appendChild(ic(rem.unarchivedCount > 0 ? 'alert-triangle' : 'clock'));
    const txt = el('div', 'arx-reminder-txt');
    const strong = el('strong', '', 'Archive reminder: ');
    txt.append(strong, document.createTextNode(parts.join(' ')));
    left.append(icBox, txt);

    const cta = el('button', 'ui-btn ghost sm', 'View completed sessions');
    cta.type = 'button';
    cta.addEventListener('click', () => {
      sessState.status = 'completed';
      sessState.page = 1;
      if (sessToolbarApi) sessToolbarApi.setFilterValue('status', 'completed');
      renderSessionsTable();
    });

    box.append(left, cta);
    reminderHost.appendChild(box);
  }

  function renderKpis() {
    if (!kpiHost || !overview) return;
    kpiHost.innerHTML = '';
    const sessions = overview.sessions || [];
    const logs = overview.logs || [];
    const completed = sessions.filter((s) => computeArchiveSessionStatus(s).key === 'completed').length;
    const downloadLogs = logs.filter((l) => l.action === 'DOWNLOAD').length;
    const unarchived = overview.reminders?.unarchivedCount || 0;

    kpiHost.appendChild(buildStats([
      { icon: 'layers', tone: 'indigo', label: 'Youth sessions', value: String(sessions.length), sub: 'All active & archived' },
      { icon: 'check-circle-2', tone: 'green', label: 'Completed sessions', value: String(completed), sub: 'Past IST end date' },
      { icon: 'alert-circle', tone: unarchived > 0 ? 'amber' : 'sky', label: 'Not downloaded yet', value: String(unarchived), sub: unarchived > 0 ? 'Download pending' : 'All caught up' },
      { icon: 'history', tone: 'sky', label: 'Permanent archive logs', value: String(downloadLogs), sub: `${logs.length} total log entries` }
    ]).el);
  }

  function buildSessionsToolbar() {
    if (!sessToolbarHost) return;
    sessToolbarHost.innerHTML = '';
    sessToolbarApi = buildToolbar({
      placeholder: 'Search session name or dates...',
      filters: [
        {
          id: 'status',
          label: 'Status',
          options: [
            { value: 'all', label: 'All statuses', icon: 'layers' },
            { value: 'completed', label: 'Completed', icon: 'check-circle' },
            { value: 'ongoing', label: 'Ongoing', icon: 'play-circle' },
            { value: 'upcoming', label: 'Upcoming', icon: 'clock' },
            { value: 'locked_for_deletion', label: 'Locked for deletion', icon: 'lock' },
            { value: 'deleted', label: 'Deleted - archive only', icon: 'archive' }
          ]
        }
      ],
      onChange: (st) => {
        sessState.q = st.q || '';
        sessState.status = st.status || 'all';
        sessState.page = 1;
        renderSessionsTable();
      },
      onRefresh: () => reloadOverview(true)
    });
    if (sessState.status !== 'all') {
      sessToolbarApi.setFilterValue('status', sessState.status);
    }
    sessToolbarHost.appendChild(sessToolbarApi.el);
  }

  function latestDownloadForSession(sessionId) {
    const logs = overview?.logs || [];
    return logs.find((l) => l.sessionId === sessionId && l.action === 'DOWNLOAD') || null;
  }

  function renderSessionsTable() {
    if (!sessTableHost || !overview) return;
    sessTableHost.innerHTML = '';
    const card = buildTableCard({ title: 'Youth Sessions', icon: 'archive' });

    const tbl = el('table', 'lp-table lp-mobile-cards');
    tbl.innerHTML =
      '<thead><tr>' +
        '<th>Session</th>' +
        '<th>Status</th>' +
        '<th>Students</th>' +
        '<th>Last Archive Summary</th>' +
        '<th>Last Download &amp; Fingerprint</th>' +
        '<th class="act">Actions</th>' +
      '</tr></thead>';
    const tbody = el('tbody');
    tbl.appendChild(tbody);
    card.body.appendChild(tbl);

    const pagerWrap = el('div', 'lp-pager-host lp-card-foot');
    card.el.appendChild(pagerWrap);
    sessTableHost.appendChild(card.el);

    const q = sessState.q.trim().toLowerCase();
    const filtered = (overview.sessions || []).filter((s) => {
      const st = computeArchiveSessionStatus(s);
      if (sessState.status !== 'all' && st.key !== sessState.status) return false;
      if (q) {
        const hay = `${s.name || ''} ${s.startDate || ''} ${s.endDate || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (sessState.page > totalPages) sessState.page = totalPages;
    const start = (sessState.page - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);
    card.setCount(pageRows.length, filtered.length, filtered.length === 1 ? 'session' : 'sessions');

    if (pageRows.length === 0) {
      renderEmptyTableState(tbody, {
        colSpan: 6,
        title: 'No matching Youth sessions',
        desc: 'No Youth Centre sessions match your search or status filter.',
        onClear: (sessState.q || sessState.status !== 'all') ? () => {
          sessState.q = '';
          sessState.status = 'all';
          sessState.page = 1;
          if (sessToolbarApi) {
            sessToolbarApi.clearSearch();
            sessToolbarApi.setFilterValue('status', 'all');
          }
          renderSessionsTable();
        } : undefined
      });
      pagerWrap.hidden = true;
      paint();
      return;
    }

    pageRows.forEach((s) => {
      const st = computeArchiveSessionStatus(s);
      const count = overview.studentCounts?.[s.id];
      const latestLog = latestDownloadForSession(s.id);
      const summary = s.lastArchiveSummary || latestLog?.counts;
      const lastCollected = s.lastArchiveSummary?.collected ?? latestLog?.totals?.collected;
      const lastSha = latestLog?.zipSha256 || s.lastArchiveSha256 || '';
      const lastDateText = latestLog ? fmtLogTime(latestLog) : (s.lastArchiveDate ? fmtDate(s.lastArchiveDate) : 'Not downloaded');

      const tr = el('tr');

      const tdSess = el('td', 'lp-td-primary');
      tdSess.dataset.label = 'Session';
      const sessCell = el('div', 'arx-session-cell');
      sessCell.appendChild(el('span', 'arx-session-name', s.name || s.id));
      const range = (s.startDate || s.endDate)
        ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}`
        : 'Dates not set';
      sessCell.appendChild(el('span', 'arx-session-dates', range));
      tdSess.appendChild(sessCell);

      const tdStatus = el('td');
      tdStatus.dataset.label = 'Status';
      tdStatus.appendChild(el('span', `pill ${st.tone}`, st.label));

      const tdStudents = el('td');
      tdStudents.dataset.label = 'Students';
      tdStudents.textContent = count === null || count === undefined ? '—' : String(count);

      const tdSum = el('td');
      tdSum.dataset.label = 'Last Archive Summary';
      const sumBox = el('div', 'arx-stat-mini');
      if (summary && (summary.payments !== undefined || lastCollected !== undefined)) {
        sumBox.appendChild(el('strong', '', formatINR(lastCollected || 0)));
        sumBox.appendChild(el('span', '', `${summary.payments || 0} payments · ${summary.receipts || 0} receipts`));
      } else {
        sumBox.appendChild(el('span', '', 'No archive snapshot recorded yet'));
      }
      tdSum.appendChild(sumBox);

      const tdFp = el('td');
      tdFp.dataset.label = 'Last Download & Fingerprint';
      const fpBox = el('div', 'arx-stat-mini');
      fpBox.appendChild(el('span', '', lastDateText));
      if (lastSha) {
        const badge = el('span', 'arx-fp', `${lastSha.slice(0, 14)}…`);
        badge.title = `ZIP SHA-256: ${lastSha}`;
        fpBox.appendChild(badge);
      }
      tdFp.appendChild(fpBox);

      const tdAct = el('td', 'act');
      tdAct.dataset.label = 'Actions';
      const actWrap = el('div');
      actWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;';

      const dlBtn = el('button', 'ui-btn primary sm');
      dlBtn.type = 'button';
      dlBtn.disabled = st.key === 'deleted';
      dlBtn.append(ic('download'), el('span', '', 'Prepare & Download ZIP'));
      dlBtn.addEventListener('click', () => openExportWizardModal(s));

      const moreBtn = el('button', 'ui-kebab');
      moreBtn.type = 'button';
      moreBtn.setAttribute('aria-label', `More actions for ${s.name || s.id}`);
      moreBtn.appendChild(ic('more-vertical'));
      moreBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const items = [];
        if (st.key !== 'deleted') {
          items.push({
            label: 'Prepare & Download ZIP',
            icon: 'download',
            onClick: () => openExportWizardModal(s)
          });
        }
        items.push({
          label: 'View History for This Session',
          icon: 'history',
          onClick: () => {
            histState.sessionId = s.id;
            histState.page = 1;
            switchTab('history');
            if (histToolbarApi) histToolbarApi.setFilterValue('sessionId', s.id);
            renderHistoryTable();
          }
        });
        if (lastSha) {
          items.push({
            label: 'Copy Latest SHA-256',
            icon: 'copy',
            onClick: () => copyText(lastSha, 'SHA-256 fingerprint')
          });
        }
        openMenu(moreBtn, items);
      });

      actWrap.append(dlBtn, moreBtn);
      tdAct.appendChild(actWrap);

      tr.append(tdSess, tdStatus, tdStudents, tdSum, tdFp, tdAct);
      tbody.appendChild(tr);
    });

    renderPager(pagerWrap, {
      page: sessState.page,
      pageSize: PAGE_SIZE,
      totalItems: filtered.length,
      onPageChange: (p) => {
        sessState.page = p;
        renderSessionsTable();
      }
    });
    paint();
  }

  function buildHistoryToolbar() {
    if (!histToolbarHost || !overview) return;
    histToolbarHost.innerHTML = '';

    const sessOpts = [{ value: 'all', label: 'All sessions', icon: 'layers' }].concat(
      (overview.sessions || []).map((s) => ({
        value: s.id,
        label: s.name || s.id,
        icon: 'calendar'
      }))
    );

    histToolbarApi = buildToolbar({
      placeholder: 'Search user, filename, or SHA-256...',
      filters: [
        { id: 'sessionId', label: 'Session', options: sessOpts },
        {
          id: 'action',
          label: 'Action',
          options: [
            { value: 'all', label: 'All actions', icon: 'activity' },
            { value: 'DOWNLOAD', label: 'Downloaded', icon: 'download' },
            { value: 'VERIFY', label: 'Verified', icon: 'shield-check' },
            { value: 'FAILED', label: 'Failed', icon: 'alert-octagon' },
            { value: 'LOCK', label: 'Locked', icon: 'lock' },
            { value: 'DELETE', label: 'Deleted', icon: 'trash-2' }
          ]
        }
      ],
      onChange: (st) => {
        histState.q = st.q || '';
        histState.sessionId = st.sessionId || 'all';
        histState.action = st.action || 'all';
        histState.page = 1;
        renderHistoryTable();
      },
      onRefresh: () => reloadOverview(true)
    });

    const mkDateFilter = (labelText, value, onVal) => {
      const wrap = el('div', 'lp-filter');
      wrap.style.minWidth = '150px';
      wrap.appendChild(el('span', 'lp-filter-label', labelText));
      const box = el('div', 'ui-input-wrap');
      const inp = el('input', 'ui-input');
      inp.type = 'date';
      inp.value = value || '';
      inp.style.cssText = 'height:42px;padding-left:12px;';
      inp.addEventListener('change', () => onVal(inp.value || ''));
      box.appendChild(inp);
      wrap.appendChild(box);
      return wrap;
    };

    histToolbarApi.addFilterEl(mkDateFilter('From date', histState.dateFrom, (v) => {
      histState.dateFrom = v;
      histState.page = 1;
      renderHistoryTable();
    }));
    histToolbarApi.addFilterEl(mkDateFilter('To date', histState.dateTo, (v) => {
      histState.dateTo = v;
      histState.page = 1;
      renderHistoryTable();
    }));

    if (histState.sessionId !== 'all') histToolbarApi.setFilterValue('sessionId', histState.sessionId);
    if (histState.action !== 'all') histToolbarApi.setFilterValue('action', histState.action);

    histToolbarHost.appendChild(histToolbarApi.el);
  }

  function openLogDetailsModal(log) {
    const popup = openPopup({
      title: 'Archive History Details',
      subtitle: `${log.sessionName || log.sessionId || 'Session'} — ${actionPillMeta(log.action).label}`,
      icon: 'file-check-2',
      wide: true
    });

    const stack = el('div', 'arx-modal-stack');
    const grid = el('div', 'arx-sum-grid');
    const items = [
      ['Action', actionPillMeta(log.action).label],
      ['Session', log.sessionName || log.sessionId || '-'],
      ['Scope', log.scopeLabel || log.scopeType || '-'],
      ['Performed By', `${log.byName || log.byEmail || '-'}${log.byDesignation ? ' (' + log.byDesignation + ')' : ''}`],
      ['Date / Time', fmtLogTime(log)],
      ['File Size', log.sizeBytes ? formatBytesCompact(log.sizeBytes) : '-'],
      ['Students', String(log.counts?.students ?? '-')],
      ['Payments / Receipts', `${log.counts?.payments ?? '-'} / ${log.counts?.receipts ?? '-'}`],
      ['Total Collected', log.totals?.collected !== undefined ? formatINR(log.totals.collected) : '-']
    ];
    items.forEach(([k, v]) => {
      const card = el('div', 'arx-sum-item');
      card.append(el('span', '', k), el('strong', '', v));
      grid.appendChild(card);
    });
    stack.appendChild(grid);

    const metaBox = el('div', 'arx-scope-box');
    const metaRows = [
      ['Filename', log.filename || '-'],
      ['ID Docs Included', log.includesIdDocs ? 'Yes (Full session export)' : 'No'],
      ['AES-256 Encrypted', log.encrypted ? 'Yes' : 'No'],
      ['ZIP SHA-256', log.zipSha256 || '-'],
      ['Manifest SHA-256', log.manifestSha256 || '-']
    ];
    metaRows.forEach(([label, val]) => {
      const row = el('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12.5px;flex-wrap:wrap;';
      const left = el('div');
      const b = el('strong', '', label + ': ');
      const sp = el('span', '', val);
      sp.style.wordBreak = 'break-all';
      left.append(b, sp);
      row.appendChild(left);
      if (val && val !== '-' && label.includes('SHA-256')) {
        const cp = el('button', 'ui-btn ghost sm', 'Copy');
        cp.type = 'button';
        cp.addEventListener('click', () => copyText(val, label));
        row.appendChild(cp);
      }
      metaBox.appendChild(row);
    });
    stack.appendChild(metaBox);

    if (log.error) {
      const errBox = el('div', 'arx-warn-box danger');
      errBox.append(ic('alert-octagon'), el('span', '', `Error: ${log.error}`));
      stack.appendChild(errBox);
    }

    popup.container.appendChild(stack);
    paint();
  }

  function renderHistoryTable() {
    if (!histTableHost || !overview) return;
    histTableHost.innerHTML = '';
    const card = buildTableCard({ title: 'Permanent Archive History', icon: 'history' });

    const tbl = el('table', 'lp-table lp-mobile-cards');
    tbl.innerHTML =
      '<thead><tr>' +
        '<th>Date &amp; Time</th>' +
        '<th>Session &amp; Scope</th>' +
        '<th>Action</th>' +
        '<th>Performed By</th>' +
        '<th>File &amp; SHA-256</th>' +
        '<th class="act">Details</th>' +
      '</tr></thead>';
    const tbody = el('tbody');
    tbl.appendChild(tbody);
    card.body.appendChild(tbl);

    const pagerWrap = el('div', 'lp-pager-host lp-card-foot');
    card.el.appendChild(pagerWrap);
    histTableHost.appendChild(card.el);

    const q = histState.q.trim().toLowerCase();
    const filtered = (overview.logs || []).filter((l) => {
      if (histState.sessionId !== 'all' && l.sessionId !== histState.sessionId) return false;
      if (histState.action !== 'all' && String(l.action || '').toUpperCase() !== histState.action) return false;
      const d = String(l.dateISO || l.createdAtISO || '').slice(0, 10);
      if (histState.dateFrom && (!d || d < histState.dateFrom)) return false;
      if (histState.dateTo && (!d || d > histState.dateTo)) return false;
      if (q) {
        const hay = [l.sessionName, l.scopeLabel, l.filename, l.byName, l.byEmail, l.byDesignation, l.zipSha256, l.error].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (histState.page > totalPages) histState.page = totalPages;
    const start = (histState.page - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);
    card.setCount(pageRows.length, filtered.length, filtered.length === 1 ? 'log' : 'logs');

    if (pageRows.length === 0) {
      const hasFilters = histState.q || histState.sessionId !== 'all' || histState.action !== 'all' || histState.dateFrom || histState.dateTo;
      renderEmptyTableState(tbody, {
        colSpan: 6,
        title: 'No archive logs found',
        desc: hasFilters ? 'Try clearing one or more history filters.' : 'Downloads and integrity verifications will appear permanently here.',
        onClear: hasFilters ? () => {
          histState.q = '';
          histState.sessionId = 'all';
          histState.action = 'all';
          histState.dateFrom = '';
          histState.dateTo = '';
          histState.page = 1;
          buildHistoryToolbar();
          renderHistoryTable();
        } : undefined
      });
      pagerWrap.hidden = true;
      paint();
      return;
    }

    pageRows.forEach((l) => {
      const pill = actionPillMeta(l.action);
      const tr = el('tr');

      const tdTime = el('td', 'lp-td-primary', fmtLogTime(l));
      tdTime.dataset.label = 'Date & Time';

      const tdSess = el('td');
      tdSess.dataset.label = 'Session & Scope';
      const sBox = el('div', 'arx-stat-mini');
      sBox.appendChild(el('strong', '', l.sessionName || l.sessionId || '-'));
      sBox.appendChild(el('span', '', l.scopeLabel || l.scopeType || '-'));
      tdSess.appendChild(sBox);

      const tdActType = el('td');
      tdActType.dataset.label = 'Action';
      tdActType.appendChild(el('span', `pill ${pill.tone}`, pill.label));

      const tdBy = el('td');
      tdBy.dataset.label = 'Performed By';
      const byBox = el('div', 'arx-stat-mini');
      byBox.appendChild(el('strong', '', l.byName || l.byEmail || '-'));
      byBox.appendChild(el('span', '', l.byDesignation || 'Staff'));
      tdBy.appendChild(byBox);

      const tdFile = el('td');
      tdFile.dataset.label = 'File & SHA-256';
      const fBox = el('div', 'arx-stat-mini');
      const sizeText = l.sizeBytes ? ` · ${formatBytesCompact(l.sizeBytes)}` : '';
      const encText = l.encrypted ? ' · Encrypted' : '';
      fBox.appendChild(el('span', '', `${l.filename || '-'}${sizeText}${encText}`));
      if (l.zipSha256) {
        const fp = el('span', 'arx-fp', `${l.zipSha256.slice(0, 14)}…`);
        fp.title = l.zipSha256;
        fBox.appendChild(fp);
      }
      tdFile.appendChild(fBox);

      const tdDet = el('td', 'act');
      tdDet.dataset.label = 'Details';
      const detBtn = el('button', 'ui-btn ghost sm');
      detBtn.type = 'button';
      detBtn.append(ic('eye'), el('span', '', 'Details'));
      detBtn.addEventListener('click', () => openLogDetailsModal(l));
      tdDet.appendChild(detBtn);

      tr.append(tdTime, tdSess, tdActType, tdBy, tdFile, tdDet);
      tbody.appendChild(tr);
    });

    renderPager(pagerWrap, {
      page: histState.page,
      pageSize: PAGE_SIZE,
      totalItems: filtered.length,
      onPageChange: (p) => {
        histState.page = p;
        renderHistoryTable();
      }
    });
    paint();
  }

  function openExportWizardModal(session) {
    const isSuper = profile?.role === 'superadmin';
    const allBranches = overview?.branches || [];
    let scopeType = isSuper ? 'full' : 'branch';
    let selectedBranchIds = isSuper ? allBranches.map((b) => b.id) : (profile?.branchId ? [profile.branchId] : []);
    let snapshot = null;
    let scanning = false;
    let debouncing = false;
    let building = false;
    let cancelled = false;
    let modalClosed = false;
    let encryptChecked = false;
    let pwDefaultAppliedForScan = false;
    let scanSeq = 0;
    let rescanTimer = null;

    const popup = openPopup({
      title: `Prepare Archive — ${session.name || session.id}`,
      subtitle: 'Read-only offline snapshot with SHA-256 verification manifest',
      icon: 'archive',
      wide: true,
      saving: () => scanning || building,
      onClose: () => {
        modalClosed = true;
        cancelled = true;
        if (rescanTimer) {
          clearTimeout(rescanTimer);
          rescanTimer = null;
        }
      }
    });

    const stack = el('div', 'arx-modal-stack');

    const scopeBox = el('div', 'arx-scope-box');
    const scopeTitle = el('strong', '', isSuper ? 'Export Scope' : 'Branch Scope (Locked)');
    scopeTitle.style.fontSize = '13px';
    scopeBox.appendChild(scopeTitle);

    const branchCheckWrap = el('div', 'arx-branch-checklist');
    branchCheckWrap.hidden = true;

    const fullPill = el('label', 'arx-radio-pill is-selected');
    const partialPill = el('label', 'arx-radio-pill');

    let fullRadio = null;
    let partialRadio = null;
    const branchCheckboxes = [];

    if (isSuper) {
      const optsRow = el('div', 'arx-scope-opts');

      const rFull = el('input');
      rFull.type = 'radio';
      rFull.name = 'arx-scope-mode';
      rFull.value = 'full';
      rFull.checked = true;
      fullRadio = rFull;
      fullPill.append(rFull, el('span', '', 'Full Session (All Branches)'));

      const rPartial = el('input');
      rPartial.type = 'radio';
      rPartial.name = 'arx-scope-mode';
      rPartial.value = 'branches';
      partialRadio = rPartial;
      partialPill.append(rPartial, el('span', '', 'Specific Branches Only'));

      const scopeHint = el('small', 'text-mute', 'Includes all branches, student records, photos, Aadhaar & documents.');

      allBranches.forEach((b) => {
        const lbl = el('label', 'arx-branch-check');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.value = b.id;
        cb.addEventListener('change', () => {
          if (building) return;
          selectedBranchIds = Array.from(branchCheckWrap.querySelectorAll('input:checked')).map((x) => x.value);
          scheduleAutoScan(400);
        });
        branchCheckboxes.push(cb);
        lbl.append(cb, el('span', '', `${b.name || b.id}${b.code ? ' (' + b.code + ')' : ''}`));
        branchCheckWrap.appendChild(lbl);
      });

      const onScopeChange = (nextMode) => {
        if (building) return;
        scopeType = nextMode;
        fullPill.classList.toggle('is-selected', scopeType === 'full');
        partialPill.classList.toggle('is-selected', scopeType === 'branches');
        branchCheckWrap.hidden = scopeType !== 'branches';
        scopeHint.textContent = scopeType === 'full'
          ? 'Includes all branches, student records, photos, Aadhaar & documents.'
          : 'Includes selected branch(es) with all student records, photos, Aadhaar & documents.';
        scheduleAutoScan(400);
      };

      rFull.addEventListener('change', () => onScopeChange('full'));
      rPartial.addEventListener('change', () => onScopeChange('branches'));

      optsRow.append(fullPill, partialPill);
      scopeBox.append(optsRow, branchCheckWrap, scopeHint);
    } else {
      const brName = allBranches.find((b) => b.id === profile?.branchId)?.name || profile?.branchId || 'Your branch';
      scopeBox.appendChild(el('span', 'text-mute', `Locked to branch "${brName}". Includes only your branch's students, photos, Aadhaar & documents.`));
    }

    stack.appendChild(scopeBox);

    const progWrap = el('div', 'arx-progress-wrap');
    progWrap.hidden = true;
    const progHead = el('div', 'arx-progress-head');
    const progStage = el('span', '', 'Preparing...');
    const progPct = el('span', '', '0%');
    progHead.append(progStage, progPct);
    const progTrack = el('div', 'arx-progress-track');
    const progBar = el('div', 'arx-progress-bar');
    progTrack.appendChild(progBar);
    const progSub = el('div', 'arx-progress-sub', 'Keep this tab open until complete.');
    progWrap.append(progHead, progTrack, progSub);
    stack.appendChild(progWrap);

    const bodyHost = el('div', 'arx-modal-stack');
    stack.appendChild(bodyHost);

    const foot = el('div');
    foot.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-top:4px;';
    const leftFoot = el('div');
    leftFoot.style.cssText = 'display:flex;gap:8px;align-items:center;';
    const rescanBtn = el('button', 'ui-btn ghost sm');
    rescanBtn.type = 'button';
    rescanBtn.append(ic('refresh-cw'), el('span', '', 'Re-scan'));
    rescanBtn.addEventListener('click', () => startScan());
    leftFoot.appendChild(rescanBtn);

    const rightFoot = el('div');
    rightFoot.style.cssText = 'display:flex;gap:8px;align-items:center;';
    const cancelBtn = el('button', 'ui-btn ghost', 'Close');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      if (scanning || building) {
        cancelled = true;
        showToast({ type: 'warning', message: 'Cancelling archive operation...' });
        return;
      }
      popup.close();
    });

    const downloadBtn = el('button', 'ui-btn primary');
    downloadBtn.type = 'button';
    downloadBtn.append(ic('download'), el('span', '', 'Download Archive (.zip)'));

    rightFoot.append(cancelBtn, downloadBtn);
    foot.append(leftFoot, rightFoot);
    stack.appendChild(foot);

    popup.container.appendChild(stack);

    let pwInput = null;
    let pwConfirmInput = null;
    let errTextEl = null;
    let resultBox = null;

    function updateProgressUI(pct, label) {
      const busy = scanning || building || debouncing;
      progWrap.hidden = !busy;
      const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
      progStage.textContent = label || 'Working...';
      progPct.textContent = `${safePct}%`;
      progBar.style.width = `${safePct}%`;
      cancelBtn.textContent = (scanning || building) ? 'Cancel' : 'Close';
      rescanBtn.disabled = scanning || building;
      downloadBtn.disabled = !snapshot || busy;
      if (fullRadio) fullRadio.disabled = building;
      if (partialRadio) partialRadio.disabled = building;
      branchCheckboxes.forEach((cb) => { cb.disabled = building; });
    }

    function renderBodyFromState() {
      bodyHost.innerHTML = '';
      if (resultBox) bodyHost.appendChild(resultBox);

      if (!snapshot) {
        if (!scanning && !debouncing && isSuper && scopeType === 'branches' && selectedBranchIds.length === 0) {
          const w = el('div', 'arx-warn-box');
          w.append(ic('alert-triangle'), el('span', '', 'Select at least one branch above to scan and download.'));
          bodyHost.appendChild(w);
        }
        downloadBtn.disabled = true;
        paint();
        return;
      }

      const grid = el('div', 'arx-sum-grid');
      const idNote = snapshot.idDocCount > 0 ? `${snapshot.idDocCount} ID / Aadhaar record${snapshot.idDocCount === 1 ? '' : 's'} included` : 'All docs & Aadhaar included';
      const tiles = [
        ['Students', String(snapshot.counts.students), `${snapshot.scopeBranches.length} branch${snapshot.scopeBranches.length === 1 ? '' : 'es'}`],
        ['Payments & Waivers', String(snapshot.counts.payments), `${formatINR(snapshot.totals.collected)} collected`],
        ['Receipts', String(snapshot.counts.receipts), 'Admission & payment'],
        ['Photos & Docs', `Photos: ${snapshot.counts.photos} | Documents: ${snapshot.counts.docs}`, idNote],
        ['Estimated Reads', String(snapshot.readsUsed), 'Pre-scanned once'],
        ['Estimated ZIP Size', formatBytesCompact(snapshot.estimatedZipBytes), snapshot.over200MB ? 'Large archive' : 'Ready to build']
      ];
      tiles.forEach(([label, val, sub]) => {
        const card = el('div', 'arx-sum-item');
        card.append(el('span', '', label), el('strong', '', val), el('small', '', sub));
        grid.appendChild(card);
      });
      bodyHost.appendChild(grid);

      if (snapshot.over200MB) {
        const w200 = el('div', 'arx-warn-box');
        w200.append(
          ic('alert-triangle'),
          el('span', '', `Estimated archive size is ${formatBytesCompact(snapshot.estimatedZipBytes)} (over 200 MB). Keep this browser tab active while creating and saving the ZIP.`)
        );
        bodyHost.appendChild(w200);
      }

      if (snapshot.counts.missingFiles > 0) {
        const wMiss = el('div', 'arx-warn-box');
        wMiss.append(
          ic('file-warning'),
          el('span', '', `${snapshot.counts.missingFiles} remote file${snapshot.counts.missingFiles === 1 ? '' : 's'} could not be fetched and will be listed under missingFiles inside manifest.json.`)
        );
        bodyHost.appendChild(wMiss);
      }

      const hasAadhaarDocs = Boolean(snapshot.hasAadhaarDocs || snapshot.idDocCount > 0);
      if (!pwDefaultAppliedForScan) {
        encryptChecked = false;
        pwDefaultAppliedForScan = true;
      }

      const pwPanel = el('div', 'arx-pw-panel');
      const chkRow = el('label', 'arx-check-row');
      const chk = el('input');
      chk.type = 'checkbox';
      chk.id = 'arx-encrypt-checkbox';
      chk.checked = encryptChecked;
      chk.disabled = scanning || building;
      chkRow.append(chk, el('span', '', 'Protect archive with a password (optional AES-256 encryption)'));
      pwPanel.appendChild(chkRow);

      const unencryptedWarn = el('div', 'arx-warn-box danger');
      unencryptedWarn.hidden = encryptChecked || !hasAadhaarDocs;
      unencryptedWarn.append(
        ic('shield-alert'),
        el('span', '', 'Warning: Aadhaar records are included and will be saved unencrypted unless you set a password above.')
      );
      pwPanel.appendChild(unencryptedWarn);

      const pwFieldsWrap = el('div', 'arx-pw-fields');
      pwFieldsWrap.hidden = !encryptChecked;

      const f1 = el('div', 'ui-field');
      f1.innerHTML = '<label for="arx-pw-1">Archive Password (min 6 chars)</label>';
      const pw1Wrap = el('div', 'ui-input-wrap');
      pwInput = el('input', 'ui-input');
      pwInput.type = 'password';
      pwInput.id = 'arx-pw-1';
      pwInput.autocomplete = 'new-password';
      pwInput.placeholder = 'Enter strong password';
      pwInput.style.paddingRight = '62px';
      const eye1 = el('button', 'ui-btn ghost sm', 'Show');
      eye1.type = 'button';
      eye1.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);padding:4px 8px;';
      eye1.addEventListener('click', () => {
        const show = pwInput.type === 'password';
        pwInput.type = show ? 'text' : 'password';
        if (pwConfirmInput) pwConfirmInput.type = show ? 'text' : 'password';
        eye1.textContent = show ? 'Hide' : 'Show';
      });
      pw1Wrap.append(ic('lock'), pwInput, eye1);
      f1.appendChild(pw1Wrap);

      const f2 = el('div', 'ui-field');
      f2.innerHTML = '<label for="arx-pw-2">Confirm Password</label>';
      const pw2Wrap = el('div', 'ui-input-wrap');
      pwConfirmInput = el('input', 'ui-input');
      pwConfirmInput.type = 'password';
      pwConfirmInput.id = 'arx-pw-2';
      pwConfirmInput.autocomplete = 'new-password';
      pwConfirmInput.placeholder = 'Re-enter password';
      pw2Wrap.append(ic('lock'), pwConfirmInput);
      f2.appendChild(pw2Wrap);

      pwFieldsWrap.append(f1, f2);
      pwPanel.appendChild(pwFieldsWrap);

      const loseWarn = el('div', 'arx-warn-box');
      loseWarn.hidden = !encryptChecked;
      loseWarn.append(ic('key-round'), el('span', '', 'If you lose this password, the archive cannot be opened. Passwords are never saved anywhere.'));
      pwPanel.appendChild(loseWarn);

      errTextEl = el('div', 'ui-err');
      errTextEl.hidden = true;
      pwPanel.appendChild(errTextEl);

      chk.addEventListener('change', () => {
        encryptChecked = chk.checked;
        pwFieldsWrap.hidden = !encryptChecked;
        loseWarn.hidden = !encryptChecked;
        unencryptedWarn.hidden = encryptChecked || !hasAadhaarDocs;
        if (errTextEl) errTextEl.hidden = true;
      });

      bodyHost.appendChild(pwPanel);
      downloadBtn.disabled = scanning || building || debouncing;
      paint();
    }

    function scheduleAutoScan(delayMs = 400) {
      if (building || modalClosed) return;
      if (rescanTimer) {
        clearTimeout(rescanTimer);
        rescanTimer = null;
      }
      // Supersede any active scan silently so stale results cannot overwrite the new selection
      scanSeq += 1;
      scanning = false;
      cancelled = false;
      snapshot = null;
      resultBox = null;

      if (isSuper && scopeType === 'branches' && selectedBranchIds.length === 0) {
        debouncing = false;
        updateProgressUI(0, '');
        renderBodyFromState();
        return;
      }

      debouncing = true;
      renderBodyFromState();
      updateProgressUI(2, 'Scanning updated selection...');
      rescanTimer = setTimeout(() => {
        rescanTimer = null;
        debouncing = false;
        startScan();
      }, delayMs);
    }

    async function startScan() {
      if (building || modalClosed) return;
      if (rescanTimer) {
        clearTimeout(rescanTimer);
        rescanTimer = null;
      }
      debouncing = false;
      if (isSuper && scopeType === 'branches' && selectedBranchIds.length === 0) {
        snapshot = null;
        updateProgressUI(0, '');
        renderBodyFromState();
        return;
      }
      const mySeq = ++scanSeq;
      cancelled = false;
      scanning = true;
      resultBox = null;
      pwDefaultAppliedForScan = false;
      downloadBtn.disabled = true;
      updateProgressUI(2, 'Starting session scan...');

      try {
        const res = await scanSessionForExport({
          session,
          profile,
          allBranches,
          allCourses: overview?.courses || [],
          allBatches: overview?.batches || [],
          scopeType,
          selectedBranchIds,
          onProgress: ({ pct, label }) => {
            if (!modalClosed && mySeq === scanSeq) updateProgressUI(pct, label);
          },
          isCancelled: () => cancelled || modalClosed || mySeq !== scanSeq
        });
        if (modalClosed || mySeq !== scanSeq) return;
        snapshot = res;
      } catch (err) {
        if (err && err.message === 'CANCELLED') {
          if (!modalClosed && cancelled && mySeq === scanSeq) {
            showToast({ type: 'info', message: 'Session scan cancelled.' });
          }
        } else if (!modalClosed && mySeq === scanSeq) {
          showToast({ type: 'error', message: err?.message || 'Could not scan session records.' });
        }
      } finally {
        if (mySeq === scanSeq) {
          scanning = false;
          updateProgressUI(0, '');
          if (!modalClosed) renderBodyFromState();
        }
      }
    }

    downloadBtn.addEventListener('click', async () => {
      if (!snapshot || scanning || building) return;
      if (errTextEl) {
        errTextEl.hidden = true;
        errTextEl.textContent = '';
      }
      const pw = pwInput ? pwInput.value : '';
      const pw2 = pwConfirmInput ? pwConfirmInput.value : '';
      if (encryptChecked) {
        if (pw.length < 6) {
          if (errTextEl) {
            errTextEl.textContent = 'Enter a password of at least 6 characters.';
            errTextEl.hidden = false;
          }
          if (pwInput) pwInput.focus();
          return;
        }
        if (pw !== pw2) {
          if (errTextEl) {
            errTextEl.textContent = 'Passwords do not match.';
            errTextEl.hidden = false;
          }
          if (pwConfirmInput) pwConfirmInput.focus();
          return;
        }
      }

      cancelled = false;
      building = true;
      downloadBtn.disabled = true;
      resultBox = null;
      updateProgressUI(5, 'Building offline archive ZIP...');

      try {
        const built = await buildAndDownloadArchiveZip({
          snapshot,
          encrypt: encryptChecked,
          password: encryptChecked ? pw : '',
          triggerBrowserDownload: true,
          onProgress: ({ pct, stage }) => {
            if (!modalClosed) updateProgressUI(pct, stage);
          },
          isCancelled: () => cancelled || modalClosed
        });
        if (modalClosed) return;

        resultBox = el('div', 'arx-reminder is-info');
        const main = el('div', 'arx-reminder-main');
        const icB = el('div', 'arx-reminder-ic');
        icB.appendChild(ic('check-circle-2'));
        const txt = el('div', 'arx-reminder-txt');
        const b = el('strong', '', 'Archive downloaded: ');
        txt.append(
          b,
          document.createTextNode(`${built.filename} (${formatBytesCompact(built.sizeBytes)}). ZIP SHA-256: `),
          el('span', 'arx-fp', built.zipSha256)
        );
        main.append(icB, txt);
        const cpBtn = el('button', 'ui-btn ghost sm', 'Copy SHA-256');
        cpBtn.type = 'button';
        cpBtn.addEventListener('click', () => copyText(built.zipSha256, 'ZIP SHA-256'));
        resultBox.append(main, cpBtn);

        showToast({ type: 'success', message: `Archive saved: ${built.filename}` });
        await reloadOverview(false);
      } catch (err) {
        if (err && err.message === 'CANCELLED') {
          if (!modalClosed) showToast({ type: 'info', message: 'Archive build cancelled.' });
        } else if (!modalClosed) {
          showToast({ type: 'error', message: err?.message || 'Failed to build archive ZIP.' });
        }
      } finally {
        building = false;
        updateProgressUI(0, '');
        if (!modalClosed) renderBodyFromState();
      }
    });

    paint();
    startScan();
  }

  async function openVerifyModal(file) {
    const popup = openPopup({
      title: 'Verify Offline Archive ZIP',
      subtitle: file.name || 'archive.zip',
      icon: 'shield-check',
      wide: true
    });

    const stack = el('div', 'arx-modal-stack');
    const progWrap = el('div', 'arx-progress-wrap');
    const progHead = el('div', 'arx-progress-head');
    const progStage = el('span', '', 'Reading ZIP locally...');
    const progPct = el('span', '', '0%');
    progHead.append(progStage, progPct);
    const progTrack = el('div', 'arx-progress-track');
    const progBar = el('div', 'arx-progress-bar');
    progTrack.appendChild(progBar);
    progWrap.append(progHead, progTrack);
    stack.appendChild(progWrap);

    const resHost = el('div', 'arx-modal-stack');
    stack.appendChild(resHost);
    popup.container.appendChild(stack);
    paint();

    try {
      const res = await verifyLocalArchiveZip(file, {
        profile,
        logToFirestore: true,
        onProgress: ({ pct, msg }) => {
          progStage.textContent = msg || 'Verifying...';
          progPct.textContent = `${pct}%`;
          progBar.style.width = `${pct}%`;
        }
      });

      progWrap.hidden = true;
      const banner = el('div', 'arx-reminder ' + (res.ok ? 'is-info' : ''));
      const main = el('div', 'arx-reminder-main');
      const icB = el('div', 'arx-reminder-ic');
      icB.appendChild(ic(res.ok ? 'shield-check' : 'shield-alert'));
      const txt = el('div', 'arx-reminder-txt');
      txt.append(
        el('strong', '', res.ok ? 'Integrity Passed: ' : 'Integrity Check Failed: '),
        document.createTextNode(
          res.ok
            ? `All ${res.verifiedCount}/${res.checkedCount} archive files matched their SHA-256 checksums.`
            : `${res.missing.length} missing, ${res.mismatches.length} modified, ${res.missingViewer.length} missing viewer files.`
        )
      );
      main.append(icB, txt);
      banner.appendChild(main);
      resHost.appendChild(banner);

      const grid = el('div', 'arx-sum-grid');
      const m = res.manifest || {};
      [
        ['Session', m.session?.name || '-'],
        ['Scope', m.scope?.label || '-'],
        ['Generated By', m.generatedBy || '-'],
        ['Files Verified', `${res.verifiedCount} / ${res.checkedCount}`],
        ['ZIP Size', formatBytesCompact(res.sizeBytes)],
        ['ZIP SHA-256', `${res.zipSha256.slice(0, 14)}…`]
      ].forEach(([k, v]) => {
        const card = el('div', 'arx-sum-item');
        card.append(el('span', '', k), el('strong', '', v));
        grid.appendChild(card);
      });
      resHost.appendChild(grid);

      if (res.missing.length > 0 || res.mismatches.length > 0 || res.missingViewer.length > 0) {
        const list = el('div', 'arx-verify-list');
        res.missingViewer.forEach((p) => list.appendChild(el('div', '', `Missing required viewer file: ${p}`)));
        res.missing.forEach((p) => list.appendChild(el('div', '', `Missing manifest file: ${p}`)));
        res.mismatches.forEach((mm) => list.appendChild(el('div', '', `SHA-256 mismatch: ${mm.path}`)));
        resHost.appendChild(list);
      }

      if (m.missingFiles && m.missingFiles.length > 0) {
        const w = el('div', 'arx-warn-box');
        w.append(ic('info'), el('span', '', `Note: Archive was created with ${m.missingFiles.length} unavailable remote file(s) recorded at export time.`));
        resHost.appendChild(w);
      }

      await reloadOverview(false);
    } catch (err) {
      progWrap.hidden = true;
      const errBox = el('div', 'arx-warn-box danger');
      errBox.append(ic('alert-octagon'), el('span', '', err?.message || 'Could not inspect this ZIP file.'));
      resHost.appendChild(errBox);
    }
    paint();
  }

  async function reloadOverview(showLoadingToast = false) {
    if (destroyed) return;
    try {
      const next = await loadArchiveOverviewData({ profile });
      if (destroyed) return;
      overview = next;
      renderReminderBanner();
      renderKpis();
      buildSessionsToolbar();
      renderSessionsTable();
      buildHistoryToolbar();
      renderHistoryTable();
      paint();
      if (showLoadingToast) {
        showToast({ type: 'success', message: 'Archives refreshed.' });
      }
    } catch (err) {
      if (destroyed) return;
      console.error('[archives] load failed:', err);
      showToast({ type: 'error', message: err?.message || 'Could not load Youth archives.' });
    }
  }

  cleanups.push(() => {
    destroyed = true;
  });

  if (sessTableHost) {
    sessTableHost.innerHTML = '<div class="card"><div class="card-body"><p class="text-mute">Loading Youth Centre sessions and archive history...</p></div></div>';
  }
  await reloadOverview(false);
}

export function unmount() {
  cleanups.forEach((fn) => {
    try { fn(); } catch (_) {}
  });
  cleanups = [];
}
