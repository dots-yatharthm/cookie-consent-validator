// JNCB MD staging — OneTrust. UI renders (bottom-left card) but consent is NEVER persisted on
// any action (accept / PC save / PC reject-all all write no OptanonConsent). No Reject button on
// the banner — rejection exists only inside the preference center (.ot-pc-refuse-all-handler).

import { VIEWPORTS } from '../src/constants.js';

export default {
  id: 'jncb-staging',
  name: 'JNCB MD Staging',
  url: 'https://jncb.md-staging.com/',
  expectedVendor: 'onetrust',
  viewports: VIEWPORTS,
  rejectOnBanner: false, // no "Reject All" on the banner — reject via PC fallback
  labels: {
    accept: 'Accept All Cookies',
    reject: null,
    manage: 'Manage Cookies',
    close: 'X',
    doNotSell: null,
  },
  storage: {
    cookieNames: ['OptanonConsent', 'OptanonAlertBoxClosed'],
    localStorage: ['OptanonConsent'],
    groups: ['C0001', 'C0002', 'C0003', 'C0004'],
    strictGroup: 'C0001',
    requiresDecode: true,
  },
  doNotSell: null,
  defects: {
    consentNotPersisted: {
      matchAssertions: [
        'consent-storage-written', 'storage-cookie-present', 'storage-groups-decodable',
        'storage-groups-match-accept', 'persist-after-reload', 'storage-identical-after-reload',
        'banner-suppressed-after-reload', 'groups-match-accept', 'groups-match-partial',
        'groups-reject-only-strict', 'mobile-accept-works', 'alert-box-closed-recorded',
        'storage-localstorage-mirror',
      ],
      severity: 'high',
      title: 'Consent choice is never persisted — no OptanonConsent written on any action',
      rootCauseHint: 'OneTrust UI renders and responds, but the SDK never writes OptanonConsent/OptanonAlertBoxClosed. Check the cookie-domain/secure config and whether the consent server profile is active on this staging instance.',
    },
  },
  geo: { lang: 'en-US' },
};
