// "No CMP" adapter. Every consent action is a no-op; the site is treated as consent-less.
// Used for sites like multidots — keeps TCs generic without special-casing their absence.

export function createNoneAdapter() {
  const noop = () => Promise.resolve({ clicked: null });
  return {
    vendor: 'none',
    capabilities: { banner: false, preferenceCenter: false, rejectOnBanner: false, doNotSell: false },
    isBannerVisible: async () => false,
    ensureBanner: async () => false,
    acceptAll: noop,
    rejectAll: noop,
    openManage: noop,
    dismiss: noop,
    openSettingsFromPage: noop,
    isPcOpen: async () => false,
    listCategories: async () => [],
    setCategory: async () => ({ ok: false, reason: 'no-cmp' }),
    savePreferences: noop,
    rejectInPc: noop,
    closePc: noop,
    readConsent: async () => ({
      persisted: false, alertBoxClosed: false, groups: null, enabled: [],
      raw: null, cookieNames: [], localStorageKeys: [], localStorageMirror: [],
    }),
  };
}
