let stack = null;
const ICONS = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };
const TITLES = { success: 'Success', error: 'Something went wrong', warning: 'Warning', info: 'Notice' };

export function showToast(opts) {
  const o = (typeof opts === 'string') ? { message: opts } : (opts || {});
  const type = ICONS[o.type] ? o.type : 'success';
  const duration = (typeof o.duration === 'number') ? o.duration : 4000;

  if (!stack || !document.body.contains(stack)) {
    stack = document.createElement('div');
    stack.className = 'ui-toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }

  const t = document.createElement('div');
  t.className = 'ui-toast ' + type;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const ic = document.createElement('span');
  ic.className = 'ui-toast-icon';
  const i = document.createElement('i');
  i.setAttribute('data-lucide', ICONS[type]);
  ic.appendChild(i);

  const body = document.createElement('div');
  body.className = 'ui-toast-body';
  const b = document.createElement('b');
  b.textContent = o.title || '';
  if (!o.title) b.hidden = true;
  body.appendChild(b);
  if (o.message) {
    const s = document.createElement('span');
    s.textContent = o.message;
    body.appendChild(s);
  }

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'ui-toast-x';
  x.setAttribute('aria-label', 'Dismiss');
  const xi = document.createElement('i');
  xi.setAttribute('data-lucide', 'x');
  x.appendChild(xi);

  const bar = document.createElement('div');
  bar.className = 'ui-toast-bar';
  bar.style.animationDuration = duration + 'ms';

  t.append(ic, body, x);
  stack.appendChild(t);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  if (typeof lucide !== 'undefined') lucide.createIcons();

  let timer = null;
  let remaining = duration;
  let startedAt = 0;
  function dismiss() {
    if (t.classList.contains('leaving')) return;
    clearTimeout(timer);
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 200);
  }
  function start() {
    startedAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(dismiss, remaining);
    t.classList.remove('paused');
  }
  function pause() {
    clearTimeout(timer);
    remaining -= Date.now() - startedAt;
    t.classList.add('paused');
  }
  t.addEventListener('mouseenter', pause);
  t.addEventListener('mouseleave', start);
  x.addEventListener('click', dismiss);
  start();
  return dismiss;
}
