// Adient — OneTrust v6.36 (legacy template: .ot-cat-item / .ot-accordion-layout, not .ot-cat-grp).
// Banner: "Cookie Settings" / "Reject All" / "Accept All Cookies" + X. Compliance issue: GA
// cookies (_ga, _ga_7LX0BMNN4M) fire AFTER Reject All (AutoBlock not configured); C0002
// (Performance/Analytics) defaults to on before any choice.

import { VIEWPORTS } from '../src/constants.js';

export default {
  id: 'adient',
  name: 'Adient',
  url: 'https://www.adient.com/',
  expectedVendor: 'onetrust',
  viewports: VIEWPORTS,
  labels: {
    accept: 'Accept All Cookies',
    reject: 'Reject All',
    manage: 'Cookie Settings',
    close: 'X',
    doNotSell: null, // no Do-Not-Sell control present on the live page (probed)
  },
  storage: {
    cookieNames: ['OptanonConsent', 'OptanonAlertBoxClosed'],
    localStorage: [],
    groups: ['C0001', 'C0002', 'C0003', 'C0004'],
    strictGroup: 'C0001',
    requiresDecode: true,
  },
  doNotSell: null,
  defects: {
    analyticsFireAfterReject: {
      matchAssertions: ['no-trackers-after-reject'],
      severity: 'high',
      title: 'Analytics cookies fire after Reject All',
      rootCauseHint: 'OneTrust AutoBlock not configured for Google Analytics on this v6.36 template — the GA snippet is not gated on consent.',
    },
    settingsNotReopenable: {
      matchAssertions: ['settings-reopenable'],
      severity: 'medium',
      title: 'Consent settings cannot be re-opened after Accept All — the only "Cookie Settings" control (#onetrust-pc-btn-handler / .cookie-setting-link) collapses to 0×0 once the banner closes, and there is no floating button or persistent footer control',
      rootCauseHint: 'OneTrust v6.36 template configured without a persistent settings trigger (no #ot-sdk-btn-floating). Add a header/footer "Cookie Settings" link wired to OneTrust.ToggleInfoDisplay(), or enable the floating button.',
    },
  },
  geo: { lang: 'en-US' },
};
