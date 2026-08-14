// DOM-state verification (Oracle B). Complements the storage oracle: a choice "passes" only when
// the visible consent UI reflects it (banner gone, PC closed, page usable).

import { findOverlay } from '../detect/overlay.js';

/** Banner no longer paints on the page. */
export async function bannerGone(page, adapter) {
  return !(await adapter.isBannerVisible(page));
}

/** Preference center is closed. */
export async function pcClosed(page, adapter) {
  return !(await adapter.isPcOpen(page));
}

/**
 * TC-012 page-usability check. Scroll-lock is judged against a pre-consent baseline: a CMP is
 * only at fault if the page scrolled before consent and is locked after. Some sites (adient,
 * jncb) are non-scrollable by their own design — never a false failure. Also verifies no zombie
 * overlay and that a real link is reachable.
 */
export async function pageUsable(page, { scrollableBefore } = {}) {
  return page.evaluate(({ scrollableBefore }) => {
    const failures = [];

    // 1. Scroll: only a regression (was scrollable, now locked) is a failure.
    const se = document.scrollingElement || document.documentElement;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const canScroll = maxScroll > 0;
    const beforeY = se.scrollTop;
    se.scrollTop = 300;
    const scrollable = se.scrollTop !== beforeY && se.scrollTop > 0;
    se.scrollTop = 0;
    const locked = canScroll && scrollableBefore === true && !scrollable;
    if (locked) failures.push('page-locked-after-consent');

    // 2. No zombie consent overlay at a content position (60% down, clear of sticky headers).
    const x = Math.floor(window.innerWidth / 2);
    const y = Math.floor(window.innerHeight * 0.6);
    const el = document.elementFromPoint(x, y);
    let zombie = false;
    if (el && el !== document.body && el !== document.documentElement) {
      const sig = `${el.id} ${el.className} ${el.tagName}`.toLowerCase();
      zombie = /onetrust|cookiebanner|cookie-banner|consent|Cybot/.test(sig);
      if (zombie) failures.push(`zombie-overlay:${el.tagName}#${el.id || ''}.${String(el.className || '').slice(0, 40)}`);
    }

    // 3. At least one real link is reachable (pointer lands on it, not an overlay).
    let linkReachable = false;
    let linkInfo = '';
    for (const a of document.querySelectorAll('a[href]')) {
      const r = a.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (top && (top === a || a.contains(top))) { linkReachable = true; linkInfo = (a.textContent || a.href || '').replace(/\s+/g, ' ').trim().slice(0, 40); break; }
    }
    if (!linkReachable) failures.push('no-primary-link-reachable');

    return { ok: failures.length === 0, failures, scrollable, locked, zombie, linkReachable, linkInfo };
  }, { scrollableBefore: scrollableBefore === true });
}

/** Generic overlay still present (used by the generic adapter / UI checks). */
export async function anyOverlayVisible(page) {
  return (await findOverlay(page)).length > 0;
}
