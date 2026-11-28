// school-fee-payment.page.js � Record a monthly fee payment for a specific bill.
// Super Admin only. Shows bill details and accepts payment amount.
import { db } from '../config/firebase-config.js';
import { doc, getDoc, updateDoc, serverTimestamp, runTransaction } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.196';
import { formatINR, formatDateIN } from '../utils/formatter.js?v=1.8.196';
import { computeLateFee, recordPayment } from '../utils/school-billing.js?v=1.8.196';
import { localToday } from '../utils/school-lifecycle.js?v=1.8.196';
import { playPaymentSuccessSound } from '../utils/sound.js?v=1.8.196';
import { resolveUserDisplay, getRoleTitle } from '../services/user-directory.service.js?v=1.8.196';

const BILLS_COL = 'bills';
const PAYMENTS_COL = 'payments';

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-fee-payment] missing #' + id); return el; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

export async function mount({ container, profile, ctx, billId }) {
  const school = ctx === 'school';
  if (!school) {
    showToast({ type: 'error', message: 'Fee payment is only available in Unique Kids.' });
    return;
  }
  const isSuper = profile && profile.role === 'superadmin';
  if (!isSuper) {
    showToast({ type: 'error', message: `Fee payment is restricted to ${getRoleTitle('superadmin')}.` });
    return;
  }

  const form = $('sf-pay-form');
  const cancelBtn = $('sk-pay-cancel');
  const saveBtn = $('sk-pay-save');
  if (!form || !cancelBtn || !saveBtn) return;

  let bill;

  async function load() {
    try {
      const snap = await getDoc(doc(db, BILLS_COL, billId));
      if (!snap.exists()) {
        showToast({ type: 'error', message: 'Bill not found.' });
        return;
      }
      bill = Object.assign({ id: snap.id }, snap.data());
      const student = await getDoc(doc(db, 'students', bill.studentId));
      const sData = student.exists() ? student.data() : {};

      $('sk-pay-student-id').textContent = sData.studentId || '-';
      $('sk-pay-student-name').textContent = sData.name || '-';
      $('sk-pay-month').textContent = bill.month || '-';
      $('sk-pay-monthly-fee').textContent = formatINR(bill.monthlyFee || 0);
      const late = computeLateFee(bill);
      $('sk-pay-late-fee').textContent = formatINR(late);
      $('sk-pay-total-due').textContent = formatINR(rupees(bill.monthlyFee) + late);
      const remaining = rupees(bill.monthlyFee) + late - rupees(bill.paidAmount || 0);
      $('sk-pay-amount').value = formatINR(remaining);
      $('sk-pay-amount').max = remaining;
    } catch (e) {
      console.error('[school-fee-payment] load failed', e);
      showToast({ type: 'error', message: 'Could not load bill (' + (e.code || 'error') + ').' });
    }
  }

  function rupees(n) { return Math.round(Number(n || 0) * 100) / 100; }

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const amountStr = $('sk-pay-amount').value.trim();
    const amount = Number(amountStr.replace(/[?,]/g, ''));
    if (!amount || amount <= 0) { showToast({ type: 'error', message: 'Enter a valid payment amount.' }); return; }
    const late = computeLateFee(bill);
    const totalDue = rupees(bill.monthlyFee) + late - rupees(bill.paidAmount || 0);
    if (amount > totalDue) { showToast({ type: 'error', message: 'Amount exceeds outstanding balance.' }); return; }

    saveBtn.disabled = true;
    try {
      const who = (profile && profile.email) || '';
      const disp = resolveUserDisplay(who, profile?.name, profile?.designation);
      const today = localToday();
      const result = await recordPayment(db, {
        studentId: bill.studentId,
        amount,
        receivedDate: today,
        receivedBy: who,
        receivedByName: disp.name || profile?.name || '',
        receivedByDesignation: disp.designation || profile?.designation || '',
        allocation: 'auto'
      });
      await load(); // refresh bill status
      playPaymentSuccessSound();
      showToast({ type: 'success', message: 'Payment of ' + formatINR(amount) + ' recorded.' });
      location.hash = '#/school-fees';
    } catch (e) {
      console.error('[school-fee-payment] payment failed', e);
      showToast({ type: 'error', message: e.message || 'Payment failed.' });
    } finally {
      saveBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener('click', () => {
    location.hash = '#/school-fees';
  });

  try { await load(); } catch (e) {
    console.error('[school-fee-payment] init load', e);
  }
}

