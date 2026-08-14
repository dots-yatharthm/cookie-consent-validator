// Consent-overlay scan. Shared by vendor detection and UI verification.
// Filters BODY/HTML wrappers, invisible nodes, and empty backdrops; ranks known overlays first.

import { KNOWN_BANNER_IDS, OVERLAY_SELECTORS, SHADOW_HOST_SELECTORS } from '../constants.js';
import { sleep } from '../dom.js';

/**
 * Return the top overlay candidates on the page as plain serializable objects.
 * A node qualifies if it is visible, sized, non-empty, and not a full-page wrapper.
 * Two passes: the light DOM (OneTrust/Cookiebot/plain banners), then open shadow roots
 * (Usercentrics renders its banner inside aside#usercentrics-cmp-ui, whose host rect
 * is 0-sized — the real content only exists inside the shadow tree).
 */
export async function findOverlay(page) {
  return page.evaluate(({ sel, shadowSel, knownIds }) => {
    // True for elements that look like the banner box (not its backdrop / wrapper).
    const isDialogLike = (el) => {
      const key = `${el.id || ''} ${el.className || ''} ${el.tagName || ''}`;
      return /dialog|modal|\.cmp|cmp-|privacy-|notice|consent|banner/i.test(key) &&
        !/overlay|backdrop|dimmer|scrim/i.test(key);
    };
    const vw = window.innerHeight;
    const hits = [];
    const seen = new Set();
    // Pass 1 — light DOM (as before).
    for (const s of sel) {
      let nodes; try { nodes = document.querySelectorAll(s); } catch (e) { continue; }
      for (const el of nodes) {
        if (el.tagName === 'BODY' || el.tagName === 'HTML') continue;
        if (seen.has(el)) continue; seen.add(el);
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) continue;
        if (r.height > vw * 1.15) continue; // full-page wrappers
        const known = el.id && knownIds.includes(el.id);
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (!known && !text) continue; // empty backdrop
        hits.push({
          selector: s, id: el.id,
          cls: (el.className && String(el.className).slice(0, 120)) || '',
          tag: el.tagName, pos: st.position, z: st.zIndex,
          w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
          known, dialog: isDialogLike(el), shadow: false, text: text.slice(0, 400),
        });
      }
    }
    // Pass 2 — open shadow roots. The host's own rect is often 0-sized, so measure the
    // visible banner box inside the shadow tree instead.
    for (const s of shadowSel) {
      let hosts; try { hosts = document.querySelectorAll(s); } catch (e) { continue; }
      for (const host of hosts) {
        if (!host.shadowRoot) continue;
        if (seen.has(host)) continue; seen.add(host);
        for (const el of host.shadowRoot.querySelectorAll('*')) {
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 40) continue;
          if (r.height > vw * 1.15) continue; // full-screen backdrop
          const dialog = isDialogLike(el);
          const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
          if (!dialog && !text) continue; // empty backdrop / icon-only node
          hits.push({
            selector: `shadow:${host.id || host.tagName}`,
            id: el.id,
            cls: (el.className && String(el.className).slice(0, 120)) || '',
            tag: el.tagName, pos: st.position, z: st.zIndex,
            w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
            known: true, dialog, shadow: true,
            host: host.id || host.tagName,
            text: text.slice(0, 400),
          });
        }
      }
    }
    hits.sort((a, b) =>
      (b.dialog - a.dialog) || (b.known - a.known) || ((parseInt(b.z) || 0) - (parseInt(a.z) || 0)));
    return hits.slice(0, 3);
  }, { sel: OVERLAY_SELECTORS, shadowSel: SHADOW_HOST_SELECTORS, knownIds: KNOWN_BANNER_IDS });
}

/** Poll for an overlay up to `timeoutMs`. */
export async function waitForOverlay(page, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hits = await findOverlay(page);
    if (hits.length) return hits;
    await sleep(500);
  }
  return [];
}
