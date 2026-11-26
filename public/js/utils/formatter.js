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

/**
 * Formats a person name or designation in clean Title Case (e.g. "UI TEMP ADMIN" -> "Ui Temp Admin"),
 * while leaving email strings readable and preserving intentional mixed-case segments.
 */
export function formatPersonName(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  if (raw.includes('@') && !raw.includes(' ')) return raw;
  const hasLower = /[a-z]/.test(raw);
  const hasUpper = /[A-Z]/.test(raw);
  const normalizeWord = (word) => {
    const wLower = /[a-z]/.test(word);
    const wUpper = /[A-Z]/.test(word);
    if ((wUpper && !wLower) || (!wUpper && wLower) || /^[a-z]/.test(word)) {
      return word.toLowerCase().replace(/(^|[-'./])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
    }
    return word;
  };
  if ((hasUpper && !hasLower) || (!hasUpper && hasLower)) {
    return raw.split(' ').map(normalizeWord).join(' ');
  }
  return raw.split(' ').map((word) => {
    if (word === word.toLowerCase() && /[a-z]/.test(word)) {
      return normalizeWord(word);
    }
    if (/^[a-z]/.test(word)) {
      return word[0].toUpperCase() + word.slice(1);
    }
    return word;
  }).join(' ');
}
