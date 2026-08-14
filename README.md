# Cookie Consent Tester

A **vendor-agnostic Playwright test suite** for validating **cookie-consent management platforms (CMPs)**. For any site it:

1. detects whether a consent-management platform (CMP) is present and **which vendor** it is,
2. if present, executes **13 test cases** (TC-001…TC-013) against the live popup — accept, reject, manage preferences, close-without-save, reload-persistence, re-open settings, dismiss, mobile parity, page usability, Do-Not-Sell,
3. verifies every action with **two independent oracles** — the *storage* layer (consent cookie/localStorage actually written with the right groups) **and** the *UI* layer (banner gone, page usable),
4. reports results as a **dev-actionable, structured report** (HTML, CSV, JSON, JUnit) with screenshots and root-cause hints for each defect.

It ships with profiles for 4 sites and can probe **any** URL in discovery mode.

---

## 1. Requirements

- **Node.js 20+** and `npm`
- **Playwright** (installed via `npm install`) and its **browser binaries** (installed via `npx playwright install chromium firefox`)

## 2. Install

```bash
cd "cookie-consent-tester"
npm install                 # installs playwright
npx playwright install chromium firefox   # downloads the browser engines
```

## 3. Run it

| Command | What it does |
|---|---|
| `npm test` | Full matrix: **all sites × chromium + firefox × desktop + mobile × 13 TCs** |
| `npm run smoke` | Quick subset: ahwatukeepa, TCs 001–004,009, chromium, desktop |
| `npm run smoke:all` | Subset across 3 sites (adient, ahwatukeepa, jncb-staging), both browsers, both viewports, TCs 001–004,009 |
| `node src/index.js --sites adient,jncb-staging` | Restrict to specific sites |
| `node src/index.js --tc 001,003,009` | Restrict to specific test cases |
| `node src/index.js --browsers firefox --viewports mobile` | Restrict to a browser / viewport |
| `node src/index.js --url https://any-site.com` | **Discovery mode** — probe a site not in the config: detect the CMP, run all applicable TCs, zero config |
| `node src/index.js --url https://any-site.com --headed --workers 1` | Discovery mode **with the browser visible** — watch the script drive the popup live |
| `node src/index.js --headed` | Any run with visible browsers (good for debugging; default is headless) |
| `node src/index.js --workers 1` | Run one site/browser at a time (calmest mode, also needed with `--headed` for multiple sites) |
| `node src/index.js --out ./my-report` | Write reports to a different directory |
| `node src/index.js --no-screenshots` | Skip screenshot capture |
| `node src/index.js --help` | Print all flags |

**Examples**

```bash
# Full audit of all configured sites
npm test

# Watch one site run, like a live demo
node src/index.js --url https://ahwatukeepa.com/ --headed --workers 1

# Check a brand-new site for consent problems
node src/index.js --url https://some-company.com/
```

## 4. What you get (output)

All reports are written to `report/` (or your `--out` dir).

> **Note:** `report/` is git-ignored. It is regenerated on every run, so the directory may be empty after a fresh clone.

| File | Purpose |
|---|---|
| `report.html` | **Shareable single-file report** — colored matrix, defect tickets, compliance roll-up. **Click any matrix cell to expand the actions that check performed, the element verification (buttons/links found + clicked, cookie comparison), and the evidence (assertions + reason) behind its verdict.** Also includes a **Detection Evidence** section (per site/browser) showing script sources, network hosts, window globals, cookies, localStorage keys, vendor score, and overlay findings. Open in any browser or send to the team. |
| `results.csv` | **Flat table for the dev team** — one row per check (site, browser, viewport, TC, status, defect, failing assertion, action log, evidence, skip reason, screenshot, consent, **plus detection evidence columns**: vendor, score, scriptSrc, globals, network hosts, cookies, localStorage keys). Opens in Excel / Google Sheets / any parser. |
| `results.json` | Machine-readable: every cell with assertions, consent snapshots, screenshots, and full detection evidence. |
| `junit.xml` | CI integration (Jenkins / GitLab / Azure Pipelines can ingest). |
| `shots/` | Screenshots captured at each key step (banner, after-accept, preference center, failures). |

### Reading a verdict

| Verdict | Meaning |
|---|---|
| ✅ **PASS** | The TC's assertions held on both oracles. |
| ❌ **FAIL** | An assertion failed and it is **not** a known/declared defect — something new to investigate. |
| ⚠️ **DEFECT** (D) | A **declared** defect from the site profile matched the failure (known issue, ticket attached). |
| ⚠️ **DEFECT** (D*) | A **runtime discovery** — high-severity anomaly not declared anywhere (new issue the suite found). |
| ⏭ **SKIP** | Not applicable (no CMP, mobile-only case on desktop, no Do-Not-Sell control, etc.). |

