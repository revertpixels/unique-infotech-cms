// Fee calculation helpers shared across Courses, Admissions, Receipts, and Student Profile.
export const INST_PER_SEM = 4;

export const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

/**
 * Course fee = admission fee + (installment * 4).
 * Strictly does NOT include study material fee or examination fee.
 * Example: 1000 + 500 * 4 = 3000 (material 100 separate).
 */
export function courseFeeOf(feesOrDoc) {
  if (!feesOrDoc) return 0;
  const f = feesOrDoc.fees || feesOrDoc.feeSnapshot || feesOrDoc;
  const adm = num(f.admission ?? feesOrDoc.admissionFee ?? feesOrDoc.dueAtAdmission?.admission);
  const inst = num(f.installment ?? feesOrDoc.installmentFee ?? f.installmentFee);
  return adm + (inst * INST_PER_SEM);
}

/**
 * Full payment discount calculator:
 * Returns { rs: number, pct: number, formatted: string }
 * Formula:
 * Course fee = admission + (installment * 4). Strictly excludes study material & exam.
 * Discount in Rs = course fee - full amount = e.g. 3000 - 2500 = 500.
 * Discount % = (course fee - full amount) / course fee = 500 / 3000 = 16.67% -> 17%.
 * Receipts and profile show "- Rs 500 (17%)". Never shows the percent as rupees.
 */
export function discountOf(feesOrDoc) {
  if (!feesOrDoc) return { rs: 0, pct: 0, formatted: '' };
  const courseFee = courseFeeOf(feesOrDoc);
  const f = feesOrDoc.fees || feesOrDoc.feeSnapshot || feesOrDoc;
  const fullAmt = num(f.fullPaymentAmount ?? feesOrDoc.fullPaymentAmount ?? feesOrDoc.dueAtAdmission?.full);
  if (fullAmt <= 0 || courseFee <= 0 || fullAmt >= courseFee) {
    return { rs: 0, pct: 0, formatted: '' };
  }

  const rs = courseFee - fullAmt;
  const pct = Math.round((rs / courseFee) * 100);

  return {
    rs,
    pct,
    formatted: `- Rs ${rs.toLocaleString('en-IN')} (${pct}%)`
  };
}

export function feeTotal(fees) {
  // Course fee (no material, no exam fee)
  return courseFeeOf(fees);
}
