// Console tree + summary. Prints site → browser/viewport → TC verdicts, then the compliance roll-up.

const CO = {
  pass: '\x1b[32mPASS\x1b[0m', fail: '\x1b[31mFAIL\x1b[0m',
  defect: '\x1b[33mDEFECT\x1b[0m', skip: '\x1b[90mskip\x1b[0m',
};

export function printSummary(run) {
  const { cells, combos } = run;
  const bySite = {};
  for (const c of cells) (bySite[c.site] ||= []).push(c);

  for (const [siteId, cs] of Object.entries(bySite)) {
    const site = run.sites.find((s) => s.id === siteId);
    const det = combos.find((cb) => cb.site === siteId)?.detection;
    console.log(`\n${site.name} (${site.url}) — vendor: ${det?.vendor || '?'}`);
    const byCell = {};
    for (const c of cs) (byCell[`${c.browser}/${c.vpName}`] ||= []).push(c);
    for (const [cell, cellCs] of Object.entries(byCell)) {
      console.log(`  ${cell}`);
      for (const c of cellCs) {
        const tag = c.status === 'defect'
          ? (c.discovered ? 'D*' : (c.defectKey || 'D'))
          : c.status === 'skip' ? `(${c.skipReason})` : '';
        console.log(`    ${c.tc} ${CO[c.status] || c.status}${tag ? ` ${tag}` : ''}  ${c.title}`);
      }
    }
  }

  const counts = { pass: 0, fail: 0, defect: 0, skip: 0 };
  for (const c of cells) counts[c.status] = (counts[c.status] || 0) + 1;
  const discovered = cells.filter((c) => c.discovered && c.discovered.length);
  console.log(`\nTOTAL: ${cells.length} checks — ${counts.pass} pass · ${counts.fail} fail · ${counts.defect} defect · ${counts.skip} skip`);
  if (discovered.length) {
    console.log(`NEWLY DISCOVERED (not in any site profile):`);
    for (const d of discovered) for (const a of d.discovered) console.log(`  • ${d.site}/${d.browser}/${d.vpName} ${d.tc}: ${a.message}`);
  }
  const defCells = cells.filter((c) => c.status === 'defect');
  if (defCells.length) console.log(`Defects logged — see report.html (defect tickets)`);
  console.log(`Reports written to ${run.outDir}/ (report.html, results.csv, results.json, junit.xml, shots/)`);
}
