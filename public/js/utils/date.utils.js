// Youth session (half-year) and School period (calendar month) are an interim assumption (Decision 20, Known Issue ISS-006).

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

export function formatDayMonth(date) {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function getRunningPeriod(ctx, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = new Date(y, m, now.getDate());
  let start, end, name, kindLabel;
  if (ctx === 'youth') {
    if (m <= 5) { start = new Date(y, 0, 1); end = new Date(y, 5, 30); name = `Jan–Jun ${y}`; }
    else { start = new Date(y, 6, 1); end = new Date(y, 11, 31); name = `Jul–Dec ${y}`; }
    kindLabel = 'Running session';
  } else {
    start = new Date(y, m, 1);
    end = new Date(y, m + 1, 0);
    name = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    kindLabel = 'Current month';
  }
  const totalDays = daysBetween(start, end) + 1;
  const daysFromStartToToday = daysBetween(start, today);
  let percent = Math.round((daysFromStartToToday + 1) / totalDays * 100);
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  const daysLeft = Math.max(0, daysBetween(today, end));
  return { ctx, kindLabel, name, start, end, percent, daysLeft };
}

export function getNextDueDate(now = new Date(), dueDay = 10) {
  const d = Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 28 ? dueDay : 10;
  const y = now.getFullYear();
  const m = now.getMonth();
  if (now.getDate() <= d) return new Date(y, m, d);
  return new Date(y, m + 1, d);
}

export function getPeriodOptions(ctx, now = new Date()) {
  const isYouth = ctx === 'youth';
  const count = isYouth ? 3 : 4;
  const opts = [];
  let cursor = now;
  for (let i = 0; i < count; i++) {
    const rp = getRunningPeriod(ctx, cursor);
    opts.push({ label: rp.name, start: rp.start, end: rp.end, isCurrent: i === 0 });
    // move cursor to a date in the previous period
    if (isYouth) {
      const m = cursor.getMonth();
      const y = cursor.getFullYear();
      if (m <= 5) cursor = new Date(y - 1, 8, 15); // previous Jul-Dec
      else cursor = new Date(y, 2, 15); // previous Jan-Jun
    } else {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, cursor.getDate());
    }
  }
  return opts;
}
