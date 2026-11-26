// Shared session admission rules (Youth Centre: Jan-Jun / Jul-Dec sessions).

export function getOrgTimezone() {
  const tz = typeof window !== 'undefined' && window.APP_CACHE && window.APP_CACHE.org && window.APP_CACHE.org.timezone;
  return (typeof tz === 'string' && tz.trim()) ? tz.trim() : 'Asia/Kolkata';
}

// Always resolves YYYY-MM-DD in the organisation timezone (India / Asia/Kolkata by default),
// never browser UTC or OS timezone.
export function todayISO(nowDate) {
  const d = nowDate instanceof Date ? nowDate : new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: getOrgTimezone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    if (map.year && map.month && map.day) {
      return `${map.year}-${map.month}-${map.day}`;
    }
  } catch (_) {}
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function toDate(s) {
  if (!s) return null;
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

// Returns YYYY-MM-01 of the month n months after isoDate (local, no UTC).
export function addMonths(isoDate, n) {
  if (!isoDate) return null;
  const p = String(isoDate).split('-').map(Number);
  const y = p[0];
  const m = p[1];
  let total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return ny + '-' + String(nm).padStart(2, '0') + '-01';
}

// Installment schedule for a youth session.
// Months: start month +2, +3, +4, +5. Each: opens 1st, due 10th.
// Returns [{ no, month, opens, due }] for no 1..4.
export function installmentSchedule(session) {
  if (!session || !session.startDate) return [];
  const p = String(session.startDate).split('-').map(Number);
  const y = p[0];
  let m = p[1];
  const out = [];
  for (let i = 0; i < 4; i++) {
    let mo = m + 2 + i;
    let oy = y;
    if (mo > 12) {
      oy += Math.floor((mo - 1) / 12);
      mo = ((mo - 1) % 12) + 1;
    }
    const monthStr = oy + '-' + String(mo).padStart(2, '0');
    out.push({ no: i + 1, month: monthStr, opens: monthStr + '-01', due: monthStr + '-10' });
  }
  return out;
}

// First installment due date = installmentSchedule[0].due (computed truth).
export function firstInstallmentOf(session) {
  const sched = installmentSchedule(session);
  return sched.length ? sched[0].due : null;
}

// Exam fee window: from day after 4th installment due, to session end date.
export function examWindowOf(session) {
  const sched = installmentSchedule(session);
  if (!sched.length) return { from: null, to: session ? session.endDate : null };
  const fourthDue = sched[3].due;
  const p = String(fourthDue).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2] + 1);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const from = y + '-' + String(mo).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  return { from: from, to: session ? session.endDate : null };
}

// Late fine: Rs 1 per day for every day after the due date until paid.
// day 11 = Rs 1, day 12 = Rs 2, ... on/before due = Rs 0.
// Uses Date.UTC calendar arithmetic to prevent any DST / timezone shift.
export function fineFor(dueISO, paidOrTodayISO) {
  if (!dueISO || !paidOrTodayISO) return 0;
  const dp = String(dueISO).slice(0, 10).split('-').map(Number);
  const pp = String(paidOrTodayISO).slice(0, 10).split('-').map(Number);
  if (dp.length !== 3 || pp.length !== 3 || dp.some(n => !Number.isFinite(n)) || pp.some(n => !Number.isFinite(n))) {
    return 0;
  }
  const dueUtc = Date.UTC(dp[0], dp[1] - 1, dp[2]);
  const paidUtc = Date.UTC(pp[0], pp[1] - 1, pp[2]);
  const days = Math.round((paidUtc - dueUtc) / 86400000);
  return days > 0 ? days : 0;
}

// Valid youth session pattern: Jan 1 -> Jun 30, or Jul 1 -> Dec 31, same year.
export function sessionPattern(startISO, endISO) {
  if (!startISO || !endISO) return false;
  const p = String(startISO).split('-').map(Number);
  const e = String(endISO).split('-').map(Number);
  if (p[0] !== e[0]) return false;
  if (p[1] === 1 && p[2] === 1 && e[1] === 6 && e[2] === 30) return true;
  if (p[1] === 7 && p[2] === 1 && e[1] === 12 && e[2] === 31) return true;
  return false;
}

