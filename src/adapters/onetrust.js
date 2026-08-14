// OneTrust consent adapter. Ports the working action logic from the analysis harness:
//   - visibility via elShown (offsetParent is broken for position:fixed banners)
//   - selector-ID first, scoped text fallback second
//   - tolerant PC category selectors (.ot-cat-grp, .ot-cat-item, .ot-accordion-layout) so both
//     modern templates and legacy v6.36 (adient) are covered
//   - real input.click() for PC toggles (setting checked + dispatchEvent does NOT trigger the SDK)
//   - reject-all falls back to the PC's .ot-pc-refuse-all-handler when the banner hides it

import { sleep, elShown, clickScoped } from '../dom.js';
import { ACCEPT_RE, REJECT_RE, MANAGE_RE, CONFIRM_RE } from '../constants.js';
import { findOverlay } from '../detect/overlay.js';
import { readOneTrustConsent } from '../verify/storage-verifier.js';

const BANNER = '#onetrust-banner-sdk';
const PC = '#onetrust-pc-sdk';

async function clickByIdOrScoped(page, ids, re) {
  for (const sel of ids) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1800 }).catch(() => false)) {
        await el.click({ timeout: 2500 });
        return { clicked: sel };
      }
    } catch (e) { /* try next */ }
  }
  if (!re) return { clicked: null };
  const t = await clickScoped(page, re);
  return { clicked: t ? `scoped:${t}` : null };
}

