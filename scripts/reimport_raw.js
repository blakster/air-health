// Rebuild the real dataset from the retained raw export in data/takeout-raw/ (zip(s) or an extracted folder).
// Usage: node scripts/reimport_raw.js [--keep]   (default: fresh real store; --keep merges into the existing one)
'use strict';
const fs = require('fs'); const path = require('path');
const store = require('../lib/store'); const intraday = require('../lib/intraday'); const takeout = require('../lib/sources/takeout');
const RAW = path.join(store.DATA_DIR, 'takeout-raw');
function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (!e.name.startsWith('.')) out.push(p); } return out; }
(async () => {
  if (!fs.existsSync(RAW)) throw new Error('no data/takeout-raw/');
  const all = walk(RAW); const zips = all.filter((p) => /\.zip$/i.test(p));
  const list = (zips.length ? zips : all).map((p) => ({ path: p, relPath: path.relative(RAW, p) }));
  const parsed = await takeout.importFiles(list);
  const n = Object.keys(parsed.days).length; if (!n) throw new Error('nothing parsed');
  if (parsed.manifest) { fs.writeFileSync(path.join(store.DATA_DIR, 'last-import-manifest.json'), JSON.stringify({ at: new Date().toISOString(), report: { ...parsed.report, skipped: undefined }, files: parsed.manifest }, null, 1), { mode: 0o600 }); delete parsed.manifest; }
  if (!process.argv.includes('--keep')) { store.clearReal(); intraday.clear(store.DATA_DIR); }
  const saved = intraday.save(store.DATA_DIR, parsed.intraday); delete parsed.intraday;
  store.mergeReal(parsed, { source: 'takeout-raw', files: list.length, days: n, range: parsed.report.dateRange, byType: parsed.report.byType });
  store.setActive('real');
  const r = parsed.report;
  console.log(JSON.stringify({ intradayDays: saved, files: list.map((f) => f.relPath), days: n, range: r.dateRange, sleep: parsed.sleep.length, dropped: r.droppedDays, devices: r.devices, exercises: r.exercises, sources: r.dataSources }, null, 1));
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
