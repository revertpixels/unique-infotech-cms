// Admission validation helpers
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\d{10}$/;

export function validatePhone(v) {
  if (!v) return '';
  const digits = v.replace(/\D/g, '');
  if (!PHONE_RE.test(digits)) return 'Phone must be 10 digits.';
  return '';
}

export function validateEmail(v) {
  if (!v) return '';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address.';
  return '';
}

export function validateDOB(dob) {
  if (!dob) return 'Date of birth is required.';
  const p = String(dob).split('-').map(Number);
  if (!p.length === 3 || p.some((n) => !Number.isFinite(n))) return 'Enter a valid date (YYYY-MM-DD).';
  const d = new Date(p[0], p[1] - 1, p[2]);
  if (d.getFullYear() !== p[0] || d.getMonth() !== p[1] - 1 || d.getDate() !== p[2]) return 'Enter a valid date (YYYY-MM-DD).';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d > today) return 'Date of birth cannot be in the future.';
  const age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  const ageCompleted = m < 0 || (m === 0 && today.getDate() < d.getDate()) ? age - 1 : age;
  if (ageCompleted < 5) return 'Student must be at least 5 years old.';
  return '';
}

export function validateName(v) {
  if (!v || !v.trim()) return 'Name is required.';
  return '';
}

export function validateRequired(v, label) {
  if (!v || !String(v).trim()) return label + ' is required.';
  return '';
}

export function combineErrors(...errs) {
  return errs.filter(Boolean).join(' ');
}
