// Multidots — NO CMP installed. Only Iubenda badge embeds (privacy/cookie policy *links*,
// not the consent-solution script). Tracking cookies load unconditionally.

import { VIEWPORTS } from '../src/constants.js';

export default {
  id: 'multidots',
  name: 'Multidots',
  url: 'https://multidots.com/',
  expectedVendor: 'none',
  viewports: VIEWPORTS,
  labels: { accept: null, reject: null, manage: null, close: null, doNotSell: null },
  storage: { cookieNames: [], localStorage: [], groups: [], strictGroup: null, requiresDecode: true },
  doNotSell: null,
  defects: {},
  geo: { lang: 'en-US' },
};
