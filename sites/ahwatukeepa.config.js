// Ahwatukee PA — OneTrust, full implementation. Custom CCPA Do-Not-Sell group (SPDTA_BG).
// Banner: "Do Not Sell or Share My Personal Information" / "Reject All Non-Essential Cookies"
// / "Accept All Cookies" + X. Consent persists (OptanonConsent cookie + localStorage mirror).

import { VIEWPORTS } from '../src/constants.js';

export default {
  id: 'ahwatukeepa',
  name: 'Ahwatukee PA',
  url: 'https://ahwatukeepa.com/',
  expectedVendor: 'onetrust',
  viewports: VIEWPORTS,
  labels: {
    accept: 'Accept All Cookies',
    reject: 'Reject All Non-Essential Cookies',
    manage: 'Manage Cookies',
    close: 'X',
    doNotSell: 'Do Not Sell or Share My Personal Information',
  },
  storage: {
    cookieNames: ['OptanonConsent', 'OptanonAlertBoxClosed'],
    localStorage: [],
    groups: ['C0001', 'C0002', 'C0003', 'C0004', 'SPDTA_BG'],
    strictGroup: 'C0001',
    requiresDecode: true,
  },
  // Observed live: this site's Accept All enables everything except C0003 (Functional) and
  // does enable SPDTA_BG (Do-Not-Sell) — data-driven expectation, not the generic default.
  acceptGroups: ['C0001', 'C0002', 'C0004', 'SPDTA_BG'],
  doNotSell: { label: 'Do Not Sell or Share My Personal Information', groupId: 'SPDTA_BG' },
  defects: {},
  geo: { lang: 'en-US' },
};