export function createOneTrustAdapter(site) {
  const S = site.storage || {};

  const capabilities = {
    banner: true,
    preferenceCenter: true,
    rejectOnBanner: site.rejectOnBanner !== false, // jncb hides banner reject
    doNotSell: Boolean(site.doNotSell),
  };

  return {
    vendor: 'onetrust',
    capabilities,

    // ---------- banner ----------
    async isBannerVisible(page) { return elShown(page, BANNER); },

    // Cold-load flakiness: up to 2 reload retries before giving up.
    async ensureBanner(page, { timeout = 15000 } = {}) {
      for (let i = 0; i < 3; i++) {
        if (await this.isBannerVisible(page)) return true;
        if (i < 2) { await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {}); await sleep(2500); }
      }
      return (await findOverlay(page)).length > 0;
    },

    async acceptAll(page) {
      const r = await clickByIdOrScoped(page, ['#onetrust-accept-btn-handler'], ACCEPT_RE);
      await sleep(800);
      return r;
    },

    async rejectAll(page) {
      if (capabilities.rejectOnBanner) {
        const r = await clickByIdOrScoped(page, ['#onetrust-reject-all-handler'], REJECT_RE);
        if (r.clicked) { await sleep(800); return r; }
      }
      // Fallback: open the PC and use its refuse-all (saves the refusal directly).
      await this.openManage(page);
      await sleep(1200);
      const r2 = await clickByIdOrScoped(page, ['.ot-pc-refuse-all-handler'], REJECT_RE);
      await sleep(800);
      return { ...r2, viaPc: true };
    },

    async openManage(page) {
      for (const sel of ['#onetrust-pc-btn-handler', '#ot-sdk-btn-floating', '.ot-sdk-show-settings']) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 2500 }).catch(() => false)) {
          await loc.click({ timeout: 3000 }).catch(() => {});
          return { clicked: sel };
        }
      }
      const t = await clickScoped(page, MANAGE_RE);
      return { clicked: t ? `scoped:${t}` : null };
    },

    async dismiss(page) {
      const r = await clickByIdOrScoped(page, ['.onetrust-close-btn-handler', '.onetrust-close-btn-ui', `${BANNER} .onetrust-close-btn-handler`], null);
      await sleep(500);
      return r;
    },

    async openSettingsFromPage(page) {
      // Floating button, then page-level consent triggers (adient uses .cookie-setting-link, a
      // JS anchor that calls the OneTrust SDK), then scoped text fallback.
      for (const sel of ['#ot-sdk-btn-floating', '.ot-sdk-show-settings', '.cookie-setting-link', '[data-ot-onetrust]']) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 2500 }).catch(() => false)) {
          await loc.click({ timeout: 3000 }).catch(() => {});
          return { clicked: sel };
        }
      }
      const t = await clickScoped(page, MANAGE_RE);
      return { clicked: t ? `scoped:${t}` : null };
    },

    // ---------- preference center ----------
    async isPcOpen(page) { return elShown(page, PC); },

    async listCategories(page) {
      return page.evaluate((PC) => {
        // helpers (must live inside the browser-context function)
        const gidOf = (i) => {
          const d = i.getAttribute && i.getAttribute('data-optanongroupid');
          if (d) return d;
          const v = i.value || '';
          if (/^C\d{3,4}$/.test(v) || /^SPDTA_/.test(v)) return v;
          const m = `${i.id || ''} ${i.name || ''}`.match(/ot-(?:sub-)?group-id-([A-Za-z0-9_]+)/);
          if (m) return m[1];
          const m2 = `${i.id || ''} ${i.name || ''}`.match(/\b(C\d{3,4})\b/);
          return m2 ? m2[1] : '';
        };
        const nameOf = (i) => {
          let n = i;
          for (let k = 0; k < 8 && n; k++) {
            const h = n.querySelector && n.querySelector('.ot-cat-header, .ot-acc-hdr, .ot-tgl-txt, .category-header');
            if (h && h.innerText && h.innerText.trim()) return h.innerText.trim().replace(/\s+/g, ' ').slice(0, 80);
            n = n.parentElement;
          }
          return '';
        };
        const root = document.querySelector(PC);
        if (!root) return [];
        const out = [];
        for (const input of root.querySelectorAll('input[type="checkbox"]')) {
          const gid = gidOf(input);
          if (!gid) continue; // skip select-all / generic checkboxes
          const sw = input.closest('.ot-switch, .ot-tgl');
          const on = input.checked || input.getAttribute('aria-checked') === 'true'
            || (sw && (sw.classList.contains('ot-switch-on') || sw.getAttribute('aria-checked') === 'true'));
          // hidden = the toggle is actually not rendered (computed style), NOT class ancestry —
          // classic templates carry .ot-hide-tgl on ancestors that are still displayed (adient)
          const hidden = sw
            ? getComputedStyle(sw).display === 'none' || getComputedStyle(sw).visibility === 'hidden'
            : Boolean(input.closest('.ot-hide-tgl, .ot-hide'));
          out.push({ groupId: gid, name: nameOf(input) || gid, on, locked: input.disabled, hidden });
        }
        const seen = new Map();
        for (const c of out) {
          const prev = seen.get(c.groupId);
          if (!prev || (!c.hidden && prev.hidden)) seen.set(c.groupId, c);
        }
        return [...seen.values()];
      }, PC);
    },

    async setCategory(page, groupId, on) {
      const res = await page.evaluate(({ PC, groupId, on }) => {
        const gidOf = (i) => {
          const d = i.getAttribute && i.getAttribute('data-optanongroupid');
          if (d) return d;
          const v = i.value || '';
          if (/^C\d{3,4}$/.test(v) || /^SPDTA_/.test(v)) return v;
          const m = `${i.id || ''} ${i.name || ''}`.match(/ot-(?:sub-)?group-id-([A-Za-z0-9_]+)/);
          if (m) return m[1];
          const m2 = `${i.id || ''} ${i.name || ''}`.match(/\b(C\d{3,4})\b/);
          return m2 ? m2[1] : '';
        };
        const root = document.querySelector(PC);
        if (!root) return { ok: false, reason: 'pc-not-open' };
        for (const input of root.querySelectorAll('input[type="checkbox"]')) {
          if (gidOf(input) !== groupId) continue;
          if (input.disabled) return { ok: false, reason: 'locked', groupId };
          const sw = input.closest('.ot-switch, .ot-tgl');
          const isOn = input.checked || input.getAttribute('aria-checked') === 'true'
            || (sw && (sw.classList.contains('ot-switch-on') || sw.getAttribute('aria-checked') === 'true'));
          if (isOn !== on) { input.click(); return { ok: true, groupId, from: isOn, to: on }; } // real click -> SDK handler
          return { ok: true, groupId, from: isOn, to: isOn, already: true };
        }
        return { ok: false, reason: 'group-not-found', groupId };
      }, { PC, groupId, on });
      await sleep(500);
      return res;
    },

    async savePreferences(page) {
      const r = await clickByIdOrScoped(
        page,
        ['.save-preference-btn-handler', '#onetrust-pc-sdk .ot-save-cntnr button', '#onetrust-pc-sdk #accept-recommended-btn-handler'],
        CONFIRM_RE
      );
      await sleep(1500);
      return r;
    },

    async rejectInPc(page) {
      const r = await clickByIdOrScoped(page, ['.ot-pc-refuse-all-handler'], REJECT_RE);
      await sleep(1500);
      return r;
    },

    async closePc(page) {
      const r = await clickByIdOrScoped(page, ['.ot-pc-close', '#onetrust-pc-sdk .ot-pc-header button', '.ot-close-icon'], null);
      await sleep(900);
      return r;
    },

    // ---------- consent state ----------
    async readConsent(page, ctx) {
      return readOneTrustConsent(page, ctx, site);
    },
  };
}