### Report sections

| Section | What it shows |
|---|---|
| **Matrix** | 13 TCs × browsers × viewports with colored verdict glyphs; click any cell to expand per-check details |
| **Detection Evidence** | Per site/browser: script sources, network hosts, window globals, all cookies, localStorage keys, vendor signal scores, overlay findings (shadow DOM included) |
| **Element Verification** (in cell details) | Buttons/links found and clicked, preference center categories with states, banner rect measurements, page usability findings, Do-Not-Sell control location |
| **Cookie Comparison** (in cell details for TC-004/007/009) | Before/after cookie table with type classification (tracker/consent/other) and change indicators |
| **Compliance Roll-up** | Per-site summary: banner, consent recorded, analytics gated, reject available, pre-ticked, re-openable |
| **Defects** | Grouped by root cause with severity, affected TCs, browser/viewport combos, and root-cause hints |
| **Skipped** | TCs that didn't apply, with reasons |

## 5. Adding a new site

**Option A — one-off, zero config (discovery):**

```bash
node src/index.js --url https://new-site.com/
```

The detector identifies the vendor (OneTrust and Usercentrics get full depth — including shadow-DOM UIs; other vendors get best-effort generic handling) and runs all applicable TCs. Add `--name` to give it a friendly id.

**Option B — permanent profile** (for sites you audit repeatedly, deterministic verdicts):

Create `sites/<id>.config.js` modeled on the existing ones:

```js
import { VIEWPORTS } from '../src/constants.js';

export default {
  id: 'mysite',
  name: 'My Site',
  url: 'https://mysite.com/',
  expectedVendor: 'onetrust',            // what TC-001 should detect
  viewports: VIEWPORTS,
  labels: { accept: 'Accept All', reject: 'Reject All', manage: 'Manage Cookies', close: 'X', doNotSell: null },
  storage: {
    cookieNames: ['OptanonConsent', 'OptanonAlertBoxClosed'],
    localStorage: [],
    groups: ['C0001', 'C0002', 'C0003', 'C0004'],  // from the live cookie
    strictGroup: 'C0001',
    requiresDecode: true,                // OptanonConsent is URL-encoded
  },
  acceptGroups: ['C0001', 'C0002', 'C0004'],  // only if Accept All ≠ all groups
  doNotSell: null,                       // { label, groupId } if a D&S control exists
  defects: {},                           // declared defects, see below
  geo: { lang: 'en-US' },
};
```

### Declaring a known defect

If analysis shows a site is *known-broken* on a behavior, declare it so the suite reports it as a **defect ticket with a root-cause hint** instead of a raw red failure:

```js
defects: {
  consentNotPersisted: {
    matchAssertions: ['consent-storage-written', 'groups-match-accept'],
    severity: 'high',
    title: 'Consent choice is never persisted',
    rootCauseHint: 'OneTrust UI renders but the SDK never writes OptanonConsent. Check cookie-domain config / consent-server profile.',
  },
},
```

`matchAssertions` names the failing assertions that map to this ticket. Any high-severity anomaly **not** covered by a declaration becomes a `D*` runtime discovery.

## 6. The 13 test cases

| TC | Checks |
|---|---|
| TC-001 | CMP presence detection & vendor identification |
| TC-002 | Banner appears on first visit |
| TC-003 | Accept All enables every consent group (data-driven `acceptGroups`) |
| TC-004 | Reject All records only strictly-necessary (banner or PC fallback) + no trackers after reject |
| TC-005 | Manage Preferences: partial choice is saved exactly (storage ↔ PC self-consistency) |
| TC-006 | Manage Preferences: close without saving discards changes |
| TC-007 | Consent choice persists across reload |
| TC-008 | Consent settings can be re-opened after a choice |
| TC-009 | Consent record is persisted (storage verification oracle) |
| TC-010 | Dismiss (X) suppresses the banner without recording a consent choice |
| TC-011 | Mobile viewport parity (rendering + consent action) |
| TC-012 | Page remains usable after consent (no zombie overlay, no scroll-lock) |
| TC-013 | CCPA / Do-Not-Sell control present and reflected |

## 7. How it works (architecture)

