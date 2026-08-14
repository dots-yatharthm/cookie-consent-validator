// Low-level DOM helpers shared by adapters, verifiers and detector.
// Lesson from analysis: `offsetParent === null` is broken for position:fixed banners,
// so visibility is always computed from display/visibility/opacity + rect.

import { OVERLAY_SELECTORS, SHADOW_HOST_SELECTORS } from './constants.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True if `selector` currently paints on the viewport. Never uses offsetParent. */
export async function elShown(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const shown = (st) =>
      st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (shown(st) && r.width > 0 && r.height > 0) return true;
    // Shadow-DOM host: its own rect is often 0-sized but the banner paints inside the
    // shadow tree (e.g. Usercentrics aside#usercentrics-cmp-ui). Look inside.
    if (el.shadowRoot) {
      for (const c of el.shadowRoot.querySelectorAll('*')) {
        const cs = getComputedStyle(c);
        const cr = c.getBoundingClientRect();
        if (shown(cs) && cr.width > 40 && cr.height > 40) return true;
      }
    }
    return false;
  }, selector);
}

/**
 * Click the first consent-container element whose text matches `re`.
 * Containers are the known overlay roots + shadow-DOM hosts — text fallback is NEVER
 * page-wide. A container with a shadowRoot is scanned inside that tree too, so buttons
 * rendered in shadow DOM (Usercentrics) are found even though the host is 0-sized.
 * Returns the matched label, or null.
 */
export async function clickScoped(page, re) {
  return page.evaluate(({ reSrc, sel, shadowSel }) => {
    const re = new RegExp(reSrc, 'i');
    const containers = [...document.querySelectorAll([...sel, ...shadowSel].join(','))].filter((el) => {
      if (el.shadowRoot) return true; // host itself may be 0-sized; scan its shadow tree
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
    const cands = [];
    const scan = (root) => {
      for (const el of root.querySelectorAll('button, [role="button"], a')) {
        const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '')
          .replace(/\s+/g, ' ').trim();
        if (!t || !re.test(t)) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        const kind = el.tagName === 'BUTTON' ? 2 : (el.getAttribute('role') === 'button' ? 1.5 : 1);
        cands.push({ el, t: t.slice(0, 60), kind });
      }
    };
    for (const root of containers) {
      scan(root);
      if (root.shadowRoot) scan(root.shadowRoot);
    }
    if (!cands.length) return null;
    // Real buttons outrank footer links: a "Cookie Policy" <a> must never win over the
    // "Accept All Cookies" <button>. Within a kind, prefer the shortest (most exact) label.
    cands.sort((a, b) => (b.kind - a.kind) || (a.t.length - b.t.length));
    const c = cands[0];
    try { c.el.scrollIntoView({ block: 'center' }); c.el.click(); } catch (e) { return null; }
    return c.t;
  }, { reSrc: re.source, sel: OVERLAY_SELECTORS, shadowSel: SHADOW_HOST_SELECTORS });
}

/** Read all cookies for the context, reduced to {name, domain, value}. */
export async function readCookies(ctx) {
  return (await ctx.cookies()).map((c) => ({ name: c.name, domain: c.domain, value: c.value }));
}

/** Read localStorage as a plain object. */
export async function readLocalStorage(page) {
  return page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  });
}
