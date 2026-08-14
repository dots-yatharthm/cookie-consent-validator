// Usercentrics adapter. Usercentrics v4 renders its consent UI inside an OPEN shadow root
// (aside#usercentrics-cmp-ui) whose host element is 0-sized — all real content lives in the
// shadow tree. Older WebSDK builds used #usercentrics-root. Every action therefore queries
// the host's shadowRoot. Consent is persisted to localStorage keys ucData / ucString
// (per-service booleans), not to cookies.
//
// Host resolution gotcha: the page also carries <script id="usercentrics-cmp"> (and loader
// <link>) elements that match a broad [id*="usercentrics"] and appear EARLIER in document
// order than the UI host. querySelector returns document order, so the CMP host must be
// resolved by owning an open shadowRoot — never by the first selector match.

import { sleep, readCookies, readLocalStorage } from '../dom.js';
import { findOverlay } from '../detect/overlay.js';

const HOST = 'aside#usercentrics-cmp-ui, #usercentrics-cmp-ui, #usercentrics-root, [id*="usercentrics" i]:not(script):not(link)';

// Last-saved PC category states, keyed by page (adapter is shared across TCs, each TC has a
// fresh page). Lets readConsent report category-level `enabled` for the storage↔PC oracle.
const savedByPage = new WeakMap();

/** Click `selector` inside the CMP shadow root. Returns true on success. */
async function clickShadow(page, selector) {
  return page.evaluate(({ hostSel, sel }) => {
    let h = null;
    for (const el of document.querySelectorAll(hostSel)) {
      if (el.tagName !== 'SCRIPT' && el.shadowRoot) { h = el; break; }
    }
    if (!h) return false;
    const el = h.shadowRoot.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    el.click();
    return true;
  }, { hostSel: HOST, sel: selector });
}

/** True while the first-layer banner paints (not the preference center). */
function bannerShown(page) {
  return page.evaluate(({ hostSel }) => {
    let h = null;
    for (const el of document.querySelectorAll(hostSel)) {
      if (el.tagName !== 'SCRIPT' && el.shadowRoot) { h = el; break; }
    }
    if (!h) return false;
    const d = h.shadowRoot.querySelector('#uc-main-dialog');
    if (!d) return false;
    if (String(d.className).includes('second')) return false; // preference center
    const r = d.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  }, { hostSel: HOST });
}

/** True while the preference center (second layer) paints. */
function pcShown(page) {
  return page.evaluate(({ hostSel }) => {
    let h = null;
    for (const el of document.querySelectorAll(hostSel)) {
      if (el.tagName !== 'SCRIPT' && el.shadowRoot) { h = el; break; }
    }
    if (!h) return false;
    const d = h.shadowRoot.querySelector('#uc-main-dialog');
    if (!d) return false;
    return String(d.className).includes('second');
  }, { hostSel: HOST });
}

