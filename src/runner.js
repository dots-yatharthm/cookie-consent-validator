// Core runner. Expands site × browser × viewport × TC, runs each TC in a fresh isolated context
// (no cookie/localStorage bleed between accept/reject/manage/mobile paths), then aggregates
// verdicts. Also owns vendor detection (once per site×browser) and the declared-defect mapping
// plus runtime-discovery of new anomalies.

import { chromium, firefox } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { DEFAULT_BROWSERS, VIEWPORTS, USER_AGENT } from './constants.js';
import { sleep } from './dom.js';
import { detectVendor } from './detect/vendor-detector.js';
import { createAdapter } from './adapters/index.js';
import { TCS } from './tcs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');

const ENGINES = { chromium, firefox };

// ------------------------------------------------------------------ helpers

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push((async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

function evalApplicability(tc, site, adapter, vp) {
  try {
    return tc.applicable(site, adapter, vp);
  } catch (e) {
    return { ok: false, reason: `applicability error: ${e.message}` };
  }
}

// Final verdict: declared-defect override, then runtime-discovered anomalies.
function finalizeResult(raw, site) {
  const assertions = raw.assertions || [];
  const failing = assertions.filter((a) => !a.pass).map((a) => a.name);

  let status = failing.length ? 'fail' : 'pass';
  let defectKey = null, defectTitle = null, severity = null, rootCauseHint = null, discovered = null;

  for (const [key, def] of Object.entries(site.defects || {})) {
    if (def.matchAssertions?.some((n) => failing.includes(n))) {
      status = 'defect';
      defectKey = key;
      defectTitle = def.title;
      severity = def.severity || 'medium';
      rootCauseHint = def.rootCauseHint || null;
      break;
    }
  }

  if (status !== 'defect') {
    const high = (raw.anomalies || []).filter((a) => a.severity === 'high' && !(site.defects && site.defects[a.key]));
    if (high.length) {
      status = 'defect';
      discovered = high;
      defectTitle = high.map((a) => a.message).join('; ');
      severity = 'high';
    }
  }

  return { status, defectKey, defectTitle, severity, rootCauseHint, discovered, failing };
}

// ------------------------------------------------------------------ evidence step log

// Adapter methods worth logging as evidence steps. Read-only probes that are called repeatedly
// (isBannerVisible / isPcOpen) are excluded — the assertions already capture their outcome.
const LOGGED_ADAPTER_METHODS = new Set([
  'ensureBanner', 'acceptAll', 'rejectAll', 'openManage', 'openSettingsFromPage',
  'savePreferences', 'setCategory', 'closePc', 'dismiss', 'rejectInPc',
  'listCategories', 'readConsent',
]);

/** Human-readable one-line summary of an adapter call, for the per-check evidence log. */
function describeAction(prop, args, r) {
  if (prop === 'readConsent') {
    const enabled = (r && r.enabled) || [];
    const cookies = (r && r.cookieNames) || [];
    return `readConsent → persisted=${!!(r && r.persisted)}, enabled=[${enabled.join(', ')}]${cookies.length ? `, cookies=[${cookies.join(', ')}]` : ''}`;
  }
  if (prop === 'setCategory') {
    return `setCategory(${args[1] ? 'on' : 'off'}, ${args[0]}) → ${r && r.ok ? 'toggled' : `failed${r && r.reason ? `: ${r.reason}` : ''}`}`;
  }
  if (prop === 'listCategories') {
    const cats = Array.isArray(r) ? r : [];
    return `listCategories → ${cats.length} group(s)${cats.length ? `: ${cats.map((c) => `${c.name}${c.on ? '✓' : ''}${c.locked ? '🔒' : ''}`).join(', ')}` : ''}`;
  }
  if (prop === 'ensureBanner') return `ensureBanner → ${r ? 'banner shown' : 'no banner found'}`;
  if (prop === 'dismiss' || prop === 'openSettingsFromPage') {
    if (r && r.clicked) return `${prop} → clicked ${r.clicked}`;
    if (r && r.available === false) return `${prop} → no control available on this CMP`;
    return `${prop} → nothing clicked`;
  }
  if (r && r.clicked) return `${prop} → clicked ${r.clicked}`;
  if (r && r.ok === false) return `${prop} → failed${r.reason ? `: ${r.reason}` : ''}`;
  if (typeof r === 'object' && r !== null) return `${prop} → ${JSON.stringify(r).slice(0, 120)}`;
  return `${prop} → ${String(r)}`;
}

/**
 * Wrap an adapter so every logged action method records an evidence step with its result.
 * Methods are invoked with `this` = the real adapter (internal calls like
 * `this.listCategories` inside savePreferences stay un-logged; only the outer call shows).
 */
function makeLoggingAdapter(adapter, step) {
  return new Proxy(adapter, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v !== 'function' || !LOGGED_ADAPTER_METHODS.has(prop)) return v;
      return async (...args) => {
        const r = await v.apply(t, args);
        try { step(describeAction(prop, args, r)); } catch (e) { /* logging must never break a TC */ }
        return r;
      };
    },
  });
}

