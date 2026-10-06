// Parser regression test against the synthetic export (does not touch the live store).
const assert = require('assert');
const fs = require('fs');
const takeout = require('../lib/sources/takeout');
(async () => {
  const zip = process.argv[2] || '/tmp/synthetic_takeout.zip';
  const exp = JSON.parse(fs.readFileSync(zip.replace('.zip', '.expected.json')));
  const out = await takeout.importFiles([{ path: zip, relPath: 'takeout-20261006.zip' }]);
  console.log('report', JSON.stringify({ ...out.report, skipped: out.report.skipped }, null, 1));
  let n = 0;
  for (const [d, e] of Object.entries(exp)) {
    const r = out.days[d]; assert(r, 'missing day ' + d);
    assert.strictEqual(r.steps, e.steps, `steps ${d}`);
    assert.strictEqual(r.resting_hr, e.resting_hr, `rhr ${d}`);
    assert.strictEqual(r.hrv, e.hrv, `hrv ${d}`);
    assert.strictEqual(r.sleep_minutes, e.sleep_minutes, `sleep ${d}`);
    assert.strictEqual(r.sleep_score, e.sleep_score, `score ${d}`);
    assert.strictEqual(r.readiness, e.readiness, `readiness ${d}`);
    assert.strictEqual(r.active_minutes, e.very_active + 15, `active ${d}`);
    assert(r.spo2_avg === 96.4 && r.hr_avg > 60 && r.sleep_deep > 0 && r.bedtime, `misc ${d}`);
    n++;
  }
  console.log('sample day', out.days['2026-09-05']);
  // Legacy selection CSV
  const sel = await takeout.importFiles([{ path: zip.replace('.zip', '_selection.csv'), relPath: 'fitbit_export_20260922.csv' }]);
  const s = sel.days['2026-09-22'];
  assert.strictEqual(s.steps, 11204); assert.strictEqual(s.sleep_minutes, 410); assert.strictEqual(s.sleep_deep, 75); assert.strictEqual(s.active_minutes, 58);
  console.log('selection day', s);
  // Folder-style upload (loose files) — reuse zip entries extracted to a dir
  console.log(`OK: ${n} takeout days verified + selection export`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