export function createUsercentricsAdapter(site) {
  const capabilities = {
    banner: true,
    preferenceCenter: true,
    rejectOnBanner: true,
    doNotSell: Boolean(site.doNotSell),
  };

  return {
    vendor: 'usercentrics',
    capabilities,

    async isBannerVisible(page) { return bannerShown(page) || (await findOverlay(page)).length > 0; },

    async ensureBanner(page, { timeout = 15000 } = {}) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await this.isBannerVisible(page)) return true;
        await sleep(600);
      }
      for (let i = 0; i < 2; i++) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
        await sleep(2500);
        if (await this.isBannerVisible(page)) return true;
      }
      return false;
    },

    async acceptAll(page) { const ok = await clickShadow(page, 'button#accept'); await sleep(1000); return { clicked: ok ? 'uc:accept' : null }; },
    async rejectAll(page) { const ok = await clickShadow(page, 'button#deny'); await sleep(1200); return { clicked: ok ? 'uc:deny' : null, viaPc: false }; },
    async openManage(page) { const ok = await clickShadow(page, 'button#more'); await sleep(1500); return { clicked: ok ? 'uc:more' : null }; },

    async openSettingsFromPage(page) {
      // Banner still up → the first-layer "Change Settings" opens the PC.
      if (await this.isBannerVisible(page)) {
        const ok = await clickShadow(page, 'button#more');
        await sleep(1500);
        return { clicked: ok ? 'uc:more' : null, available: ok };
      }
      // After a choice this config exposes NO floating "change settings" control and
      // window.UC_UI is an empty stub — settings genuinely cannot be re-opened.
      return { clicked: null, available: false };
    },

    async isPcOpen(page) { return pcShown(page); },

    async listCategories(page) {
      return page.evaluate(({ hostSel }) => {
        let h = null;
        for (const el of document.querySelectorAll(hostSel)) {
          if (el.tagName !== 'SCRIPT' && el.shadowRoot) { h = el; break; }
        }
        if (!h) return [];
        const sr = h.shadowRoot;
        const out = [];
        for (const card of sr.querySelectorAll('div[id^="uc-category-"]')) {
          if (!card.classList.contains('list-item')) continue;
          const groupId = card.id.replace('uc-category-', '');
          const title = card.querySelector('[id$="-item-title"]');
          const name = (title && title.innerText || '').replace(/\s+/g, ' ').trim();
          if (!name) continue;
          const toggle = sr.querySelector(`button[id="uc-category-${groupId}-toggle"]`);
          const on = toggle
            ? (toggle.getAttribute('aria-checked') === 'true' || String(toggle.className).includes('checked'))
            : false;
          const locked = !toggle || /disabled/.test(String(toggle.className)) || /disabled/.test(String(card.className));
          out.push({ groupId, name, on, locked });
        }
        return out;
      }, { hostSel: HOST });
    },

    async setCategory(page, groupId, on) {
      return page.evaluate(({ hostSel, groupId, on }) => {
        let h = null;
        for (const el of document.querySelectorAll(hostSel)) {
          if (el.tagName !== 'SCRIPT' && el.shadowRoot) { h = el; break; }
        }
        if (!h) return { ok: false, reason: 'no-host' };
        const toggle = h.shadowRoot.querySelector(`button[id="uc-category-${groupId}-toggle"]`);
        if (!toggle) return { ok: false, reason: 'no-toggle' };
        const cur = toggle.getAttribute('aria-checked') === 'true' || String(toggle.className).includes('checked');
        if (cur !== on) toggle.click();
        return { ok: true, before: cur, after: on };
      }, { hostSel: HOST, groupId, on });
    },

    async savePreferences(page) {
      const cats = await this.listCategories(page);
      savedByPage.set(page, cats); // reflect the state we are about to commit
      const ok = await clickShadow(page, 'button#save');
      await sleep(1200);
      return { clicked: ok ? 'uc:save' : null };
    },

    async rejectInPc(page) { const ok = await clickShadow(page, 'button#deny'); await sleep(1200); return { clicked: ok ? 'uc:deny-pc' : null }; },

    async closePc(page) { const ok = await clickShadow(page, 'button#uc-close-button'); await sleep(800); return { clicked: ok ? 'uc:close' : null }; },

    async dismiss(page) {
      // First-layer banner on this template has no close/✕ (only More / Deny / Accept).
      const ok = await clickShadow(page, 'button#uc-close-button');
      await sleep(600);
      return { clicked: ok ? 'uc:close' : null, available: ok };
    },

    async readConsent(page, ctx) {
      const ls = await readLocalStorage(page);
      const raw = ls.ucData || null;
      const cookies = await readCookies(ctx);
      if (!raw) {
        return {
          persisted: false, alertBoxClosed: false, groups: null, enabled: [],
          raw: null, cookieNames: cookies.map((c) => c.name),
          localStorageKeys: Object.keys(ls).sort(), localStorageMirror: [], services: [],
        };
      }
      let services = [];
      try {
        const d = JSON.parse(raw);
        const map = (d.consent && d.consent.services) || {};
        services = Object.values(map).map((s) => ({ name: s.name, on: !!s.consent }));
      } catch (e) { services = []; }
      // Category-level enabled when we know what the PC just saved (storage↔PC oracle);
      // otherwise per-service names.
      const saved = savedByPage.get(page);
      const enabled = saved && saved.length
        ? saved.filter((c) => c.on).map((c) => c.groupId)
        : services.filter((s) => s.on).map((s) => s.name).sort();
      return {
        persisted: true,
        alertBoxClosed: true,
        groups: null,
        enabled,
        services,
        raw: raw.slice(0, 400),
        cookieNames: cookies.map((c) => c.name),
        localStorageKeys: Object.keys(ls).sort(),
        localStorageMirror: [`ucString=${String(ls.ucString || '').slice(0, 120)}`],
      };
    },
  };
}
