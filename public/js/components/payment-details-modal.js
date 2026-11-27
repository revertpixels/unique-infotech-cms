// payment-details-modal.js — Shared read-only Payment Details modal helper for Payment History & Dashboard.

import { openPopup } from './modal.js?v=1.8.190';
import { showToast } from './toast.js?v=1.8.190';
import {
  buildPaymentDetailsModel,
  getCachedBillForEntry,
  getCachedStudentPhoto
} from '../services/report.service.js?v=1.8.190';
import { formatPersonName } from '../utils/formatter.js?v=1.8.190';

function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

async function copyTextWithFallback(text) {
  const val = String(text || '');
  if (!val) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(val);
      return true;
    } catch (_) { /* fall through */ }
  }
  const ta = document.createElement('textarea');
  ta.value = val;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (_) {
    ok = false;
  }
  ta.remove();
  return ok;
}

function buildDetailCard(title, iconName, fields) {
  const card = mk('div', 'adm-view-card');
  const head = mk('div', 'adm-view-card-head');
  const ic = document.createElement('i');
  ic.setAttribute('data-lucide', iconName);
  head.append(ic, mk('span', 'adm-view-card-title', title));
  const body = mk('div', 'adm-view-card-body');
  const tbl = mk('table', 'adm-view-table');
  const tbody = mk('tbody');

  fields.forEach((f) => {
    const tr = mk('tr');
    const tdL = mk('td', 'adm-view-label', f.label);
    const valCls = 'adm-view-value' + (f.mono ? ' fr-mono' : '') + (f.highlight ? ' fr-val-strong' : '');
    const tdV = mk('td', valCls);
    if (Array.isArray(f.items) && f.items.length) {
      const list = mk('div', 'fr-det-breakdown');
      f.items.forEach((item) => {
        const itemRow = mk('div', 'fr-det-breakdown-item');
        itemRow.append(
          mk('span', 'fr-det-breakdown-name', item.label),
          mk('span', 'fr-det-breakdown-amt', item.value)
        );
        list.appendChild(itemRow);
      });
      tdV.appendChild(list);
    } else {
      tdV.textContent = f.value;
    }
    tr.append(tdL, tdV);
    tbody.appendChild(tr);
  });

  tbl.appendChild(tbody);
  body.appendChild(tbl);
  card.append(head, body);
  return card;
}

function defaultOpenReceipt(entry) {
  if (!entry) return;
  if (entry.receiptRoute) {
    const [baseRoute] = String(entry.receiptRoute).split('?');
    location.hash = baseRoute || entry.receiptRoute;
    return;
  }
  if (entry.studentDocId) {
    location.hash = `#/students/${encodeURIComponent(entry.studentDocId)}?tab=payments`;
  }
}

export async function openPaymentDetailsModal(entry, { sessions = [], onOpenReceipt } = {}) {
  if (!entry) return;
  const sessionsById = {};
  (sessions || []).forEach((s) => {
    if (s && s.id) sessionsById[s.id] = s;
  });

  let bill = null;
  if (entry.billId) {
    try {
      bill = await getCachedBillForEntry(entry.billId);
    } catch (_) {
      bill = null;
    }
  }

  const model = buildPaymentDetailsModel(entry, { sessionsById, bill });
  const tone = model.status.cls === 'paid' ? 'success' : 'amber';
  const popup = openPopup({
    title: 'Payment Details',
    subtitle: model.receiptId,
    icon: 'receipt',
    tone,
    wide: true
  });

  const popupPhoto = getCachedStudentPhoto(entry.studentDocId);
  const headTile = popup.head.querySelector('.adm-view-tile');
  if (headTile && popupPhoto) {
    headTile.style.padding = '0';
    headTile.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.src = popupPhoto;
    img.alt = formatPersonName(entry.studentName || '') || entry.studentName || 'Student';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;';
    headTile.textContent = '';
    headTile.appendChild(img);
  }

  const titleEl = popup.head.querySelector('.adm-view-title');
  if (titleEl) {
    const row = mk('span', 'fr-det-head-row');
    row.append(
      mk('span', '', 'Payment Details'),
      mk('span', `pill ${model.status.cls}`, model.status.label)
    );
    titleEl.textContent = '';
    titleEl.appendChild(row);
  }

  const openReceiptFn = typeof onOpenReceipt === 'function' ? onOpenReceipt : defaultOpenReceipt;
  const receiptBtn = mk('button', 'ui-btn ghost adm-view-close');
  receiptBtn.type = 'button';
  receiptBtn.title = 'Open receipt';
  receiptBtn.setAttribute('aria-label', 'Open receipt');
  receiptBtn.innerHTML = '<i data-lucide="receipt" width="18" height="18"></i>';
  receiptBtn.addEventListener('click', () => {
    popup.close(true);
    openReceiptFn(entry);
  });

  const copyBtn = mk('button', 'ui-btn ghost adm-view-close fr-copy-btn');
  copyBtn.type = 'button';
  copyBtn.title = 'Copy details';
  copyBtn.setAttribute('aria-label', 'Copy details');
  copyBtn.innerHTML = '<i data-lucide="copy" width="18" height="18"></i>';
  copyBtn.addEventListener('click', async () => {
    const ok = await copyTextWithFallback(model.copyText);
    if (ok) {
      copyBtn.classList.add('is-copied');
      copyBtn.innerHTML = '<i data-lucide="check" width="18" height="18"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      showToast({ type: 'success', message: 'Payment summary copied to clipboard.' });
      setTimeout(() => {
        copyBtn.classList.remove('is-copied');
        copyBtn.innerHTML = '<i data-lucide="copy" width="18" height="18"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }, 1500);
    } else {
      showToast({ type: 'warning', message: 'Could not copy automatically on this browser.' });
    }
  });

  const closeIconBtn = popup.actions.querySelector('.adm-view-close');
  popup.actions.insertBefore(receiptBtn, closeIconBtn);
  popup.actions.insertBefore(copyBtn, closeIconBtn);

  const stack = mk('div', 'fr-det-stack');
  const grid = mk('div', 'fr-det-grid');
  if (model.studentFields.length) grid.appendChild(buildDetailCard('STUDENT', 'user', model.studentFields));
  const combinedPaymentFields = [...model.paymentFields, ...model.transactionFields];
  if (combinedPaymentFields.length) grid.appendChild(buildDetailCard('PAYMENT', 'indian-rupee', combinedPaymentFields));

  const remarksCard = mk('div', 'adm-view-card fr-det-card-full');
  const remHead = mk('div', 'adm-view-card-head');
  const remIc = document.createElement('i');
  remIc.setAttribute('data-lucide', 'message-square-text');
  remHead.append(remIc, mk('span', 'adm-view-card-title', 'REMARKS'));
  const remBody = mk('div', 'adm-view-card-body');
  const remP = mk('p', 'fr-det-remarks' + (model.remarksText === 'No remarks' ? ' is-empty' : ''), model.remarksText);
  remBody.appendChild(remP);
  remarksCard.append(remHead, remBody);
  grid.appendChild(remarksCard);

  stack.appendChild(grid);
  popup.container.appendChild(stack);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  return popup;
}
