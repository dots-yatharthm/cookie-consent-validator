// Storage-layer consent verification (Oracle A). Reads the actual consent cookie/localStorage
// and compares the decoded group set against the expectation. Groups are data-driven from the
// site profile (C0001–C0004 and any custom groups like ahwatukeepa's SPDTA_BG).

import { readCookies, readLocalStorage } from '../dom.js';
import { TRACKER_COOKIE_RE } from '../constants.js';

/** Decode a OneTrust OptanonConsent value and extract groups as {C0001:'1', C0002:'0', ...}. */
export function parseOptanonGroups(value, requiresDecode = true) {
  const v = requiresDecode ? decodeURIComponent(value || '') : value || '';
  const m = v.match(/groups=([^&]+)/);
  if (!m) return null;
  return Object.fromEntries(m[1].split(',').map((p) => p.split(':').map((s) => s.trim())));
}

/** The list of group ids currently enabled ('1' or 'true'). */
export function enabledGroups(groups) {
  return Object.entries(groups || {})
    .filter(([, v]) => v === '1' || String(v).toLowerCase() === 'true')
    .map(([k]) => k);
}

/** Compare the enabled set from storage against the exact expected set. */
export function compareEnabled({ groups, expectedEnabled }) {
  const enabled = new Set(enabledGroups(groups));
  const expected = new Set(expectedEnabled || []);
  const extra = [...enabled].filter((g) => !expected.has(g));
  const missing = [...expected].filter((g) => !enabled.has(g));
  return { ok: extra.length === 0 && missing.length === 0, extra, missing, enabled: [...enabled] };
}

/** Names of tracker/analytics cookies currently set (for the "no trackers after reject" oracle). */
export async function trackerCookieNames(ctx) {
  const cookies = await readCookies(ctx);
  return [...new Set(cookies.map((c) => c.name).filter((n) => TRACKER_COOKIE_RE.test(n)))];
}

/**
 * Site-profile-aware consent reader for OneTrust. Returns a normalized ConsentState that the
 * storage assertions and reports consume. `site.storage` describes which keys to read.
 */
export async function readOneTrustConsent(page, ctx, site) {
  const S = site.storage || {};
  const names = S.cookieNames && S.cookieNames.length ? S.cookieNames : ['OptanonConsent', 'OptanonAlertBoxClosed'];
  const cookies = await readCookies(ctx);
  const byName = {};
  for (const n of names) { const c = cookies.find((c) => c.name === n); byName[n] = c ? c.value : null; }

  const groups = byName.OptanonConsent ? parseOptanonGroups(byName.OptanonConsent, S.requiresDecode !== false) : null;
  const ls = await readLocalStorage(page);

  const mirror = (S.localStorage || []).map((k) => ls[k] ?? null);

  return {
    persisted: Boolean(byName.OptanonConsent),
    alertBoxClosed: byName.OptanonAlertBoxClosed != null,
    groups,
    enabled: enabledGroups(groups),
    raw: byName.OptanonConsent ? decodeURIComponent(byName.OptanonConsent) : null,
    cookieNames: Object.entries(byName).filter(([, v]) => v != null).map(([k]) => k),
    localStorageKeys: Object.keys(ls).sort(),
    localStorageMirror: mirror,
  };
}
