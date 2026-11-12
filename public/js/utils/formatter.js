// Currency / date formatting helpers for admissions

export function formatINR(n) {
  if (n == null || n === '') return '₹0';
  return '₹' + Number(n).toLocaleString('en-IN');
}

export function formatDateIN(iso) {
  if (!iso) return '';
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return iso;
  const d = new Date(p[0], p[1] - 1, p[2]);
  if (d.getFullYear() !== p[0] || d.getMonth() !== p[1] - 1 || d.getDate() !== p[2]) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateShort(iso) {
  if (!iso) return '';
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return iso;
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function initials(s) {
  if (!s) return '';
  const parts = String(s).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}
