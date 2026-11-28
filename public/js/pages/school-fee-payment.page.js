// school-fee-payment.page.js — Record a monthly fee payment for a specific bill.
// Super Admin only. Shows bill details and opens the shared payment modal.
import { db } from '../config/firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.200';
import { formatINR } from '../utils/formatter.js?v=1.8.200';
import { computeLateFee, fetchOpenKidsBillsForStudent } from '../utils/school-billing.js?v=1.8.200';
import { openPaymentPopup } from '../components/payment-popup.js?v=1.8.200';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.200';

const BILLS_COL = 'bills';

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-fee-payment] missing #' + id); return el; }

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

  const form = $('sk-pay-form');
  const cancelBtn = $('sk-pay-cancel');
  const saveBtn = $('sk-pay-save');
  if (!form || !cancelBtn || !saveBtn) return;

  let bill = null;
  let studentObj = null;
  let openBills = [];

  function rupees(n) { return Math.round(Number(n || 0) * 100) / 100; }

  function openBillPaymentModal() {
    if (!bill || !studentObj) return;
    openPaymentPopup({
      student: studentObj,
      profile,
      preselectedBillId: bill.id,
      bills: openBills.length ? openBills : [bill],
      from: 'school-fees',
      onSuccess: () => {
        location.hash = '#/school-fees';
      }
    });
  }

  async function load() {
    try {
      const snap = await getDoc(doc(db, BILLS_COL, billId));
      if (!snap.exists()) {
        showToast({ type: 'error', message: 'Bill not found.' });
        return;
      }
      bill = Object.assign({ id: snap.id }, snap.data());
      const studentSnap = await getDoc(doc(db, 'students', bill.studentId));
      const sData = studentSnap.exists() ? studentSnap.data() : {};
      studentObj = {
        id: studentSnap.exists() ? studentSnap.id : bill.studentId,
        ...sData,
        studentId: sData.studentId || bill.studentCode || bill.studentId,
        name: sData.name || bill.studentName || 'Student',
        ctx: 'school'
      };
      openBills = await fetchOpenKidsBillsForStudent(studentObj).catch(() => [bill]);

      $('sk-pay-student-id').textContent = studentObj.studentId || '-';
      $('sk-pay-student-name').textContent = studentObj.name || '-';
      $('sk-pay-month').textContent = bill.month || '-';
      $('sk-pay-monthly-fee').textContent = formatINR(bill.monthlyFee || 0);
      const late = computeLateFee(bill);
      $('sk-pay-late-fee').textContent = formatINR(late);
      const totalDue = Math.max(0, rupees(bill.monthlyFee) + late - rupees(bill.paidAmount || 0) - rupees(bill.waivedAmount || 0));
      $('sk-pay-total-due').textContent = formatINR(totalDue);
      const amtInput = $('sk-pay-amount');
      if (amtInput) {
        amtInput.value = String(totalDue);
        amtInput.readOnly = true;
      }
      const st = String(bill.status || 'unpaid').toLowerCase();
      if (st === 'paid' || st === 'break-waived' || st === 'stopped') {
        saveBtn.disabled = true;
        showToast({ type: 'info', message: 'This monthly bill is already settled.' });
      }
    } catch (e) {
      console.error('[school-fee-payment] load failed', e);
      showToast({ type: 'error', message: 'Could not load bill (' + (e.code || 'error') + ').' });
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    openBillPaymentModal();
  });

  cancelBtn.addEventListener('click', () => {
    location.hash = '#/school-fees';
  });

  try { await load(); } catch (e) {
    console.error('[school-fee-payment] init load', e);
  }
}
