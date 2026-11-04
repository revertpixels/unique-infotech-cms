function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function confirmDialog(opts) {
  const o = Object.assign({
    title: 'Are you sure?', message: '', confirmText: 'Confirm', cancelText: 'Cancel',
    danger: false, icon: '', requireText: '', infoOnly: false
  }, opts || {});
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const back = mk('div', 'ui-modal-back');
    const box = mk('div', 'ui-modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'ui-modal-title');
    const ic = mk('div', 'ui-modal-icon' + (o.danger ? ' danger' : ''));
    const i = document.createElement('i');
    i.setAttribute('data-lucide', o.icon || (o.danger ? 'alert-triangle' : 'info'));
    ic.appendChild(i);
    const h = mk('h3', '', o.title);
    h.id = 'ui-modal-title';
    box.append(ic, h, mk('p', '', o.message));

    let input = null;
    if (o.requireText) {
      const wrap = mk('div', 'ui-modal-confirm');
      const lab = mk('label', '');
      lab.htmlFor = 'ui-modal-input';
      lab.append('Type ', mk('b', '', o.requireText), ' to confirm');
      const iw = mk('div', 'ui-input-wrap');
      input = mk('input', 'ui-input');
      input.id = 'ui-modal-input';
      input.autocomplete = 'off';
      iw.appendChild(input);
      wrap.append(lab, iw);
      box.appendChild(wrap);
    }

    const actions = mk('div', 'ui-modal-actions');
    let cancel = null;
    if (!o.infoOnly) {
      cancel = mk('button', 'ui-btn ghost', o.cancelText);
      cancel.type = 'button';
      cancel.addEventListener('click', () => close(false));
      actions.appendChild(cancel);
    }
    const ok = mk('button', 'ui-btn ' + (o.danger ? 'danger' : 'primary'), o.confirmText);
    ok.type = 'button';
    if (input) {
      ok.disabled = true;
      input.addEventListener('input', () => { ok.disabled = input.value.trim() !== o.requireText; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ok.disabled) close(true); });
    }
    ok.addEventListener('click', () => close(o.infoOnly ? false : true));
    actions.appendChild(ok);
    box.appendChild(actions);
    back.appendChild(box);

    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(false); } }
    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(result);
    }
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (input) input.focus();
    else if (o.danger && cancel) cancel.focus();
    else ok.focus();
  });
}
