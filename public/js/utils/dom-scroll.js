// dom-scroll.js — Shared sticky-topbar-aware smooth scroll and focus helpers.

let pendingRafA = 0;
let pendingRafB = 0;
let skipNextRouteResetScroll = false;

/**
 * Prevents the router's post-mount scroll reset from undoing an explicit scroll
 * requested during page mount (e.g. #/students?new=1 or #/school-fees?student=...).
 */
export function markRouteScrollHandled() {
  skipNextRouteResetScroll = true;
}

/**
 * Returns true once if a mounted page already scrolled the viewport intentionally.
 */
export function consumeRouteScrollHandled() {
  const skipped = skipNextRouteResetScroll;
  skipNextRouteResetScroll = false;
  return skipped;
}

/**
 * Cancels any pending two-frame smooth scroll scheduled by scrollElementBelowTopbar.
 */
export function cancelPendingScroll() {
  if (pendingRafA) cancelAnimationFrame(pendingRafA);
  if (pendingRafB) cancelAnimationFrame(pendingRafB);
  pendingRafA = 0;
  pendingRafB = 0;
}

/**
 * Computes the sticky topbar offset so target sections never land hidden underneath it.
 */
export function getTopbarScrollOffset(extraGap = 16) {
  if (typeof document === 'undefined') return extraGap;
  const topbar = document.querySelector('.topbar');
  const height = topbar ? Math.ceil(topbar.getBoundingClientRect().height) : 64;
  return Math.max(0, height) + extraGap;
}

/**
 * Focuses the first input field without letting browser native focus jump past the topbar.
 */
export function focusFirstFormField(el) {
  if (!el || typeof el.focus !== 'function' || el.disabled) return;
  try {
    el.focus({ preventScroll: true });
  } catch (_) {
    try { el.focus(); } catch (__) {}
  }
}

/**
 * Smoothly scrolls window so `el`'s top sits cleanly below the sticky topbar
 * on both desktop and mobile viewports.
 */
export function scrollElementBelowTopbar(el, { extraGap = 16, behavior = 'smooth', onComplete } = {}) {
  if (!el || typeof window === 'undefined') return;
  cancelPendingScroll();
  pendingRafA = requestAnimationFrame(() => {
    pendingRafA = 0;
    pendingRafB = requestAnimationFrame(() => {
      pendingRafB = 0;
      if (!el.isConnected) return;
      const offset = getTopbarScrollOffset(extraGap);
      const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      const rect = el.getBoundingClientRect();
      const targetY = Math.max(0, Math.round(scrollY + rect.top - offset));
      window.scrollTo({ top: targetY, behavior });
      if (typeof onComplete === 'function') onComplete(targetY);
    });
  });
}