```
src/
├── index.js            CLI entry: flag parsing, site loading, report writing, console summary
├── runner.js           Core engine: expands site × browser × viewport × TC, runs each TC in a
│                       FRESH isolated context (no cookie/localStorage bleed between paths),
│                       owns vendor detection (once per site×browser) + defect mapping
├── tcs.js              The 13 test cases — self-contained functions over the vendor-agnostic
│                       adapter interface; each returns { assertions, anomalies, consent, notes }
├── constants.js        Device matrix, CMP text/selector patterns, tracker-cookie heuristics
├── dom.js              Low-level DOM helpers (elShown, clickScoped, readCookies, readLocalStorage)
├── adapters/           Vendor drivers — tests never touch vendor internals
│   ├── index.js        Factory: detection.vendor → adapter
│   ├── onetrust.js     OneTrust (modern + legacy v6.36 templates, shadow-DOM tolerant)
│   ├── usercentrics.js Usercentrics v4 (UI renders in an open shadow root; reads ucData/ucString)
│   ├── generic.js      Vendor-agnostic fallback (text-driven, scoped to consent containers)
│   └── none.js         "No CMP" adapter — all actions are no-ops
├── detect/
│   ├── overlay.js      Consent-overlay scan (light DOM + open shadow roots), shared detector/UI
│   └── vendor-detector.js  8-signal scoring: scripts, network hosts, cookies, localStorage, globals
├── verify/
│   ├── storage-verifier.js   Oracle A — decodes OptanonConsent → enabled group set
│   └── ui-verifier.js        Oracle B — banner gone, PC closed, page usable (no scroll-lock/zombie)
└── report/
    ├── writer.js       Emits report.html, results.csv, results.json, junit.xml, shots/
    └── console.js      Per-site tree + compliance roll-up + new-discovery summary
```

### Run workflow

```
node src/index.js [flags]
       │
       ▼
1. Parse flags ────────────────► --help? print usage & exit
       │
       ▼
2. Load sites ────────────────► sites/*.config.js (auto-discovered), or a profile from --url
       │
       ▼
3. Build matrix ──────────────► site × browser (chromium, firefox) × viewport (desktop, mobile)
       │                          workers run site×browser combos in parallel (default 4)
       ▼
  per site × browser:
       │
       ├── 3a. Launch browser (headless by default; --headed shows it)
       │
       ├── 3b. Vendor detection ──► load page, score 8 signals
       │                            (script URLs, network hosts, cookies,
       │                             localStorage, window globals) → vendor
       │                             = onetrust | usercentrics | generic | none | unknown
       │
       └── 3c. For each TC × viewport — FRESH context each time
                │
                ├── applicable? ──► no ──► SKIP (with reason)
                │
                ├── run actions via adapter ──► click Accept / Reject / Manage…,
                │                                 tolerant of both OneTrust DOM
                │                                 templates (modern + legacy v6.36)
                │
                ├── verify Oracle A (storage) ──► OptanonConsent / alert-box /
                │                                 localStorage parsed to group set
                ├── verify Oracle B (UI) ────────► banner gone, PC closed, page usable
                │
                ├── finalizeResult ──► failing assertions map to declared defect?
                │                       │ yes ──► DEFECT (ticket attached)
                │                       │ no  ──► high-severity anomaly?
                │                       │          │ yes ──► DEFECT (D* discovered)
                │                       │          │ no  ──► PASS
                ▼
4. writeReports ───────────────► report.html, results.csv, results.json, junit.xml, shots/
       │
       ▼
5. Console summary ────────────► per-site tree, TOTAL, new discoveries, paths to reports
```

## 8. Sites profiled

| Site | Vendor | Notable declared defects |
|------|--------|--------------------------|
| `ahwatukeepa` | OneTrust | Custom CCPA group `SPDTA_BG`; `acceptGroups` excludes C0003 |
| `adient` | OneTrust v6.36 | Analytics fires after Reject All; settings not reopenable |
| `jncb-staging` | OneTrust | Consent never persisted (no OptanonConsent written); reject only via PC |
| `multidots` | None | No CMP — tracking cookies load unconditionally |

## 9. Known limitations

- **Full fidelity is implemented for OneTrust and Usercentrics** (Usercentrics v4 renders its whole UI inside a shadow root — handled by a dedicated adapter that pierces the shadow DOM and reads `ucData`/`ucString` localStorage consent). For any other vendor the detector records the vendor and the generic adapter does best-effort text-based actions — identification works, but precise preference-center toggling and group parsing are vendor-specific.
- **Geo-targeting:** CMP banners are often shown only to EU visitors. Run from a region where the target site shows its banner, or the suite correctly reports "no CMP".
- **Cross-browser tolerance:** the same OneTrust template can render a few px taller in Firefox than chromium; TC-011 allows ~5% viewport-height tolerance so font-metric noise never false-fails a real mobile-parity check.
- **Live sites change.** A config's declared labels/defects may drift from reality; re-running periodically and trusting `D*` discoveries keeps the profiles honest.

## 10. License

ISC
