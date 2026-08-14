// Test-case registry (TC-001 … TC-013). Each case is a self-contained function over the
// vendor-agnostic adapter interface. The runner supplies a fresh context per case, so accept /
// reject / manage / mobile paths can never contaminate each other.
//
// Result contract: { assertions, anomalies, consent, notes }
//   assertions: [{ name, pass, actual, expected }]  → verdict + defect mapping
//   anomalies:  [{ key, severity: 'warn'|'high', message }] → runtime discoveries

import { sleep } from './dom.js';
import { compareEnabled, trackerCookieNames } from './verify/storage-verifier.js';
import { pageUsable } from './verify/ui-verifier.js';
import { TRACKER_COOKIE_RE } from './constants.js';

const ok = (name, pass, actual, expected) => ({ name, pass, actual, expected });
const anom = (key, severity, message) => ({ key, severity, message });
const strictOf = (site) => site.storage?.strictGroup || 'C0001';
const allGroupsOf = (site) => site.storage?.groups || [];

// Expected enabled set after the site's Accept All. Declared per-site when the site's accept
// semantics differ from the default (e.g. ahwatukeepa leaves C0003 off and enables SPDTA_BG);
// otherwise every group except a dedicated Do-Not-Sell group.
function acceptExpected(site) {
  if (site.acceptGroups) return site.acceptGroups;
  const dn = site.doNotSell?.groupId;
  return allGroupsOf(site).filter((g) => g !== dn);
}

// Pre-consent scroll baseline: can this page actually scroll? (Some sites are fixed-height by design.)
async function scrollableNow(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const before = se.scrollTop;
    se.scrollTop = 300;
    const moved = se.scrollTop !== before && se.scrollTop > 0;
    se.scrollTop = 0;
    return maxScroll > 0 && moved;
  });
}

// Choose the non-strict, non-locked category that exercises a real change: prefer analytics,
// then any togglable off group, then any togglable on group.
function pickCategory(cats, site) {
  const strict = strictOf(site);
  const nonStrict = cats.filter((c) => c.groupId && c.groupId !== strict && !c.locked && !c.hidden);
  if (!nonStrict.length) return null;
  return (
    nonStrict.find((c) => !c.on && /analytics|performance/i.test(c.name)) ||
    nonStrict.find((c) => !c.on) ||
    nonStrict.find((c) => /analytics|performance/i.test(c.name)) ||
    nonStrict[0]
  );
}

