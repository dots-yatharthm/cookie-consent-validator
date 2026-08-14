// Report writers. Emits five artifacts per run:
//   report.html     — self-contained shareable report (matrix + defect tickets + compliance roll-up)
//   results.csv     — flat one-row-per-check table for the dev team / spreadsheets
//   results.json    — machine-readable (all cells + evidence + consent snapshots)
//   junit.xml       — CI integration
//   shots/          — screenshot evidence

import fs from 'fs';
import path from 'path';

export function writeReports(run, opts) {
  const outDir = run.outDir;
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(
    { meta: { ts: new Date().toISOString(), opts }, results: run.cells }, null, 2));

  fs.writeFileSync(path.join(outDir, 'results.csv'), csvReport(run));
  fs.writeFileSync(path.join(outDir, 'junit.xml'), junitXml(run));
  fs.writeFileSync(path.join(outDir, 'report.html'), reportHtml(run));

  return {
    resultsJson: path.join(outDir, 'results.json'),
    csv: path.join(outDir, 'results.csv'),
    junit: path.join(outDir, 'junit.xml'),
    html: path.join(outDir, 'report.html'),
  };
}

// ------------------------------------------------------------------ results.csv

// One flat row per check — the shareable artifact for the dev team. UTF-8 BOM so Excel renders
// ✅⚠️⏭ and non-ASCII consent payloads correctly; every field is RFC-4180 quoted.
function csvReport(run) {
  const header = ['site', 'url', 'browser', 'viewport', 'tc', 'title', 'priority', 'status',
    'defect_key', 'defect_title', 'severity', 'root_cause_hint',
    'failing_assertions', 'actions', 'evidence', 'skip_reason', 'screenshot', 'consent', 'notes', 'ms',
    'detection_vendor', 'detection_score', 'detection_script_src', 'detection_globals', 'detection_network_hosts', 'detection_cookies', 'detection_localstorage', 'detection_overlay'];
  const rows = run.cells.map((c) => {
    const failing = (c.assertions || []).filter((a) => !a.pass)
      .map((a) => `${a.name}: expected ${fmt(a.expected)} got ${fmt(a.actual)}`).join('; ');
    const actions = (c.steps || []).join(' → ');
    const evidence = (c.assertions || []).map((a) => a.pass
      ? `✓ ${a.name} (actual ${fmt(a.actual)})`
      : `✗ ${a.name} (expected ${fmt(a.expected)}, got ${fmt(a.actual)})`).join(' · ');

    // Detection evidence columns (only populated for TC-001)
    const notes = c.notes || {};
    const detectionVendor = c.tc === 'TC-001' ? (notes.evidence ? Object.keys(notes.evidence).find(k => notes.evidence[k]?.length > 0) || 'none' : 'none') : '';
    const detectionScore = c.tc === 'TC-001' ? JSON.stringify(notes.score || {}) : '';
    const detectionScriptSrc = c.tc === 'TC-001' ? (notes.scriptSrc || []).join('; ') : '';
    const detectionGlobals = c.tc === 'TC-001' ? Object.entries(notes.globals || {}).filter(([,v]) => v).map(([k]) => k).join('; ') : '';
    const detectionNetworkHosts = c.tc === 'TC-001' ? (notes.reqHosts || []).join('; ') : '';
    const detectionCookies = c.tc === 'TC-001' ? (notes.cookieNames || []).join('; ') : '';
    const detectionLocalStorage = c.tc === 'TC-001' ? (notes.localStorageKeys || []).join('; ') : '';
    const detectionOverlay = c.tc === 'TC-001' ? (c.consent?.overlay || 'none') : '';

    return [
      c.site, c.url, c.browser, c.vpName, c.tc, c.title, c.priority || '', c.status,
      c.defectKey || '', c.defectTitle || '', c.severity || '', c.rootCauseHint || '',
      failing, actions, evidence, c.skipReason || '', c.screenshots?.[c.screenshots.length - 1] || '',
      c.consent ? JSON.stringify(c.consent) : '', c.notes ? JSON.stringify(c.notes) : '', c.ms ?? '',
      detectionVendor, detectionScore, detectionScriptSrc, detectionGlobals, detectionNetworkHosts, detectionCookies, detectionLocalStorage, detectionOverlay,
    ];
  });
  const lines = [header, ...rows].map((r) => r.map(csvField).join(','));
  return '﻿' + lines.join('\n') + '\n';
}

