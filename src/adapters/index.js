// Adapter factory. Tests never touch vendor internals — they bind whatever adapter detection
// returns and drive it through the shared interface. Adding a vendor = new adapter, zero test
// changes.

import { createOneTrustAdapter } from './onetrust.js';
import { createUsercentricsAdapter } from './usercentrics.js';
import { createGenericAdapter } from './generic.js';
import { createNoneAdapter } from './none.js';

export function createAdapter(vendor, site) {
  if (vendor === 'onetrust') return createOneTrustAdapter(site);
  if (vendor === 'usercentrics') return createUsercentricsAdapter(site);
  if (vendor === 'none') return createNoneAdapter();
  return createGenericAdapter(site);
}
