// Site-config loader. Auto-discovers every `sites/*.config.js` so adding a new site is just a
// config file — no registry edits. Filtering (--sites) is applied by the CLI.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function loadSiteConfigs() {
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.config.js')).sort();
  const mods = await Promise.all(files.map((f) => import(path.join(__dirname, f))));
  return mods.map((m) => m.default);
}

export async function loadSites(filter) {
  let all = await loadSiteConfigs();
  if (filter) {
    const names = filter.split(',').map((s) => s.trim().toLowerCase());
    all = all.filter((s) => names.includes(s.id.toLowerCase()) || names.includes(s.name.toLowerCase()));
  }
  return all;
}