function csvField(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ------------------------------------------------------------------ junit.xml

function junitXml(run) {
  const { cells } = run;
  const bySite = {};
  for (const c of cells) (bySite[c.site] ||= []).push(c);

  const suites = Object.entries(bySite).map(([siteId, cs]) => {
    const failures = cs.filter((c) => c.status === 'fail').length;
    const defects = cs.filter((c) => c.status === 'defect').length;
    const skipped = cs.filter((c) => c.status === 'skip').length;
    const cases = cs.map((c) => {
      const name = `${c.tc} ${c.browser} ${c.vpName}`;
      let inner = '';
      if (c.status === 'skip') {
        inner = `\n    <skipped message="${esc(c.skipReason)}"/>`;
      } else if (c.status === 'fail' || c.status === 'defect') {
        const failing = (c.assertions || []).filter((a) => !a.pass)
          .map((a) => `assertion '${a.name}': expected ${esc(a.expected)} got ${esc(a.actual)}`).join('; ');
        const msg = c.error || failing || (c.discovered || []).map((d) => d.message).join('; ');
        inner = `\n    <failure message="${esc(c.defectTitle || msg)}">${esc(msg)}\n    steps: ${esc((c.steps || []).join('; '))}\n    evidence: ${esc(JSON.stringify({ screenshots: c.screenshots, consent: c.consent }))}\n    </failure>`;
      }
      return `  <testcase classname="${esc(siteId)}" name="${esc(name)}" time="${((c.ms || 0) / 1000).toFixed(2)}">${inner}\n  </testcase>`;
    }).join('\n');
    return `  <testsuite name="${esc(siteId)}" tests="${cs.length}" failures="${failures}" errors="${defects}" skipped="${skipped}">\n${cases}\n  </testsuite>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites}\n</testsuites>\n`;
}

// ------------------------------------------------------------------ compliance roll-up

// Shared per-site compliance flags, derived from the matrix cells. Used by report.html.
function complianceFlags(site, cs) {
  const flag = (tcId, assertionName, wantPass = true) => {
    const cell = cs.find((c) => c.tc === tcId);
    if (!cell || cell.status === 'skip') return '—';
    const a = (cell.assertions || []).find((x) => x.name === assertionName);
    if (!a) return '—';
    return a.pass === wantPass ? '✅' : '❌';
  };
  const ptCell = cs.find((c) => c.tc === 'TC-009');
  return {
    banner: flag('TC-002', 'banner-visible-first-visit'),
    recorded: flag('TC-009', 'storage-cookie-present'),
    gated: flag('TC-004', 'no-trackers-after-reject'),
    reject: cs.find((c) => c.tc === 'TC-004' && c.status !== 'skip') ? '✅' : '—',
    preticked: !ptCell || ptCell.status === 'skip' ? '—'
      : cs.some((c) => c.tc === 'TC-009' && (c.anomalies || []).some((a) => a.key === 'PRE_TICKED')) ? '⚠️' : '✅',
    reopen: flag('TC-008', 'settings-reopenable'),
  };
}

// ------------------------------------------------------------------ report.html

// Self-contained, shareable single-file HTML report (the artifact ChatGPT-style scripts produce,
// plus the full matrix and compliance roll-up). No external assets — inline CSS only.
function reportHtml(run) {
  const { cells, sites } = run;
  const columns = [...new Set(cells.map((c) => `${c.browser}/${c.vpName}`))].sort();
  const count = (s) => cells.filter((c) => c.status === s).length;
  const cellCls = { pass: 'ok', fail: 'bad', defect: 'warn', skip: 'skip' };

  let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CMP Consent Suite — Report</title>
<style>
  body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;margin:0;background:#f4f6f8;color:#1a2433;}
  .wrap{max-width:1100px;margin:0 auto;padding:24px;}
  h1{font-size:22px;margin:0 0 4px;} h2{font-size:17px;margin:0 0 2px;}
  .muted{color:#6b7a8f;font-size:13px;margin-bottom:4px;}
  .chips{display:flex;gap:10px;margin:16px 0;flex-wrap:wrap;}
  .chip{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;font-size:12px;text-align:center;min-width:72px;}
  .chip b{display:block;font-size:18px;} .chip.pass b{color:#1a7f37;} .chip.fail b{color:#cf222e;} .chip.defect b{color:#9a6700;} .chip.skip b{color:#6b7a8f;}
  .site{background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin:18px 0;padding:16px 20px;}
  .url{color:#6b7a8f;font-size:12px;margin-bottom:12px;}
  table{border-collapse:collapse;width:100%;font-size:13px;}
  th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top;}
  th{background:#f8fafc;font-size:12px;}
  td.c{text-align:center;}
  .ok{background:#e6ffec;} .bad{background:#ffebe9;} .warn{background:#fff8c5;} .skip{background:#f6f8fa;color:#6b7a8f;}
  .defect-list{margin-top:14px;font-size:13px;} .defect-list ul{margin:8px 0 0;padding-left:20px;}
  .defect-list li{margin:6px 0;}
  .tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;margin-right:6px;vertical-align:1px;}
  .tag.high{background:#ffebe9;color:#cf222e;} .tag.medium{background:#fff8c5;color:#9a6700;} .tag.low{background:#e6ffec;color:#1a7f37;}
  .skip-list{margin-top:10px;font-size:12px;color:#6b7a8f;line-height:1.6;}
  footer{color:#6b7a8f;font-size:12px;margin:24px 0;text-align:center;}
  code{background:#f1f3f5;padding:1px 4px;border-radius:4px;font-size:12px;}
  td.clk{cursor:pointer;} td.clk:hover{outline:1px solid #8aa0b8;}
  .ev{padding:2px 6px;} .ev b{font-size:12px;} .ev ul{margin:4px 0 10px;padding-left:22px;}
  .ev li{margin:2px 0;font-size:12px;line-height:1.5;}
  .aok{color:#1a7f37;font-weight:600;} .abad{color:#cf222e;font-weight:600;}
  .ev .reason{margin:4px 0 6px;font-size:12px;} .ev .consent{margin-top:6px;font-size:11px;}
</style></head><body><div class="wrap">`;

  html += `<h1>CMP Consent Suite — Results</h1>
  <div class="muted">Run at ${new Date().toISOString()} · ${cells.length} checks · ${sites.map((s) => esc(s.name)).join(', ')}</div>
  <div class="chips">
    <div class="chip pass"><b>${count('pass')}</b>Pass</div>
    <div class="chip fail"><b>${count('fail')}</b>Fail</div>
    <div class="chip defect"><b>${count('defect')}</b>Defects</div>
    <div class="chip skip"><b>${count('skip')}</b>Skip</div>
  </div>`;

  for (const site of sites) {
    const siteCells = cells.filter((c) => c.site === site.id);
    const tcs = [...new Set(siteCells.map((c) => c.tc))].sort();
    html += `<div class="site"><h2>${esc(site.name)}</h2><div class="url">${esc(site.url)}</div>`;
    html += `<div class="muted" style="margin:6px 0 8px">Click any cell to expand the actions that check performed and the evidence behind its verdict.</div>`;
    html += `<table><tr><th>TC</th><th>Title</th>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
    for (const tcId of tcs) {
      const title = siteCells.find((c) => c.tc === tcId)?.title || '';
      const detailRows = [];
      const tds = columns.map((col) => {
        const c = siteCells.find((x) => x.tc === tcId && `${x.browser}/${x.vpName}` === col);
        if (!c) return '<td class="c skip">·</td>';
        const id = cellId(c);
        const label = c.status === 'skip' ? '⏭'
          : (c.status === 'defect' ? `⚠️${c.defectKey ? 'D' : 'D*'}` : { pass: '✅', fail: '❌' }[c.status]);
        detailRows.push(detailRow(c, id, columns.length));
        return `<td class="c clk ${cellCls[c.status]}" onclick="toggleDetail('${id}')" title="click for evidence">${label}</td>`;
      }).join('');
      html += `<tr><td>${tcId}</td><td>${esc(title)}</td>${tds}</tr>${detailRows.join('')}`;
    }
    html += `</table>`;

    const defects = siteCells.filter((c) => c.status === 'defect');
    if (defects.length) {
      const groups = new Map();
      for (const d of defects) {
        const key = d.defectKey || d.discovered?.map((x) => x.message).join('; ') || d.defectTitle || `${d.tc} ${d.title}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(d);
      }
      html += `<div class="defect-list"><b>Defects</b><ul>`;
      for (const list of groups.values()) {
        const d = list[0];
        const sev = (d.severity || 'medium').toLowerCase();
        const combos = [...new Set(list.map((x) => `${x.browser}/${x.vpName}`))].join(', ');
        const tcNote = [...new Set(list.map((x) => x.tc))].length > 1
          ? ` (also trips ${[...new Set(list.map((x) => x.tc))].slice(1).join(', ')})` : '';
        const shot = [...new Set(list.map((x) => x.screenshots?.[x.screenshots.length - 1]).filter(Boolean))][0];
        html += `<li><span class="tag ${sev}">${(d.severity || 'MEDIUM').toUpperCase()}</span><b>${esc(d.defectTitle)}</b><br>
          <span class="muted">${esc(d.tc)} ${esc(d.title)}${tcNote} · ${esc(combos)}</span>${d.rootCauseHint ? `<br>${esc(d.rootCauseHint)}` : ''}${shot ? ` · <code>${esc(shot)}</code>` : ''}</li>`;
      }
      html += `</ul></div>`;
    }

    const skips = siteCells.filter((c) => c.status === 'skip');
    if (skips.length) {
      html += `<div class="skip-list">Skipped: ${skips.map((s) => `${s.tc} (${s.browser}/${s.vpName}) — ${esc(s.skipReason)}`).join(' · ')}</div>`;
    }
    html += `</div>`;
  }

  // Compliance roll-up
  html += `<div class="site"><h2>Compliance roll-up</h2>
  <table><tr><th>Site</th><th>Banner</th><th>Consent recorded</th><th>Analytics gated</th><th>Reject available</th><th>Pre-ticked</th><th>Re-openable</th></tr>`;
  for (const site of sites) {
    const cs = cells.filter((c) => c.site === site.id);
    const f = complianceFlags(site, cs);
    html += `<tr><td>${esc(site.name)}</td><td class="c">${f.banner}</td><td class="c">${f.recorded}</td><td class="c">${f.gated}</td><td class="c">${f.reject}</td><td class="c">${f.preticked}</td><td class="c">${f.reopen}</td></tr>`;
  }
  html += `</table><div class="muted">✅ compliant · ❌ non-compliant · ⚠️ warning · — not applicable/declared</div></div>`;

  // Detection Evidence Section (per site, per browser)
  for (const site of sites) {
    const siteCells = cells.filter((c) => c.site === site.id);
    const browsers = [...new Set(siteCells.map((c) => c.browser))].sort();
    const detectionCells = siteCells.filter((c) => c.tc === 'TC-001');
    if (detectionCells.length) {
      html += `<div class="site"><h2>Detection Evidence — ${esc(site.name)}</h2>`;
      for (const browser of browsers) {
        const detCell = detectionCells.find((c) => c.browser === browser);
        if (!detCell) continue;
        const notes = detCell.notes || {};
        const evidence = notes.evidence || {};
        const score = notes.score || {};
        const scriptSrc = notes.scriptSrc || [];
        const reqHosts = notes.reqHosts || [];
        const globals = notes.globals || {};
        const overlay = detCell.anomalies?.find((a) => a.key === 'UNRECOGNIZED_CMP') ? detCell.anomalies.find((a) => a.key === 'UNRECOGNIZED_CMP').message : (detCell.consent?.overlay ? JSON.stringify(detCell.consent.overlay) : 'none');

        html += `<details style="margin:12px 0;border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#fafbfc;">
          <summary style="cursor:pointer;font-weight:600;font-size:13px;">Detection Details — ${esc(browser)} <span class="muted">(click to expand)</span></summary>
          <div style="margin-top:10px;font-size:12px;line-height:1.7;">
            <div style="margin-bottom:12px;"><b>Detected Vendor:</b> <code>${esc(detCell.notes?.evidence ? Object.keys(detCell.notes.evidence).find(k => detCell.notes.evidence[k].length > 0) : 'none') || 'none'}</code> · <b>Score:</b> ${esc(JSON.stringify(score))}</div>

            <div style="margin-bottom:10px;">
              <b>Script Sources (${scriptSrc.length}):</b>
              <ul style="margin:4px 0 0 18px;">${scriptSrc.map((s) => `<li><code>${esc(s)}</code></li>`).join('') || '<li class="muted">—</li>'}</ul>
            </div>

            <div style="margin-bottom:10px;">
              <b>Network Request Hosts (${reqHosts.length}):</b>
              <ul style="margin:4px 0 0 18px;">${reqHosts.map((h) => `<li><code>${esc(h)}</code></li>`).join('') || '<li class="muted">—</li>'}</ul>
            </div>

            <div style="margin-bottom:10px;">
              <b>Window Globals (${Object.keys(globals).length}):</b>
              <ul style="margin:4px 0 0 18px;">${Object.entries(globals).map(([k, v]) => `<li><code>${esc(k)}</code> = ${v ? '<span class="aok">true</span>' : '<span class="abad">false</span>'}</li>`).join('') || '<li class="muted">—</li>'}</ul>
            </div>

            <div style="margin-bottom:10px;">
              <b>All Cookies (first load, ${(detCell.notes?.cookieNames || []).length}):</b>
              <ul style="margin:4px 0 0 18px;">${(detCell.notes?.cookieNames || []).map((c) => `<li><code>${esc(c)}</code></li>`).join('') || '<li class="muted">—</li>'}</ul>
            </div>

            <div style="margin-bottom:10px;">
              <b>LocalStorage Keys (first load):</b>
              <ul style="margin:4px 0 0 18px;">${(detCell.notes?.localStorageKeys || []).map((k) => `<li><code>${esc(k)}</code></li>`).join('') || '<li class="muted">—</li>'}</ul>
            </div>

            <div style="margin-bottom:10px;">
              <b>Vendor Evidence (per-signal scores):</b>
              <pre style="background:#f1f3f5;padding:8px;border-radius:4px;font-size:11px;overflow:auto;max-height:200px;">${esc(JSON.stringify(evidence, null, 2))}</pre>
            </div>

            <div>
              <b>Overlay Findings:</b>
              <pre style="background:#f1f3f5;padding:8px;border-radius:4px;font-size:11px;overflow:auto;max-height:200px;">${esc(overlay)}</pre>
            </div>
          </div>
        </details>`;
      }
      html += `</div>`;
    }
  }

  html += `<footer>Generated by the CMP Consent Suite — screenshot evidence in <code>report/shots/</code>. Shareable table: <code>report/results.csv</code> · raw data: <code>report/results.json</code>.</footer>`;
  html += `<script>
function toggleDetail(id){var el=document.getElementById(id);if(!el)return;el.style.display=(el.style.display==='table-row'?'none':'table-row');}
</script>`;
  html += `</div></body></html>`;
  return html;
}

// ------------------------------------------------------------------ per-cell evidence

function cellId(c) {
  return `d-${c.site}-${c.tc}-${c.browser}-${c.vpName}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

// Human-readable verdict reason for a cell.
function cellReason(c) {
  const failing = (c.assertions || []).filter((a) => !a.pass);
  const failText = failing.map((a) => `${a.name}: expected ${fmt(a.expected)}, got ${fmt(a.actual)}`).join('; ');
  if (c.status === 'skip') return { label: 'Skipped', text: c.skipReason || 'not applicable' };
  if (c.status === 'fail') return { label: 'Failed', text: failText || c.error || 'unknown assertion failure' };
  if (c.status === 'defect') {
    const kind = c.defectKey ? `declared defect (${c.defectKey})` : 'runtime discovery (D*)';
    const hint = c.rootCauseHint ? ` — ${c.rootCauseHint}` : '';
    return {
      label: `Defect · ${(c.severity || 'medium').toUpperCase()} · ${kind}`,
      text: `${c.defectTitle || ''}${hint}${failText ? ` · Failing: ${failText}` : ''}`,
    };
  }
  return { label: 'Passed', text: `all ${(c.assertions || []).length} assertions passed` };
}

// Hidden full-width row beneath a TC row; toggled by clicking the matrix cell.
function detailRow(c, id, nCols) {
  const steps = (c.steps || []).map((s) => `<li>${esc(s)}</li>`).join('') || '<li>—</li>';
  const asserts = (c.assertions || []).map((a) => a.pass
    ? `<li class="aok">✓ ${esc(a.name)} — actual ${esc(fmt(a.actual))}</li>`
    : `<li class="abad">✗ ${esc(a.name)} — expected ${esc(fmt(a.expected))}, got ${esc(fmt(a.actual))}</li>`
  ).join('') || '<li>—</li>';
  const reason = cellReason(c);
  const anomalies = (c.anomalies || []).length
    ? ` · anomalies: ${esc(c.anomalies.map((a) => a.message).join('; '))}` : '';
  const consent = c.consent
    ? `<div class="consent">consent snapshot: <code>${esc(JSON.stringify(c.consent).slice(0, 240))}</code></div>` : '';

  // Element Verification: show what buttons/links were found and clicked
  const elementVerification = renderElementVerification(c);
  // Cookie Comparison Table for TC-004, TC-007, TC-009
  const cookieComparison = renderCookieComparison(c);

  return `<tr id="${id}" style="display:none"><td colspan="${nCols + 2}">
  <div class="ev">
    <b>Actions performed</b><ul>${steps}</ul>
    ${elementVerification}
    ${cookieComparison}
    <b>Evidence (assertions)</b><ul>${asserts}</ul>
    <div class="reason"><b>${esc(reason.label)}</b> — ${esc(reason.text)}</div>
    <div class="muted">${c.ms || 0} ms · ${c.requestCount ?? 0} network requests${anomalies}</div>
    ${consent}
  </div></td></tr>`;
}

function renderElementVerification(c) {
  const notes = c.notes || {};
  // For TC-002: bannerText
  if (c.tc === 'TC-002' && notes.bannerText) {
    return `<b>Element Verification</b><ul><li>Banner text captured: <code>${esc(notes.bannerText.slice(0, 200))}</code></li></ul>`;
  }
  // For TC-003: accept clicked
  if (c.tc === 'TC-003' && notes.clicked) {
    return `<b>Element Verification</b><ul><li>Accept button clicked: <code>${esc(notes.clicked)}</code></li></ul>`;
  }
  // For TC-004: reject clicked / via PC
  if (c.tc === 'TC-004' && notes.rejectVia) {
    return `<b>Element Verification</b><ul><li>Reject All via: <code>${esc(notes.rejectVia)}</code></li></ul>`;
  }
  // For TC-005: categories listed + toggled
  if (c.tc === 'TC-005' && notes.categories) {
    const cats = notes.categories;
    const toggled = notes.toggled;
    const catList = cats.map((cat) => `${cat.groupId} ${cat.name} ${cat.on ? 'ON' : 'OFF'}${cat.locked ? ' 🔒' : ''}${cat.hidden ? ' 🙈' : ''}`).join(', ');
    return `<b>Element Verification</b><ul><li>Categories in PC: ${esc(catList) || 'none'}</li>${toggled ? `<li>Toggled: ${esc(toggled.groupId)} ${esc(toggled.name)} → ${toggled.desired ? 'ON' : 'OFF'}</li>` : ''}</ul>`;
  }
  // For TC-006: categories
  if (c.tc === 'TC-006' && notes.categories) {
    const cats = notes.categories;
    const catList = cats.map((cat) => `${cat.groupId} ${cat.name} ${cat.on ? 'ON' : 'OFF'}${cat.locked ? ' 🔒' : ''}`).join(', ');
    return `<b>Element Verification</b><ul><li>Categories in PC: ${esc(catList) || 'none'}</li></ul>`;
  }
  // For TC-008: openedBy
  if (c.tc === 'TC-008' && notes.openedBy) {
    return `<b>Element Verification</b><ul><li>Settings re-opened via: <code>${esc(notes.openedBy)}</code></li></ul>`;
  }
  // For TC-010: dismissClicked
  if (c.tc === 'TC-010' && notes.dismissClicked !== undefined) {
    return `<b>Element Verification</b><ul><li>Dismiss (X) clicked: ${esc(notes.dismissClicked ? notes.dismissClicked : 'none — no control available')}</li></ul>`;
  }
  // For TC-011: banner rect
  if (c.tc === 'TC-011' && notes.rect) {
    const r = notes.rect;
    return `<b>Element Verification</b><ul><li>Banner rect: top=${esc(r.top)}px, bottom=${esc(r.bottom)}px, width=${esc(r.w)}px, viewport=${esc(r.vh)}px</li></ul>`;
  }
  // For TC-012: pageUsable details
  if (c.tc === 'TC-012' && notes.details) {
    const d = notes.details;
    return `<b>Element Verification</b><ul><li>Scroll locked: ${d.locked ? 'YES ⚠️' : 'No'}</li><li>Zombie overlay: ${d.zombie ? 'YES ⚠️' : 'No'}</li><li>Primary link reachable: ${d.linkReachable ? 'Yes' : 'NO ⚠️'}</li>${d.failures?.length ? `<li>Failures: ${esc(d.failures.join(', '))}</li>` : ''}</ul>`;
  }
  // For TC-013: Do-Not-Sell control location
  if (c.tc === 'TC-013' && notes.floating !== undefined) {
    return `<b>Element Verification</b><ul><li>Floating/settings link: ${notes.floating ? 'Found ✓' : 'Not found'}</li><li>PC group match: ${notes.pcMatch ? `${esc(notes.pcMatch.groupId)} ${esc(notes.pcMatch.name)}` : 'Not found'}</li></ul>`;
  }
  // For other TCs with consent.clicked
  if (c.consent?.clicked) {
    return `<b>Element Verification</b><ul><li>Element clicked: <code>${esc(c.consent.clicked)}</code></li></ul>`;
  }
  return '';
}

// Cookie-by-Cookie Comparison Table for TC-004 (reject), TC-007 (persistence), TC-009 (storage oracle)
function renderCookieComparison(c) {
  if (!['TC-004', 'TC-007', 'TC-009'].includes(c.tc)) return '';
  const notes = c.notes || {};
  const consent = c.consent || {};

  let beforeCookies = [];
  let afterCookies = [];
  let cookieTypeMap = {}; // name -> 'tracker' | 'consent' | 'other'

  if (c.tc === 'TC-004') {
    // TC-004: beforeTrackers and afterTrackers are in anomalies or notes
    // We can use the consent.before and after if available
    // For now, let's extract from anomalies if available
    beforeCookies = notes.beforeTrackers || [];
    afterCookies = notes.afterTrackers || [];
    // Classify cookies
    for (const cookie of [...beforeCookies, ...afterCookies]) {
      if (cookieTypeMap[cookie]) continue;
      if (/(_ga|_gid|_gat|_fbp|_fbc|_gcl|__utm|_hjid|_hjIncludedInSample|_parsely_visitor|_parsely_session|mp_|mixpanel|intercom|amplitude|segment|hotjar|optimizely|vwo|kissmetrics|chartbeat|clicky|woopra|gauges|piwik|matomo|adroll|criteo|doubleclick|googlesyndication|adsense|adnxs|rubicon|openx|pubmatic|appnexus|indexexchange|smaato|mopub|inmobi|unityads|applovin|chartboost|tapjoy|fyr|fys)/i.test(cookie)) {
        cookieTypeMap[cookie] = 'tracker ⚠️';
      } else if (/Optanon|AlertBoxClosed|cookieconsent|consent|gdpr|ccpa|ucData|ucString|CookieConsent/i.test(cookie)) {
        cookieTypeMap[cookie] = 'consent ✅';
      } else {
        cookieTypeMap[cookie] = 'other';
      }
    }
  } else if (c.tc === 'TC-007') {
    // TC-007: consent.beforeAccept and consent.afterReload
    if (consent.afterAccept?.cookieNames) afterCookies = consent.afterAccept.cookieNames;
    if (consent.afterReload?.cookieNames) afterCookies = [...new Set([...afterCookies, ...consent.afterReload.cookieNames])];
    // Use afterAccept as "before" reference
    beforeCookies = consent.afterAccept?.cookieNames || [];
    for (const cookie of [...beforeCookies, ...afterCookies]) {
      if (cookieTypeMap[cookie]) continue;
      if (/(_ga|_gid|_gat|_fbp|_fbc|_gcl|__utm|_hjid)/i.test(cookie)) {
        cookieTypeMap[cookie] = 'tracker';
      } else if (/Optanon|AlertBoxClosed/i.test(cookie)) {
        cookieTypeMap[cookie] = 'consent ✅';
      } else {
        cookieTypeMap[cookie] = 'other';
      }
    }
  } else if (c.tc === 'TC-009') {
    // TC-009: consent.preChoice and consent.afterAccept
    beforeCookies = consent.preChoice?.cookieNames || [];
    afterCookies = consent.afterAccept?.cookieNames || [];
    for (const cookie of [...beforeCookies, ...afterCookies]) {
      if (cookieTypeMap[cookie]) continue;
      if (/(_ga|_gid|_gat|_fbp|_fbc|_gcl|__utm|_hjid)/i.test(cookie)) {
        cookieTypeMap[cookie] = 'tracker';
      } else if (/Optanon|AlertBoxClosed|cookieconsent|consent|gdpr|ccpa|ucData|ucString|CookieConsent/i.test(cookie)) {
        cookieTypeMap[cookie] = 'consent ✅';
      } else {
        cookieTypeMap[cookie] = 'other';
      }
    }
  }

  const allCookies = [...new Set([...beforeCookies, ...afterCookies])];
  if (allCookies.length === 0) return '';

  const rows = allCookies.map((cookie) => {
    const before = beforeCookies.includes(cookie) ? 'present' : 'absent';
    const after = afterCookies.includes(cookie) ? 'present' : 'absent';
    const type = cookieTypeMap[cookie] || 'other';
    const change = before === after ? '' : (before === 'absent' ? ' <span class="abad">➕ added</span>' : ' <span class="aok">➖ removed</span>');
    return `<tr><td><code>${esc(cookie)}</code></td><td class="c">${esc(before)}</td><td class="c">${esc(after)}</td><td class="c">${esc(type)}</td><td class="c">${change}</td></tr>`;
  }).join('');

  return `<b>Cookie Comparison (before ↔ after)</b>
  <table style="margin-top:6px;font-size:11px;border-collapse:collapse;width:100%;">
    <tr style="background:#f8fafc;"><th style="border:1px solid #e2e8f0;padding:4px 6px;text-align:left;">Cookie</th><th class="c" style="border:1px solid #e2e8f0;padding:4px 6px;">Before</th><th class="c" style="border:1px solid #e2e8f0;padding:4px 6px;">After</th><th class="c" style="border:1px solid #e2e8f0;padding:4px 6px;">Type</th><th class="c" style="border:1px solid #e2e8f0;padding:4px 6px;">Change</th></tr>
    ${rows}
  </table>`;
}

// ------------------------------------------------------------------ helpers

function fmt(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).slice(0, 300);
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, ' ');
}
