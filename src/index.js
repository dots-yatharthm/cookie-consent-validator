#!/usr/bin/env node
// CLI entry. Examples:
//   npm test                                        # full matrix, all sites
//   npm test -- --sites ahwatukeepa,adient          # restrict sites
//   npm test -- --tc 001,003,009 --browsers chromium --viewports desktop   # quick subset
//   npm test -- --url https://newness.example       # discovery: detect vendor, run everything

import { VIEWPORTS } from './constants.js';
import { loadSites } from '../sites/index.js';
import { runMatrix } from './runner.js';
import { writeReports } from './report/writer.js';
import { printSummary } from './report/console.js';

const USAGE = `CMP Consent Suite — validate cookie-consent CMPs across sites.

Usage:
  node src/index.js [options]

Options:
  --sites <id1,id2>      Restrict to site config ids in sites/ (default: all)
  --browsers <list>      chromium,firefox (default: chromium, firefox)
  --viewports <list>     desktop,mobile (default: both)
  --tc <list>            Test cases, e.g. 001,003,009 or TC-001,TC-003 (default: all)
  --url <url>            Discovery mode: probe an arbitrary site, detect the CMP, run the suite
  --name <id>            Site id/name for --url discovery mode (default: hostname)
  --workers <n>          Parallel site/browser workers (default: 4)
  --headed               Run browsers headed (default: headless)
  --no-screenshots       Do not capture screenshots
  --out <dir>            Output directory (default: report/)
  --help                 Show this help and exit

Outputs (in --out dir): report.html (shareable), results.csv (spreadsheet), results.json (raw),
                        junit.xml (CI), shots/ (screenshot evidence)`;

function parseArgs(argv) {
  const opts = { sites: null, browsers: null, viewports: null, tc: null, url: null, name: null, headed: false, workers: 4, out: null, screenshots: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--headed') { opts.headed = true; continue; }
    if (a === '--no-screenshots') { opts.screenshots = false; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > -1 ? a.slice(2, eq) : a.slice(2);
      const value = eq > -1 ? a.slice(eq + 1) : argv[++i];
      if (key === 'sites' || key === 'browsers' || key === 'viewports' || key === 'tc' || key === 'url' || key === 'name' || key === 'out') opts[key] = value;
      if (key === 'workers') opts.workers = parseInt(value, 10) || 4;
    }
  }
  return opts;
}

function discoverySite(url, name) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  return {
    id: name || host.replace(/[^a-z0-9]/gi, '-'),
    name: name || host,
    url,
    expectedVendor: null, // auto-detect; TCs adapt to whatever is found
    viewports: VIEWPORTS,
    labels: { accept: null, reject: null, manage: null, close: null, doNotSell: null },
    storage: { cookieNames: [], localStorage: [], groups: [], strictGroup: null, requiresDecode: true },
    doNotSell: null,
    defects: {},
    geo: { lang: 'en-US' },
    discovery: true,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); return; }

  const sites = opts.url ? [discoverySite(opts.url, opts.name)] : await loadSites(opts.sites);
  if (!sites.length) {
    console.error('No sites matched. Run without --sites, or pass --sites <id1>,<id2>.');
    process.exit(1);
  }

  opts.browsers = opts.browsers ? opts.browsers.split(',').map((s) => s.trim()).filter(Boolean) : null;
  opts.viewports = opts.viewports ? opts.viewports.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
  if (opts.viewports) opts.viewports = VIEWPORTS.filter((v) => opts.viewports.includes(v.name));
  opts.tcFilter = opts.tc ? opts.tc.split(',').map((s) => (s.trim().toUpperCase().startsWith('TC-') ? s.trim().toUpperCase() : `TC-${s.trim().padStart(3, '0')}`)) : null;

  const cfg = opts.viewports?.length ? opts.viewports.map((v) => v.name).join(', ') : 'desktop, mobile';
  const tc = opts.tcFilter ? opts.tcFilter.join(', ') : 'TC-001…TC-013';
  const br = opts.browsers ? opts.browsers.join(', ') : 'chromium, firefox';
  console.log(`CMP Consent Suite — sites: ${sites.map((s) => s.id).join(', ')} | browsers: ${br} | viewports: ${cfg} | TCs: ${tc} | workers: ${opts.workers}`);

  const run = await runMatrix(sites, opts);
  const files = writeReports(run, opts);
  printSummary(run);

  const stats = { pass: 0, fail: 0, defect: 0, skip: 0 };
  for (const c of run.cells) stats[c.status] = (stats[c.status] || 0) + 1;
  console.log(`\nReports: ${files.html}\n         ${files.csv}\n         ${files.resultsJson}`);
  if (stats.fail > 0) {
    console.error(`\n${stats.fail} check(s) FAILED — see ${files.html} for details.`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
