// Shared constants: device matrix, CMP text patterns, overlay selectors, tracker heuristics.

export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'mobile',  width: 390,  height: 844, isMobile: true,  hasTouch: true },
];

export const DEFAULT_BROWSERS = ['chromium', 'firefox'];

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Text heuristics used for vendor-agnostic (generic-adapter) matching. Scoped to consent
// containers only — never a page-wide search (avoids matching page CTAs).
export const CONSENT_RE = /cookie|consent|privacy|gdpr|ccpa|data protection/i;
// \bok\b — a bare "ok" would match the substring inside "Cookie"/"Cookies" and let a
// footer "Cookie Policy" link win over the real Accept button (shortest-label sort).
export const ACCEPT_RE  = /accept|agree|allow all|allow everything|\bok\b|got it|i understand|i accept|yes, i|allow/i;
// "only essential / required cookies" covers Usercentrics' deny button ("Required Cookies Only").
export const REJECT_RE  = /reject|decline|deny|no thanks|not now|only essential|only necessary|continue without|reject all|required cookies|only required/i;
export const MANAGE_RE  = /manage|preferences|settings|learn more|show options|more options|customize|customise|cookie settings|show details/i;
export const CONFIRM_RE = /confirm|save|allow selection|allow selected|accept selected|agree to selected|update/i;

// IDs that are unambiguous consent overlays (used to rank / filter overlay hits).
export const KNOWN_BANNER_IDS = [
  'onetrust-banner-sdk', 'onetrust-pc-sdk', 'CybotCookiebotDialog', 'CybotCookiebotDialogBodyContent',
  'quantcast-choice', 'didomi-host', 'usercentrics-root', 'consent_blackbar',
];

// Every selector class a consent overlay could match. Detection + UI-verification share this list.
export const OVERLAY_SELECTORS = [
  '#onetrust-banner-sdk',
  '#onetrust-pc-sdk',
  '#CybotCookiebotDialog',
  '#CybotCookiebotDialogBodyContent',
  '#quantcast-choice',
  '#didomi-host',
  '#usercentrics-root',
  '#consent-banner',
  '#consent_blackbar',
  '#cookie-notice',
  '#cookie-notification',
  '#cm-cookie-notice',
  '#__tealiumGDPRecovery',
  '#trustarc-banner-wrapper',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[aria-label*="cookie" i]',
  '[aria-label*="consent" i]',
  '[id*="onetrust" i]',
  '[id*="cookielaw" i]',
  '[id*="cookie-banner" i]',
  '[id*="cookiebanner" i]',
  '[id*="consent-banner" i]',
  '[class*="onetrust-banner" i]',
  '[class*="cookie-banner" i]',
  '[class*="cookiebanner" i]',
  '[class*="consent-banner" i]',
  '[class*="cookie-notice" i]',
];

// Shadow-DOM hosts some CMPs render into. page-context querySelectorAll cannot pierce an
// open shadow root, so elements matched here are scanned INSIDE their shadowRoot by
// findOverlay / clickScoped / elShown. Usercentrics v4 renders in <aside id="usercentrics-cmp-ui">
// (host element itself is 0-sized); older Usercentrics WebSDK used #usercentrics-root.
export const SHADOW_HOST_SELECTORS = [
  '#usercentrics-cmp-ui',
  '#usercentrics-root',
  '[id*="usercentrics" i]',
  '[class*="usercentrics" i]',
  '[id*="consent-cmp" i]',
  'uc-cmp-ui',
  'uc-consent-banner',
  'uc-cmp',
  'klaro',
  'cookie-consent',
  'consent-manager',
];

// Known third-party / analytics tracker cookie names. Used by the "no trackers after reject" oracle.
export const TRACKER_COOKIE_RE =
  /^_ga$|^_ga_|^_gid$|^_gat$|^_gcl|^_fbp$|^_fbcl|^_uetsid|^_uetvid|^_hjid|^_hjSession|^__qca|^_pin_unauth|^IDE$|^NID$|^_parc_|^li_s|^bcookie|^_mkto_trk$|^ads_prefs|^personalization_id|^AnalyticsSyncHistory|^t_gid$|^_schn|^_cc_|^_uetsid|^_gcl_|^_gcl_aw/i;
