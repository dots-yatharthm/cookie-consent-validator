// Multi-signal CMP vendor detection (port of the analysis harness's detectVendor, plus a
// none/unknown distinction). Evidence is gathered from script URLs, network hosts, consent
// cookies, localStorage, and window globals — so a site like jncb (detectable only via
// DOM/script/globals, no consent cookie) is still identified correctly.

import { findOverlay } from './overlay.js';

const VENDOR_GLOBALS = {
  onetrust:    ['OneTrust', 'onetrust', 'OptanonActiveGroups', 'otBannerSdk'],
  cookiebot:   ['Cookiebot'],
  didomi:      ['didomi'],
  usercentrics:['usercentrics'],
  trustarc:    ['truste'],
  iubenda:     ['_iub', 'iubenda'],
};

export async function detectVendor(page, ctx, { requests = [] } = {}) {
  const scriptSrc = await page.evaluate(() => [...document.scripts].map((s) => s.src).join('\n'));
  const ls = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  });
  const cookieNames = (await ctx.cookies()).map((c) => c.name);
  const globals = await page.evaluate((names) => {
    const out = {};
    for (const n of names) { try { out[n] = typeof window[n] !== 'undefined'; } catch (e) { out[n] = false; } }
    return out;
  }, [...new Set(Object.values(VENDOR_GLOBALS).flat())]);

  const reqHosts = [...new Set(requests.map((r) => { try { return new URL(r.url).hostname; } catch (e) { return ''; } }))];

  const score = { onetrust: 0, cookiebot: 0, didomi: 0, quantcast: 0, usercentrics: 0, trustarc: 0, sourcepoint: 0, iubenda: 0 };
  const evidence = Object.fromEntries(Object.keys(score).map((k) => [k, []]));
  const add = (v, note) => { score[v]++; evidence[v].push(note); };

  // OneTrust
  if (/cookielaw\.org|onetrust/i.test(scriptSrc)) add('onetrust', 'script:cookielaw/onetrust');
  if (reqHosts.some((h) => /cookielaw\.org/.test(h))) add('onetrust', 'network:cookielaw.org');
  if (/Optanon/i.test(JSON.stringify(cookieNames)) || ls.OptanonConsent) add('onetrust', 'storage:Optanon');
  if (VENDOR_GLOBALS.onetrust.some((g) => globals[g])) add('onetrust', 'global:OneTrust');

  // Cookiebot
  if (/cookiebot\.com/i.test(scriptSrc)) add('cookiebot', 'script:cookiebot');
  if (reqHosts.some((h) => /cookiebot\.com/.test(h))) add('cookiebot', 'network:cookiebot.com');
  if (cookieNames.includes('CookieConsent') || ls.CookieConsent) add('cookiebot', 'storage:CookieConsent');

  // Didomi
  if (/didomi/i.test(scriptSrc) || reqHosts.some((h) => /didomi\.io/.test(h))) add('didomi', 'script/network:didomi');
  if (ls.didomi_token || cookieNames.some((n) => /didomi/i.test(n))) add('didomi', 'storage:didomi');
  if (globals.didomi) add('didomi', 'global:didomi');

  // Quantcast / TCF
  if (/quantcast/i.test(scriptSrc) || reqHosts.some((h) => /quantcast\.com/.test(h))) add('quantcast', 'script/network:quantcast');
  if (globals.__tcfapi) add('quantcast', 'TCF (__tcfapi)'); // only when truthy, not key-name present

  // Usercentrics
  if (/usercentrics/i.test(scriptSrc) || reqHosts.some((h) => /usercentrics\.eu/.test(h))) add('usercentrics', 'script/network:usercentrics');
  if (globals.usercentrics) add('usercentrics', 'global:usercentrics');

  // TrustArc
  if (/trustarc/i.test(scriptSrc) || reqHosts.some((h) => /trustarc\.com/.test(h))) add('trustarc', 'script/network:trustarc');

  // Sourcepoint
  if (/sourcepoint\.com|cf\.sourcepoint/.test(scriptSrc)) add('sourcepoint', 'script:sourcepoint');
  if (cookieNames.some((n) => /^eupubconsent/.test(n) || /^sp_/.test(n)) || ls.__cmp) add('sourcepoint', 'storage:sourcepoint-like');

  // Iubenda
  if (/iubenda\.com/.test(scriptSrc)) add('iubenda', 'script:iubenda');
  if (/cdn\.iubenda\.com\/cs\/|consent_solution/.test(scriptSrc)) add('iubenda', 'script:iubenda-consent-solution');
  if (ls.iubenda_consent || ls._iub_cs || ls.iubenda_cs) add('iubenda', 'storage:iubenda');

  // Resolve
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  let vendor;
  let overlay = null;
  if (ranked[0][1] > 0) {
    vendor = ranked[0][0];
  } else {
    // No CMP signal at all — distinguish "no CMP" from "unrecognized CMP with an overlay".
    overlay = await findOverlay(page);
    const consentHit = overlay.some(
      (h) => h.known || /onetrust|Cybot|quantcast|didomi|usercentrics|cookie|consent/i.test(`${h.id} ${h.cls}`)
    );
    vendor = consentHit ? 'unknown' : 'none';
  }

  return {
    vendor,
    score,
    evidence,
    overlay,
    scriptSrc: scriptSrc.split('\n').filter(Boolean).slice(0, 12),
    globals,
    reqHosts: reqHosts.slice(0, 30),
    cookieNames,
  };
}
