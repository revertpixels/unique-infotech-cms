// Fee calculation helpers shared between Courses and Admissions pages.
export const INST_PER_SEM = 4;

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

export function feeTotal(fees) {
  const f = fees || {};
  return num(f.admission) + num(f.installment) * INST_PER_SEM + num(f.exam) + num(f.material);
}