// ------------------------------------------------------------------ detection

async function runDetection(browser, site, opts) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: site.geo?.lang || 'en-US',
    timezoneId: site.geo?.timezone,
    userAgent: USER_AGENT,
  });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r));
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(3000);
    return await detectVendor(page, ctx, { requests });
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ------------------------------------------------------------------ per TC

async function runTC(browser, site, adapter, detection, browserName, vp, tc, opts, outDir) {
  const t0 = Date.now();
  const steps = [];
  const step = (msg) => steps.push(msg);
  const base = {
    site: site.id, url: site.url, browser: browserName,
    viewport: `${vp.width}x${vp.height}`, vpName: vp.name,
    tc: tc.id, title: tc.title, priority: tc.priority,
  };

  const app = evalApplicability(tc, site, adapter, vp);
  if (!app.ok) {
    return { ...base, status: 'skip', skipReason: app.reason, ms: Date.now() - t0, assertions: [], anomalies: [], screenshots: [] };
  }

  const screenshots = [];
  const shot = async (name, page) => {
    if (opts.screenshots === false) return null;
    const rel = `shots/${site.id}-${browserName}-${vp.name}-${tc.id}-${name}.png`;
    const abs = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await page.screenshot({ path: abs }).catch(() => {});
    screenshots.push(rel);
    steps.push(`screenshot → ${rel}`);
    return rel;
  };

  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    locale: site.geo?.lang || 'en-US',
    timezoneId: site.geo?.timezone,
    userAgent: USER_AGENT,
  });
  const page = await ctx.newPage();
  const watcher = { phase: 'load', requests: [] };
  page.on('request', (r) => watcher.requests.push({ url: r.url().slice(0, 200), phase: watcher.phase }));
  const env = {
    site, adapter: makeLoggingAdapter(adapter, step), detection, page, ctx, browserName, vp,
    shot, step, steps, log: { phase: (p) => { watcher.phase = p; } },
  };

  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => { env.gotoError = e.message; });
    await sleep(2000);
    const raw = await tc.run(env);
    // Runtime N/A: the adapter may discover the behavior is untestable mid-run (e.g. a banner
    // with no dismiss button). Record it as a skip, not a failure.
    if (raw.skipReason) {
      return {
        ...base,
        status: 'skip', skipReason: raw.skipReason,
        assertions: raw.assertions || [], anomalies: raw.anomalies || [],
        consent: raw.consent || {}, notes: raw.notes || {},
        screenshots, steps, ms: Date.now() - t0,
      };
    }
    const final = finalizeResult(raw, site);
    return {
      ...base,
      ...final,
      assertions: raw.assertions || [],
      anomalies: raw.anomalies || [],
      consent: raw.consent || {},
      notes: raw.notes || {},
      screenshots,
      steps,
      requestCount: watcher.requests.length,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      ...base,
      status: 'fail',
      failing: ['uncaught-error'],
      error: e.message,
      assertions: [], anomalies: [{ key: 'UNCAUGHT', severity: 'high', message: e.message }],
      screenshots, steps,
      ms: Date.now() - t0,
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ------------------------------------------------------------------ per site×browser

async function runSiteBrowser(site, browserName, opts, outDir) {
  const browser = await ENGINES[browserName].launch({
    headless: !opts.headed,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const results = [];
  try {
    const detection = await runDetection(browser, site, opts);
    const adapter = createAdapter(detection.vendor, site);
    const viewports = opts.viewports && opts.viewports.length ? opts.viewports : site.viewports || VIEWPORTS;
    const tcs = opts.tcFilter && opts.tcFilter.length ? TCS.filter((t) => opts.tcFilter.includes(t.id)) : TCS;

    for (const vp of viewports) {
      for (const tc of tcs) {
        results.push(await runTC(browser, site, adapter, detection, browserName, vp, tc, opts, outDir));
      }
    }
    return { site: site.id, browser: browserName, detection, results };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ------------------------------------------------------------------ entry

/**
 * @param {Array} sites     loaded site configs
 * @param {Object} opts     { browsers?, viewports?, tcFilter?, headed?, workers?, out?, screenshots? }
 * @returns {Promise<{cells: Array, sites: Array, combos: Array}>}
 */
export async function runMatrix(sites, opts) {
  const outDir = path.join(ROOT, opts.out || 'report');
  fs.mkdirSync(outDir, { recursive: true });

  const browsers = opts.browsers && opts.browsers.length ? opts.browsers : DEFAULT_BROWSERS;
  const combos = [];
  for (const site of sites) for (const browser of browsers) combos.push({ site, browser });

  const comboResults = await mapLimit(combos, opts.workers || 4, ({ site, browser }) =>
    runSiteBrowser(site, browser, opts, outDir));

  const cells = comboResults.flatMap((c) => c.results);
  return { cells, sites, combos: comboResults, outDir };
}