export function fmtDate(s) {
  const d = toDate(s);
  if (!d) return ' - ';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Course activity: a course is selectable only when status is active (default), active flag not false, and not archived.
export function isCourseActive(c) {
  return !!c && (c.status || 'active') === 'active' && c.active !== false && !c.archived;
}

// Batch course helpers (multi-course batches).
// Batch stores: allCourses (bool), courseIds (string[]).
// Select all ON -> allCourses: true, courseIds: [] (covers future active courses only).
// Otherwise -> allCourses: false, courseIds: [selected ids].
export function batchAllowsCourse(batch, courseId, courses) {
  if (!batch || !courseId) return false;
  const course = courses && courses.find ? courses.find((x) => x.id === courseId) : null;
  if (batch.allCourses) return course ? isCourseActive(course) : true;
  if (batch.courseIds && batch.courseIds.length) return batch.courseIds.includes(courseId);
  // legacy fallback
  return batch.courseId === courseId;
}

export function getBatchCourseIds(batch) {
  if (!batch) return [];
  if (batch.allCourses) return null; // null means "all"
  return batch.courseIds && batch.courseIds.length ? batch.courseIds.slice() : (batch.courseId ? [batch.courseId] : []);
}

export function batchCourseLabel(batch, courses) {
  if (!batch) return ' - ';
  if (batch.allCourses) return 'All courses';
  const ids = batch.courseIds && batch.courseIds.length ? batch.courseIds : (batch.courseId ? [batch.courseId] : []);
  if (ids.length === 0) return ' - ';
  const labels = ids.map((id) => { const c = courses.find((x) => x.id === id); return c ? (c.name || c.courseCode || c.code || id) : id; });
  if (labels.length === 1) return labels[0];
  if (labels.length <= 3) return labels.join(', ');
  return labels.slice(0, 3).join(', ') + ' +' + (labels.length - 3);
}

export function batchCourseTooltip(batch, courses) {
  if (!batch || batch.allCourses) return null;
  const ids = batch.courseIds && batch.courseIds.length ? batch.courseIds : (batch.courseId ? [batch.courseId] : []);
  if (ids.length <= 3) return null;
  return ids.map((id) => { const c = courses.find((x) => x.id === id); return c ? (c.courseCode || c.code || c.id) + ' - ' + (c.name || c.id) : id; }).join('\n');
}

// Same outputs as 1.8.28 but firstInstallmentOf now returns the computed due date.
export function admissionState(s, todayStr) {
  const today = todayStr || todayISO();
  if (!s) return { open: false, reason: 'Session closed' };
  const st = s.status || 'upcoming';
  const firstInst = firstInstallmentOf(s);
  if (st === 'upcoming') return { open: true, reason: 'Open' };
  if (st === 'running') {
    if (!firstInst) return { open: true, reason: 'Open' };
    if (today <= firstInst) {
      return { open: true, reason: 'Open till ' + fmtDate(firstInst) };
    }
    return { open: false, reason: 'First installment date (' + fmtDate(firstInst) + ') has passed' };
  }
  return { open: false, reason: 'Session closed' };
}

export function sessionLabel(s) {
  if (!s) return '';
  const st = s.status || 'upcoming';
  const fi = firstInstallmentOf(s);
  const firstInstStr = fi ? fmtDate(fi) : ' - ';
  if (st === 'running' && fi && todayISO() > fi) {
    return s.name + ' · Closed for admission (1st installment due ' + firstInstStr + ' passed)';
  }
  if (st === 'running') {
    return s.name + ' · Running · admission open till ' + firstInstStr;
  }
  return s.name + ' · Upcoming';
}

// Self-test block. Run with __SESSION_RULES_TEST__ set.
(function selfTest() {
  const env = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  if (!env.__SESSION_RULES_TEST__) return;
  try {
    // Jan-Jun 2027 -> due dates 03-10, 04-10, 05-10, 06-10
    const sj = { startDate: '2027-01-01', endDate: '2027-06-30', status: 'upcoming' };
    const j = installmentSchedule(sj);
    if (j[0].due !== '2027-03-10') throw new Error('Jan-Jun due1 ' + j[0].due);
    if (j[1].due !== '2027-04-10') throw new Error('Jan-Jun due2 ' + j[1].due);
    if (j[2].due !== '2027-05-10') throw new Error('Jan-Jun due3 ' + j[2].due);
    if (j[3].due !== '2027-06-10') throw new Error('Jan-Jun due4 ' + j[3].due);
    // Jul-Dec 2027 -> 09-10 ... 12-10
    const s2 = { startDate: '2027-07-01', endDate: '2027-12-31', status: 'running' };
    const d2 = installmentSchedule(s2);
    if (d2[0].due !== '2027-09-10') throw new Error('Jul-Dec due1 ' + d2[0].due);
    if (d2[3].due !== '2027-12-10') throw new Error('Jul-Dec due4 ' + d2[3].due);
    if (firstInstallmentOf(sj) !== '2027-03-10') throw new Error('firstInstallmentOf mismatch');
    if (fineFor('2027-03-10', '2027-03-15') !== 5) throw new Error('fine 5 got ' + fineFor('2027-03-10', '2027-03-15'));
    if (fineFor('2027-03-10', '2027-03-10') !== 0) throw new Error('fine 0 got ' + fineFor('2027-03-10', '2027-03-10'));
    if (fineFor('2027-03-10', '2027-03-09') !== 0) throw new Error('fine before due got ' + fineFor('2027-03-10', '2027-03-09'));
    if (sessionPattern('2027-01-01', '2027-06-30') !== true) throw new Error('pattern Jan-Jun');
    if (sessionPattern('2027-07-01', '2027-12-31') !== true) throw new Error('pattern Jul-Dec');
    if (sessionPattern('2027-02-01', '2027-06-30') !== false) throw new Error('pattern false');
    if (sessionPattern('2027-01-01', '2027-12-31') !== false) throw new Error('pattern wrong year end');
    const ew = examWindowOf({ startDate: '2027-01-01', endDate: '2027-06-30' });
    if (ew.from !== '2027-06-11') throw new Error('exam from ' + ew.from);
    if (ew.to !== '2027-06-30') throw new Error('exam to ' + ew.to);
    console.log('[session-rules] self-test passed');
  } catch (e) {
    console.error('[session-rules] self-test FAILED:', e.message);
  }
})();
