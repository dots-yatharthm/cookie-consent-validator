// Vendor-agnostic fallback adapter. Used for sites whose CMP is present but unrecognized
// (discovery mode / future vendors). Actions are text-driven but strictly scoped to consent
// containers; consent state is read from any consent-shaped cookie.

import { sleep, clickScoped, readCookies, readLocalStorage } from '../dom.js';
import { ACCEPT_RE, REJECT_RE, MANAGE_RE, CONFIRM_RE } from '../constants.js';
import { findOverlay } from '../detect/overlay.js';

const CONSENT_COOKIE_RE = /consent|cookie|gdpr|ccpa|privacy|euconsent|usprivacy|didomi|_sp_|CookieBot|Optanon/i;
// Some CMPs write consent to localStorage, not cookies (Usercentrics: ucData/ucString).
const CONSENT_LS_RE = /consent|cookie|gdpr|ccpa|privacy|euconsent|^uc|didomi|^_sp_|iubenda|usercentrics|^_iub/i;

export function createGenericAdapter(site) {
  const capabilities = {
    banner: true,
    preferenceCenter: true,
    rejectOnBanner: true,
    doNotSell: Boolean(site.doNotSell),
  };

  return {
    vendor: 'generic',
    capabilities,

    async isBannerVisible(page) { return (await findOverlay(page)).length > 0; },

    async ensureBanner(page, { timeout = 15000 } = {}) {
      for (let i = 0; i < 3; i++) {
        if (await this.isBannerVisible(page)) return true;
        if (i < 2) { await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {}); await sleep(2500); }
      }
      return (await findOverlay(page)).length > 0;
    },

    async acceptAll(page) { const t = await clickScoped(page, ACCEPT_RE); await sleep(800); return { clicked: t ? `scoped:${t}` : null }; },
    async rejectAll(page) { const t = await clickScoped(page, REJECT_RE); await sleep(800); return { clicked: t ? `scoped:${t}` : null }; },
    async openManage(page) { const t = await clickScoped(page, MANAGE_RE); await sleep(800); return { clicked: t ? `scoped:${t}` : null }; },
    async openSettingsFromPage(page) { const t = await clickScoped(page, MANAGE_RE); await sleep(800); return { clicked: t ? `scoped:${t}` : null }; },
    async savePreferences(page) { const t = await clickScoped(page, CONFIRM_RE); await sleep(1200); return { clicked: t ? `scoped:${t}` : null }; },
    async rejectInPc(page) { const t = await clickScoped(page, REJECT_RE); await sleep(1200); return { clicked: t ? `scoped:${t}` : null }; },

    async dismiss(page) {
      const ok = await page.evaluate(() => {
        const els = [...document.querySelectorAll('[aria-label*="close" i], .close, .dismiss, button[class*="close" i]')];
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { el.click(); return true; }
        }
        return false;
      });
      await sleep(500);
      return { clicked: ok ? 'scoped:close' : null };
    },

    async isPcOpen(page) { return (await findOverlay(page)).length > 0; },
    async closePc(page) { return this.dismiss(page); },

    // No category API without a vendor driver.
    async listCategories() { return []; },
    async setCategory() { return { ok: false, reason: 'generic-no-category-api' }; },

    async readConsent(page, ctx) {
      const cookies = await readCookies(ctx);
      const consent = cookies.filter((c) => CONSENT_COOKIE_RE.test(c.name));
      const ls = await readLocalStorage(page);
      const consentLsKeys = Object.keys(ls).filter((k) => CONSENT_LS_RE.test(k));
      return {
        persisted: consent.length > 0 || consentLsKeys.length > 0,
        alertBoxClosed: consentLsKeys.length > 0,
        groups: null,
        enabled: [],
        raw: consent.map((c) => `${c.name}=${decodeURIComponent(c.value).slice(0, 120)}`).join('\n'),
        cookieNames: consent.map((c) => c.name),
        localStorageKeys: Object.keys(ls).sort(),
        localStorageMirror: consentLsKeys.map((k) => `${k}=${String(ls[k]).slice(0, 120)}`),
      };
    },
  };
}