export const TCS = [
  // ---------------------------------------------------------------- TC-001
  {
    id: 'TC-001',
    title: 'CMP presence detection & vendor identification',
    priority: 'P1',
    applicable: () => ({ ok: true }),
    run: async ({ site, detection }) => {
      const expected = site.expectedVendor || 'auto';
      // 'auto' = discovery mode (--url): no expectation declared, so any detection result is
      // valid — the point is to RECORD what's there. A genuinely unrecognized overlay is still
      // surfaced via the UNRECOGNIZED_CMP anomaly below.
      const pass = expected === 'auto' ? true : detection.vendor === expected;
      return {
        assertions: [
          ok('vendor-detected', pass, detection.vendor, expected),
        ],
        anomalies: detection.vendor === 'unknown'
          ? [anom('UNRECOGNIZED_CMP', 'high', `A consent overlay is present but no known vendor matched (${detection.overlay?.map((o) => o.id || o.selector).join(', ')})`)]
          : [],
        notes: {
          evidence: detection.evidence,
          score: detection.score,
          scriptSrc: detection.scriptSrc,
          reqHosts: detection.reqHosts,
          globals: detection.globals,
        },
      };
    },
  },

  // ---------------------------------------------------------------- TC-002
  {
    id: 'TC-002',
    title: 'Banner appears on first visit',
    priority: 'P1',
    applicable: (site, adapter) => adapter.capabilities.banner
      ? { ok: true }
      : { ok: false, reason: 'no CMP installed — banner by design absent' },
    run: async ({ site, adapter, page, vp, shot, step }) => {
      await adapter.ensureBanner(page);
      const present = await adapter.isBannerVisible(page);
      let bannerText = null;
      if (present) {
        bannerText = await page.evaluate(() => {
          const el = document.querySelector('#onetrust-banner-sdk') || document.querySelector('#CybotCookiebotDialog');
          return el ? el.innerText.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
        });
        if (bannerText) step(`banner text: ${bannerText.slice(0, 160)}`);
        await shot('banner', page);
      }
      return {
        assertions: [
          ok('banner-visible-first-visit', present, present, true),
        ],
        anomalies: [],
        notes: { viewport: vp.name, bannerText },
      };
    },
  },

  // ---------------------------------------------------------------- TC-003
  {
    id: 'TC-003',
    title: 'Accept All enables every consent group',
    priority: 'P1',
    applicable: (site, adapter) => adapter.capabilities.banner
      ? { ok: true }
      : { ok: false, reason: 'no CMP installed' },
    run: async ({ site, adapter, page, ctx, shot }) => {
      await adapter.ensureBanner(page);
      const r = await adapter.acceptAll(page);
      await sleep(1800);
      const after = await adapter.readConsent(page, ctx);
      const expected = acceptExpected(site);
      const cmp = expected.length ? compareEnabled({ groups: after.groups, expectedEnabled: expected }) : null;
      const assertions = [
        ok('banner-dismissed-after-accept', !(await adapter.isBannerVisible(page)), await adapter.isBannerVisible(page), false),
        ok('consent-storage-written', after.persisted, after.persisted, true),
      ];
      if (cmp) assertions.push(ok('groups-match-accept', cmp.ok, after.enabled, expected));
      await shot('after-accept', page);
      return {
        assertions,
        anomalies: [],
        consent: { after: summarizeConsent(after), clicked: r.clicked },
      };
    },
  },

  // ---------------------------------------------------------------- TC-004
  {
    id: 'TC-004',
    title: 'Reject All records only strictly-necessary (banner or PC fallback)',
    priority: 'P1',
    applicable: (site, adapter) => adapter.capabilities.banner
      ? { ok: true }
      : { ok: false, reason: 'no CMP installed' },
    run: async ({ site, adapter, page, ctx, shot }) => {
      await adapter.ensureBanner(page);
      const beforeTrackers = await trackerCookieNames(ctx);
      const r = await adapter.rejectAll(page);
      await sleep(2200);
      const afterTrackers = await trackerCookieNames(ctx);
      const after = await adapter.readConsent(page, ctx);
      const newTrackers = afterTrackers.filter((n) => !beforeTrackers.includes(n));
      const strict = strictOf(site);
      const cmp = compareEnabled({ groups: after.groups, expectedEnabled: [strict] });
      const assertions = [
        ok('banner-dismissed-after-reject', !(await adapter.isBannerVisible(page)), await adapter.isBannerVisible(page), false),
        ok('consent-storage-written', after.persisted, after.persisted, true),
      ];
      if (allGroupsOf(site).length) assertions.push(ok('groups-reject-only-strict', cmp.ok, after.enabled, [strict]));
      assertions.push(ok('no-trackers-after-reject', newTrackers.length === 0, newTrackers, []));
      await shot('after-reject', page);
      return {
        assertions,
        anomalies: newTrackers.length
          ? [anom('TRACKERS_AFTER_REJECT', 'high', `tracker/analytics cookies set after Reject All: ${newTrackers.join(', ')}`)]
          : [],
        consent: { after: summarizeConsent(after), rejectVia: r.viaPc ? 'pc-refuse-all' : r.clicked },
      };
    },
  },

  // ---------------------------------------------------------------- TC-005
  {
    id: 'TC-005',
    title: 'Manage Preferences: partial choice is saved exactly',
    priority: 'P1',
    applicable: (site, adapter) => adapter.capabilities.preferenceCenter
      ? { ok: true }
      : { ok: false, reason: 'no preference center on this CMP' },
    run: async ({ site, adapter, page, ctx, shot, step }) => {
      await adapter.ensureBanner(page);
      await adapter.openManage(page);
      await sleep(1600);
      const cats = await adapter.listCategories(page);
      const target = pickCategory(cats, site);
      const anomalies = [];
      const assertions = [
        ok('pc-categories-listed', cats.length > 0, cats.map((c) => c.groupId).join(',') || 'none', '>0'),
      ];
      if (!target) {
        assertions.push(ok('groups-match-partial', false, 'no-togglable-category', 'at least one non-strict category'));
      } else {
        const desired = !target.on;
        step(`target category: ${target.groupId} ${target.name} → ${desired ? 'on' : 'off'}`);
        await adapter.setCategory(page, target.groupId, desired);
        await adapter.savePreferences(page);
        await sleep(1800);
        const after = await adapter.readConsent(page, ctx);
        // Reopen the PC and compare its toggle state to storage — robust to grouped/master toggles
        // (e.g. ahwatukeepa's SPDTA_BG master switch also drives C0002/C0004).
        const rOpen = await adapter.openSettingsFromPage(page);
        await sleep(1600);
        const pcAfter = await adapter.listCategories(page);
        const pcEnabled = pcAfter.filter((c) => c.on && !c.locked).map((c) => c.groupId).sort();
        const storedEnabled = (after.enabled || []).filter((g) => g !== strictOf(site)).sort();
        const toggleReflected = desired ? after.enabled.includes(target.groupId) : !after.enabled.includes(target.groupId);
        // The storage↔PC cross-check needs a re-open path. If the adapter reports none exists,
        // skip the oracle (not a false failure) and surface it as a high-severity discovery —
        // the choice itself is still proven by consent-storage-written + groups-match-partial.
        let stateMatch = JSON.stringify(pcEnabled) === JSON.stringify(storedEnabled);
        if (rOpen.available === false && pcAfter.length === 0) {
          stateMatch = true; // oracle inapplicable — settings cannot be re-opened on this site
          anomalies.push(anom('NO_REOPEN_CONTROL', 'high',
            'No visible consent-settings control exists after a choice — consent cannot be re-opened or changed later.'));
        }
        assertions.push(
          ok('consent-storage-written', after.persisted, after.persisted, true),
          ok('storage-matches-pc-state', stateMatch, storedEnabled, pcEnabled),
          ok('groups-match-partial', toggleReflected && after.persisted, after.enabled, target.groupId),
        );
        await shot('pc-partial-save', page);
      }
      return {
        assertions,
        anomalies,
        notes: { categories: cats, toggled: target ? { groupId: target.groupId, name: target.name, desired: !target.on } : null },
        consent: {},
      };
    },
  },

  // ---------------------------------------------------------------- TC-006
  {
    id: 'TC-006',
    title: 'Manage Preferences: close without saving discards changes',
    priority: 'P2',
    applicable: (site, adapter) => adapter.capabilities.preferenceCenter
      ? { ok: true }
      : { ok: false, reason: 'no preference center on this CMP' },
    run: async ({ site, adapter, page, ctx }) => {
      await adapter.ensureBanner(page);
      await adapter.openManage(page);
      await sleep(1600);
      const cats = await adapter.listCategories(page);
      const target = pickCategory(cats, site);
      const before = await adapter.readConsent(page, ctx);
      if (target) { await adapter.setCategory(page, target.groupId, !target.on); await sleep(400); }
      await adapter.closePc(page);
      await sleep(900);
      const after = await adapter.readConsent(page, ctx);
      const consentChanged = after.persisted && JSON.stringify(after.groups) !== JSON.stringify(before.groups);
      return {
        assertions: [
          ok('pc-closed-after-close', !(await adapter.isPcOpen(page)), await adapter.isPcOpen(page), false),
          ok('no-consent-recorded-after-close', !consentChanged, consentChanged, false),
        ],
        anomalies: [],
        consent: { before: summarizeConsent(before), after: summarizeConsent(after) },
      };
    },
  },

  // ---------------------------------------------------------------- TC-007
  {
    id: 'TC-007',
    title: 'Consent choice persists across reload',
    priority: 'P1',
    applicable: (site, adapter) => adapter.capabilities.banner
      ? { ok: true }
      : { ok: false, reason: 'no CMP installed' },
    run: async ({ site, adapter, page, ctx, shot }) => {
      await adapter.ensureBanner(page);
      await adapter.acceptAll(page);
      await sleep(1800);
      const afterAccept = await adapter.readConsent(page, ctx);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 });
      await sleep(2500);
      const afterReload = await adapter.readConsent(page, ctx);
      const groupsStable = JSON.stringify(afterAccept.groups) === JSON.stringify(afterReload.groups);
      return {
        assertions: [
          ok('banner-suppressed-after-reload', !(await adapter.isBannerVisible(page)), await adapter.isBannerVisible(page), false),
          ok('consent-storage-written', afterAccept.persisted, afterAccept.persisted, true),
          ok('storage-identical-after-reload', afterReload.persisted && groupsStable, afterReload.enabled, afterAccept.enabled),
          ok('persist-after-reload', afterReload.persisted, afterReload.persisted, true),
        ],
        anomalies: [],
        consent: { afterAccept: summarizeConsent(afterAccept), afterReload: summarizeConsent(afterReload) },
      };
    },
  },

  // ---------------------------------------------------------------- TC-008
  {
    id: 'TC-008',
    title: 'Consent settings can be re-opened after a choice',
    priority: 'P2',
    applicable: (site, adapter) => adapter.capabilities.banner && adapter.capabilities.preferenceCenter
      ? { ok: true }
      : { ok: false, reason: 'no CMP / no preference center' },
    run: async ({ site, adapter, page, shot }) => {
      await adapter.ensureBanner(page);
      await adapter.acceptAll(page);
      await sleep(1400);
      const r = await adapter.openSettingsFromPage(page);
      await sleep(1600);
      const pcOpen = await adapter.isPcOpen(page);
      if (pcOpen) await shot('settings-reopened', page);
      // Adapter may report that this CMP config exposes NO re-open control at all (e.g.
      // Usercentrics without a floating "change settings" button) — a real compliance gap
      // (users can no longer change consent), surfaced as a high-severity discovery.
      const anomalies = [];
      if (r.available === false && !pcOpen) {
        anomalies.push(anom('NO_REOPEN_CONTROL', 'high',
          'No visible consent-settings control exists after a choice — consent cannot be re-opened or changed later.'));
      }
      return {
        assertions: [
          ok('settings-reopenable', pcOpen, r.clicked || pcOpen, 'settings control opens PC'),
        ],
        anomalies,
        notes: { openedBy: r.clicked },
      };
    },
  },

  // ---------------------------------------------------------------- TC-009
  {
    id: 'TC-009',
    title: 'Consent record is persisted (storage verification oracle)',
    priority: 'P1',
    applicable: (site, adapter) => adapter.capabilities.banner
      ? { ok: true }
      : { ok: false, reason: 'no CMP installed' },
    run: async ({ site, adapter, page, ctx }) => {
      await adapter.ensureBanner(page);
      const pre = await adapter.readConsent(page, ctx);
      const anomalies = [];
      if (pre.groups) {
        const nonStrictOn = pre.enabled.filter((g) => g !== strictOf(site));
        if (nonStrictOn.length) {
          anomalies.push(anom('PRE_TICKED', 'warn', `non-strict group(s) ${nonStrictOn.join(', ')} are enabled before any consent choice`));
        }
      }
      const preTrackers = (pre.localStorageKeys || []).filter((k) => TRACKER_COOKIE_RE.test(k));
      if (preTrackers.length) {
        anomalies.push(anom('TRACKER_LS_PRECONSENT', 'warn', `tracking localStorage key(s) ${preTrackers.join(', ')} present before any consent choice`));
      }
      await adapter.acceptAll(page);
      await sleep(1800);
      const after = await adapter.readConsent(page, ctx);
      const expected = acceptExpected(site);
      const cmp = expected.length ? compareEnabled({ groups: after.groups, expectedEnabled: expected }) : null;
      const assertions = [
        ok('storage-cookie-present', after.persisted, after.persisted, true),
        // Group IDs are a OneTrust concept; service-level CMPs (Usercentrics) expose the same
        // record through `enabled`/`services` — either being populated proves it is decodable.
        ok('storage-groups-decodable',
          !!after.groups || (after.enabled && after.enabled.length > 0),
          JSON.stringify(after.groups || after.enabled || null), 'decoded consent record'),
      ];
      if (cmp) assertions.push(ok('storage-groups-match-accept', cmp.ok, after.enabled, expected));
      const lsm = site.storage?.localStorage || [];
      if (lsm.length) {
        const mirrorOk = lsm.every((k) => after.localStorageMirror[lsm.indexOf(k)] != null);
        assertions.push(ok('storage-localstorage-mirror', mirrorOk, after.localStorageKeys, lsm));
      }
      assertions.push(ok('alert-box-closed-recorded', after.alertBoxClosed, after.alertBoxClosed, true));
      return {
        assertions,
        anomalies,
        consent: { preChoice: summarizeConsent(pre), afterAccept: summarizeConsent(after) },
      };
    },
  },

  // ---------------------------------------------------------------- TC-010
  {
    id: 'TC-010',
    title: 'Dismiss (X) suppresses the banner without recording a consent choice',
    priority: 'P2',
    applicable: (site, adapter) => adapter.capabilities.banner
      ? { ok: true }
      : { ok: false, reason: 'no CMP installed' },
    run: async ({ site, adapter, page, ctx }) => {
      await adapter.ensureBanner(page);
      const pre = await adapter.readConsent(page, ctx); // OneTrust may already hold a default C0001-only cookie
      const r = await adapter.dismiss(page);
      await sleep(1500);
      // Runtime N/A: some CMP templates have no dismiss/✕ control on the banner (the user must
      // make a real choice). Nothing to dismiss → skip, not a failure.
      if (r.available === false && !r.clicked) {
        return {
          assertions: [], anomalies: [],
          notes: { dismissClicked: null, bannerAfterReload: 'n/a' },
          skipReason: 'banner has no dismiss (X) control — no dismiss-without-choice path exists',
        };
      }
      const after = await adapter.readConsent(page, ctx);
      const dismissed = !(await adapter.isBannerVisible(page));
      // X must NOT record a consent choice: the enabled group set must be unchanged from pre-choice.
      const noChoice = !after.persisted || JSON.stringify(after.enabled) === JSON.stringify(pre.enabled);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 });
      await sleep(2500);
      const reappears = await adapter.isBannerVisible(page);
      return {
        assertions: [
          ok('banner-dismissed-via-x', dismissed, dismissed, true),
          ok('x-suppresses-not-consent', noChoice, after.enabled, pre.enabled),
        ],
        anomalies: [],
        consent: { beforeDismiss: summarizeConsent(pre), afterDismiss: summarizeConsent(after) },
        notes: { dismissClicked: r.clicked, bannerAfterReload: reappears ? 'reappears' : 'suppressed' },
      };
    },
  },

  // ---------------------------------------------------------------- TC-011
  {
    id: 'TC-011',
    title: 'Mobile viewport parity (rendering + consent action)',
    priority: 'P2',
    applicable: (site, adapter, vp) => {
      if (!adapter.capabilities.banner) return { ok: false, reason: 'no CMP installed' };
      if (vp.name !== 'mobile') return { ok: false, reason: 'mobile-only case (desktop covered by the other TCs)' };
      return { ok: true };
    },
    run: async ({ site, adapter, page, ctx, shot, step }) => {
      await adapter.ensureBanner(page);
      await sleep(400); // let the banner finish its entry animation before measuring
      const present = await adapter.isBannerVisible(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const rect = await page.evaluate(() => {
        const el = document.querySelector('#onetrust-banner-sdk');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { bottom: Math.round(r.bottom), vh: window.innerHeight, top: Math.round(r.top), w: Math.round(r.width) };
      });
      if (rect) step(`banner rect: bottom=${rect.bottom}px, viewport=${rect.vh}px`);
      const consent = {};
      const assertions = [
        ok('banner-in-viewport-mobile', present, present, true),
        ok('no-horizontal-overflow', !overflow, overflow, false),
      ];
      if (rect) {
        // Cross-browser text-rendering tolerance: the same OneTrust template can render a few px
        // taller in Firefox than chromium (font metrics). Only flag overflows beyond ~5% of the
        // viewport height — those mean the banner genuinely dominates / CTA is unreachable.
        const tol = Math.ceil(rect.vh * 0.05);
        assertions.push(ok('banner-fits-height', rect.bottom <= rect.vh + tol, rect.bottom, `<= ${rect.vh + tol} (vh + 5% tol)`));
      }
      if (present) {
        await shot('mobile-banner', page);
        await adapter.acceptAll(page);
        await sleep(1800);
        const after = await adapter.readConsent(page, ctx);
        assertions.push(ok('mobile-accept-works', !(await adapter.isBannerVisible(page)) && after.persisted, after.persisted, true));
        consent.mobileAfterAccept = summarizeConsent(after);
      }
      return { assertions, anomalies: [], consent };
    },
  },

  // ---------------------------------------------------------------- TC-012
  {
    id: 'TC-012',
    title: 'Page remains usable after consent (no zombie overlay)',
    priority: 'P2',
    applicable: () => ({ ok: true }),
    run: async ({ site, adapter, page, shot, step }) => {
      let baseline = false;
      if (adapter.capabilities.banner) {
        await adapter.ensureBanner(page);
        baseline = await scrollableNow(page);
        await adapter.acceptAll(page);
        await sleep(1400);
      }
      const u = await pageUsable(page, { scrollableBefore: baseline });
      step(`pageUsable → locked=${u.locked}, zombieOverlay=${u.zombie}, primaryLink=${u.linkReachable}`);
      await shot('page-usable', page);
      return {
        assertions: [
          ok('page-not-locked-by-consent', !u.locked, u.locked, false),
          ok('no-zombie-overlay', !u.zombie, u.failures.join(';') || 'none', '[]'),
          ok('primary-link-clickable', u.linkReachable, u.linkReachable, true),
        ],
        anomalies: [],
        notes: { details: u },
      };
    },
  },

  // ---------------------------------------------------------------- TC-013
  {
    id: 'TC-013',
    title: 'CCPA / Do-Not-Sell control present and reflected',
    priority: 'P2',
    applicable: (site, adapter) => site.doNotSell
      ? { ok: true }
      : { ok: false, reason: 'no CCPA Do-Not-Sell control declared for this site' },
    run: async ({ site, adapter, page, ctx, step }) => {
      const dn = site.doNotSell;
      await adapter.ensureBanner(page);
      const floating = await page.evaluate(() => {
        const containers = [...document.querySelectorAll('#ot-sdk-btn-floating, .ot-sdk-show-settings, [class*="onetrust" i], [class*="do-not-sell" i]')];
        return containers.some((el) => /do not sell/i.test(el.innerText || '') || /do not sell/i.test(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`));
      });
      await adapter.openManage(page);
      await sleep(1500);
      const cats = await adapter.listCategories(page);
      const pcMatch = cats.find((c) => dn.groupId ? c.groupId === dn.groupId : /do not sell/i.test(c.name));
      const controlPresent = floating || !!pcMatch;
      if (floating) step('Do-Not-Sell control found: floating/settings link');
      else if (pcMatch) step(`Do-Not-Sell control found: PC group ${pcMatch.groupId} ${pcMatch.name}`);
      else step('Do-Not-Sell control: not found');
      const assertions = [
        ok('dns-control-present', controlPresent, pcMatch ? `${pcMatch.groupId} ${pcMatch.name}` : (floating ? 'floating/settings link' : 'not found'), dn.label),
      ];
      if (dn.groupId && pcMatch) {
        if (!pcMatch.on) { await adapter.setCategory(page, pcMatch.groupId, true); await sleep(500); }
        await adapter.savePreferences(page);
        await sleep(1800);
        const after = await adapter.readConsent(page, ctx);
        assertions.push(ok('dns-group-reflected', after.enabled.includes(dn.groupId), after.enabled, dn.groupId));
      }
      return { assertions, anomalies: [], consent: {}, notes: { floating, pcMatch, categories: cats } };
    },
  },
];

function summarizeConsent(c) {
  return {
    persisted: c.persisted,
    alertBoxClosed: c.alertBoxClosed,
    enabled: c.enabled,
    cookieNames: c.cookieNames,
    raw: c.raw ? c.raw.slice(0, 180) : null,
  };
}
