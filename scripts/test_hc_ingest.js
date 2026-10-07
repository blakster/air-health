// Health Connect phone-sync ingest: synthetic payloads, merge with Takeout data, idempotency, deletions, HTTP auth.
// Runs against a throwaway DATA_DIR (never the live store).
const os = require('os'); const fs = require('fs'); const path = require('path'); const zlib = require('zlib'); const assert = require('assert');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-test-'));
process.env.DATA_DIR = DATA;
const store = require('../lib/store');
const intraday = require('../lib/intraday');
const hc = require('../lib/sources/healthConnect');
const analytics = require('../lib/analytics');
const coach = require('../lib/coach');
const express = require('express');

const IST = 19800; const FB = 'com.fitbit.FitbitMobile'; const FIT = 'com.google.android.apps.fitness';
const T = (s) => Date.parse(s); // UTC ISO -> ms
const rec = (t, id, s, e, v, o = FB, lm = 1000, extra = {}) => ({ t, id, lm, o, s: T(s), e: e ? T(e) : undefined, so: IST, eo: e ? IST : undefined, v, ...extra });

(async () => {
  // 1. Takeout baseline for 5-6 Oct (as the zip importer would write it).
  store.mergeReal({ days: {
    '2026-10-05': { date: '2026-10-05', steps: 9000, azm: 12, resting_hr: 70, calories: 2100 },
    '2026-10-06': { date: '2026-10-06', steps: 18754, azm: 30, hr_avg: 90, resting_hr: 85, very_active_minutes: 20 },
  }, sleep: [{ logId: 'takeout-1', date: '2026-10-06', start: '2026-10-05T23:30', end: '2026-10-06T06:30', minutes_asleep: 380, main: true, source: 'MANUAL' }] },
  { source: 'takeout-upload', files: 1, days: 2 });
  intraday.save(DATA, { '2026-10-06': { date: '2026-10-06', source: 'Google Fitbit Air', step: 60, samples: 3, avg: new Array(1440).fill(null), min: new Array(1440).fill(null), max: new Array(1440).fill(null), zones: [{ type: 'LIGHT', min: 30, max: 129 }] } });

  // 2. Synthetic HC batch: Fitbit + Google Fit steps for the same minutes (must not be added), HR across midnight,
  //    staged sleep overlapping the Takeout session, overnight HRV / SpO2 / breathing, RHR, weight, VO2, workout, skin temp.
  const hr = []; for (let i = 0; i < 240; i++) hr.push([T('2026-10-05T18:10:00Z') + i * 15000, 60 + (i % 20)]); // 23:40 -> 00:40 IST
  const batch = { v: 1, kind: 'backfill', batch: 'b1', tz: 'Asia/Kolkata', app: '1.0.0', device: 'Google Pixel 9 / Android 16', days: ['2026-10-06'],
    records: [
      rec('Steps', 'st1', '2026-10-06T03:00:00Z', '2026-10-06T03:01:00Z', { count: 4000 }),
      rec('Steps', 'st2', '2026-10-06T04:00:00Z', '2026-10-06T04:01:00Z', { count: 2758 }),
      rec('Steps', 'gf1', '2026-10-06T03:00:00Z', '2026-10-06T03:01:00Z', { count: 3900 }, FIT),
      rec('Steps', 'gf2', '2026-10-06T04:00:00Z', '2026-10-06T04:01:00Z', { count: 2800 }, FIT),
      rec('Distance', 'di1', '2026-10-06T03:00:00Z', '2026-10-06T04:01:00Z', { m: 4876.4 }),
      rec('TotalCaloriesBurned', 'tc1', '2026-10-05T18:30:00Z', '2026-10-06T12:00:00Z', { kcal: 1650.4 }),
      rec('HeartRate', 'hr1', '2026-10-05T18:10:00Z', '2026-10-05T19:10:00Z', { hr }, FB, 1000, { dev: 'Google Fitbit Air (FITNESS_BAND)' }),
      rec('SleepSession', 'sl1', '2026-10-05T18:00:00Z', '2026-10-06T01:00:00Z', { title: null, stages: [
        [T('2026-10-05T18:00:00Z'), T('2026-10-05T20:00:00Z'), 'LIGHT'], [T('2026-10-05T20:00:00Z'), T('2026-10-05T21:30:00Z'), 'DEEP'],
        [T('2026-10-05T21:30:00Z'), T('2026-10-05T23:00:00Z'), 'REM'], [T('2026-10-05T23:00:00Z'), T('2026-10-05T23:20:00Z'), 'AWAKE'],
        [T('2026-10-05T23:20:00Z'), T('2026-10-06T01:00:00Z'), 'LIGHT']] }),
      rec('HeartRateVariabilityRmssd', 'hv1', '2026-10-05T21:00:00Z', null, { ms: 41.26 }), // 02:30 IST -> 6 Oct
      rec('HeartRateVariabilityRmssd', 'hv2', '2026-10-05T23:00:00Z', null, { ms: 45.0 }),
      rec('OxygenSaturation', 'ox1', '2026-10-05T14:00:00Z', null, { pct: 96.2 }), // 19:30 IST 5 Oct -> night of 6 Oct
      rec('RespiratoryRate', 'rr1', '2026-10-05T22:00:00Z', null, { rate: 14.6 }),
      rec('RestingHeartRate', 'rh1', '2026-10-06T00:00:00Z', null, { bpm: 61 }),
      rec('Weight', 'w1', '2026-10-06T02:00:00Z', null, { kg: 71.44 }),
      rec('Vo2Max', 'vo1', '2026-10-06T02:00:00Z', null, { v: 44.5, method: 2 }),
      rec('ExerciseSession', 'ex1', '2026-10-06T12:00:00Z', '2026-10-06T12:40:00Z', { type: 79, name: 'Walk', title: null }),
      rec('SkinTemperature', 'sk1', '2026-10-05T18:00:00Z', '2026-10-06T01:00:00Z', { baseline: null, deltas: [[T('2026-10-05T19:00:00Z'), -0.2], [T('2026-10-05T20:00:00Z'), -0.4]], loc: 3 }),
      { t: 'Bogus', id: 'x', lm: 1, s: 1 }, // ignored
    ],
    deleted: [], aggregates: [{ date: '2026-10-06', steps: 6800, distance_m: 4900, kcal_total: 1700, kcal_active: null, origins: [FB, FIT] }] };
  const r1 = hc.ingest(batch);
  assert.strictEqual(r1.invalid, 1); assert.strictEqual(r1.accepted, 17);
  let d6 = store.active().days['2026-10-06'], d5 = store.active().days['2026-10-05'];
  assert.strictEqual(d6.steps, 6758, 'Fitbit-origin steps only, never phone + Fit summed');
  assert.strictEqual(d6.distance_km, 4.88); assert.strictEqual(d6.calories, 1650);
  assert.strictEqual(d6.azm, 30, 'metrics HC lacks keep the Takeout value'); assert.strictEqual(d6.very_active_minutes, 20);
  assert.strictEqual(d6.resting_hr, 61, 'HC wins over Takeout'); assert.strictEqual(d6.hrv, 43.1); assert.strictEqual(d6.spo2_avg, 96.2); assert.strictEqual(d6.breathing_rate, 14.6);
  assert.strictEqual(d6.weight_kg, 71.4); assert.strictEqual(d6.vo2_max, 44.5); assert.strictEqual(d6.exercise_count, 1); assert.strictEqual(d6.exercise_minutes, 40);
  assert.strictEqual(d6.skin_temp_delta_c, -0.3); assert.strictEqual(d6.hc_source, 'Health Connect'); assert.strictEqual(d6.hc_origin, FB);
  // Sleep: 23:30 -> 06:30 IST, staged; replaces the overlapping Takeout session; dated by wake day.
  assert.strictEqual(d6.sleep_deep, 90); assert.strictEqual(d6.sleep_rem, 90); assert.strictEqual(d6.sleep_light, 220); assert.strictEqual(d6.sleep_wake, 20);
  assert.strictEqual(d6.sleep_minutes, 400); assert.strictEqual(d6.time_in_bed, 420); assert.strictEqual(d6.bedtime, '2026-10-05T23:30'); assert.strictEqual(d6.waketime, '2026-10-06T06:30');
  const sl = store.active().sleep; assert.strictEqual(sl.length, 1); assert.strictEqual(sl[0].logId, 'hc:sl1'); assert.strictEqual(sl[0].source, 'Health Connect');
  // HR split at local midnight: 23:40-23:59 -> 5 Oct (80 samples), 00:00-00:40 -> 6 Oct (160 samples).
  assert.strictEqual(d5.hr_samples, 80); assert.strictEqual(d6.hr_samples, 160); assert.strictEqual(d5.steps, 9000, '5 Oct steps untouched');
  const i6 = intraday.get(DATA, '2026-10-06'); assert.strictEqual(i6.source, 'Health Connect'); assert.strictEqual(i6.samples, 160);
  assert.ok(i6.avg[0] != null && i6.avg[39] != null && i6.avg[40] == null, 'minutes 00:00-00:40 filled, gaps stay null');
  assert.deepStrictEqual(i6.zones, [{ type: 'LIGHT', min: 30, max: 129 }], 'zones from Takeout kept');
  assert.ok(intraday.get(DATA, '2026-10-05').avg[23 * 60 + 40] != null);

  // 2b. A second, overlapping HR record from the same app does not double the samples.
  hc.ingest({ kind: 'changes', records: [rec('HeartRate', 'hr1-copy', '2026-10-05T18:10:00Z', '2026-10-05T19:10:00Z', { hr })] });
  assert.strictEqual(store.active().days['2026-10-06'].hr_samples, 160);
  hc.ingest({ kind: 'changes', records: [], deleted: ['hr1-copy'] });
  // 3. Idempotent: the same batch again changes nothing.
  const before = JSON.stringify(store.active().days);
  const r2 = hc.ingest(batch); assert.strictEqual(r2.accepted, 0); assert.strictEqual(r2.duplicates, 17);
  assert.strictEqual(JSON.stringify(store.active().days), before);
  // Older version ignored, newer version wins.
  hc.ingest({ kind: 'changes', records: [rec('Steps', 'st2', '2026-10-06T04:00:00Z', '2026-10-06T04:01:00Z', { count: 1 }, FB, 500)] });
  assert.strictEqual(store.active().days['2026-10-06'].steps, 6758);
  hc.ingest({ kind: 'changes', records: [rec('Steps', 'st2', '2026-10-06T04:00:00Z', '2026-10-06T04:01:00Z', { count: 3000 }, FB, 2000)] });
  assert.strictEqual(store.active().days['2026-10-06'].steps, 7000);
  // 4. Deletion: removing the resting HR record drops the HC value (stale HC fields are removed, not left behind).
  const r3 = hc.ingest({ kind: 'changes', records: [], deleted: ['rh1', 'unknown-id'] }); assert.strictEqual(r3.deleted, 1);
  assert.strictEqual(store.active().days['2026-10-06'].resting_hr, undefined);

  // 4b. Sleep must NOT be wiped by a daytime steps-only sync (no SleepSession in the batch).
  const sleepBefore = {
    minutes: store.active().days['2026-10-06'].sleep_minutes,
    deep: store.active().days['2026-10-06'].sleep_deep,
    bedtime: store.active().days['2026-10-06'].bedtime,
    waketime: store.active().days['2026-10-06'].waketime,
    stages: store.active().days['2026-10-06'].sleep_stages,
    sessions: store.active().sleep.filter((x) => x.date === '2026-10-06').map((x) => x.logId),
  };
  assert.strictEqual(sleepBefore.minutes, 400);
  assert.ok(Array.isArray(sleepBefore.stages) && sleepBefore.stages.length, 'stage epochs present before steps-only sync');
  hc.ingest({ kind: 'changes', records: [rec('Steps', 'st-day', '2026-10-06T09:00:00Z', '2026-10-06T09:01:00Z', { count: 50 })],
    aggregates: [{ date: '2026-10-06', steps: 7050, origins: [FB] }] });
  d6 = store.active().days['2026-10-06'];
  assert.strictEqual(d6.sleep_minutes, sleepBefore.minutes, 'steps-only sync keeps sleep_minutes');
  assert.strictEqual(d6.sleep_deep, sleepBefore.deep);
  assert.strictEqual(d6.bedtime, sleepBefore.bedtime);
  assert.strictEqual(d6.waketime, sleepBefore.waketime);
  assert.deepStrictEqual(d6.sleep_stages, sleepBefore.stages, 'sleep_stages epochs kept');
  assert.deepStrictEqual(store.active().sleep.filter((x) => x.date === '2026-10-06').map((x) => x.logId), sleepBefore.sessions);

  // 4c. Explicit SleepSession deletion (HC change feed) also keeps last-good sleep until real sleep arrives.
  const rDelSl = hc.ingest({ kind: 'changes', records: [], deleted: ['sl1'] });
  assert.strictEqual(rDelSl.deleted, 1);
  d6 = store.active().days['2026-10-06'];
  assert.strictEqual(d6.sleep_minutes, 400, 'deleted SleepSession keeps last-good minutes');
  assert.strictEqual(d6.bedtime, '2026-10-05T23:30');
  assert.ok(d6.sleep_stages && d6.sleep_stages.length, 'deleted SleepSession keeps stage epochs');
  assert.strictEqual(store.active().sleep.filter((x) => x.date === '2026-10-06' && x.logId === 'hc:sl1').length, 1);

  // 4d. A short stub session (<30 min) must not replace last-good overnight sleep.
  hc.ingest({ kind: 'changes', records: [rec('SleepSession', 'sl-stub', '2026-10-06T12:00:00Z', '2026-10-06T12:10:00Z', { title: 'nap', stages: [] })] });
  d6 = store.active().days['2026-10-06'];
  assert.strictEqual(d6.sleep_minutes, 400, 'stub nap does not wipe overnight sleep');
  assert.strictEqual(d6.bedtime, '2026-10-05T23:30');

  // 4e. A later real sleep session replaces last-good (drop the stub first so minutes are not summed).
  hc.ingest({ kind: 'changes', records: [rec('SleepSession', 'sl2', '2026-10-05T18:30:00Z', '2026-10-06T01:30:00Z', { title: null, stages: [
    [T('2026-10-05T18:30:00Z'), T('2026-10-05T20:30:00Z'), 'LIGHT'], [T('2026-10-05T20:30:00Z'), T('2026-10-05T22:00:00Z'), 'DEEP'],
    [T('2026-10-05T22:00:00Z'), T('2026-10-05T23:30:00Z'), 'REM'], [T('2026-10-05T23:30:00Z'), T('2026-10-06T01:30:00Z'), 'LIGHT']] })],
    deleted: ['sl-stub'] });
  d6 = store.active().days['2026-10-06'];
  assert.strictEqual(d6.sleep_minutes, 420);
  assert.strictEqual(d6.bedtime, '2026-10-06T00:00'); // 18:30Z + 5:30 IST
  assert.strictEqual(d6.waketime, '2026-10-06T07:00');
  assert.ok(d6.sleep_stages && d6.sleep_stages.length);
  assert.strictEqual(store.active().sleep.filter((x) => x.logId === 'hc:sl2').length, 1);
  assert.strictEqual(store.active().sleep.filter((x) => x.logId === 'hc:sl1').length, 0, 'replaced session dropped');

  // 5. Day with only Google Fit + HC aggregate -> aggregate (HC's own de-duplicated total), not a sum.
  hc.ingest({ kind: 'backfill', records: [rec('Steps', 'g3', '2026-10-04T05:00:00Z', '2026-10-04T05:01:00Z', { count: 500 }, FIT), rec('Steps', 'g4', '2026-10-04T05:00:00Z', '2026-10-04T05:01:00Z', { count: 450 }, 'com.sec.android.app.shealth')],
    aggregates: [{ date: '2026-10-04', steps: 520, origins: [FIT] }] });
  assert.strictEqual(store.active().days['2026-10-04'].steps, 520);

  // 5b. HC's calorie aggregate is a BMR estimate on empty days: it must not create days by itself.
  hc.ingest({ kind: 'backfill', records: [rec('TotalCaloriesBurned', 'bmr1', '2026-09-01T00:00:00Z', '2026-09-01T18:00:00Z', { kcal: 1500 })], aggregates: [{ date: '2026-09-02', kcal_total: 1600 }] });
  assert.strictEqual(store.active().days['2026-09-01'], undefined); assert.strictEqual(store.active().days['2026-09-02'], undefined);
  // 6. A later Takeout re-import: HC still wins for its metrics/sleep/intraday, Takeout fills the rest.
  store.mergeReal({ days: { '2026-10-06': { date: '2026-10-06', steps: 18754, azm: 33, hr_avg: 91, sleep_minutes: 300 } }, sleep: [{ logId: 'takeout-1', date: '2026-10-06', start: '2026-10-05T23:30', end: '2026-10-06T06:30', minutes_asleep: 380, main: true }] }, { source: 'takeout-upload', files: 1, days: 1 });
  intraday.save(DATA, { '2026-10-06': { ...i6, source: 'Google Fitbit Air', samples: 1 } }); // what the upload route writes first ...
  store.mergeReal({ days: {}, sleep: [] }, { source: 'takeout-upload', files: 1, days: 0 }); // ... then mergeReal restores HC intraday
  d6 = store.active().days['2026-10-06'];
  assert.strictEqual(d6.steps, 7050); assert.strictEqual(d6.sleep_minutes, 420); assert.strictEqual(d6.azm, 33);
  assert.strictEqual(store.active().sleep.filter((x) => x.date === '2026-10-06').length, 1);
  assert.strictEqual(intraday.get(DATA, '2026-10-06').source, 'Health Connect');
  assert.strictEqual(store.status().real.imports.filter((i) => i.source === 'health-connect').length, 1, 'one rolling import entry');

  // 7. Shows up in analytics (all pages) and the coach context.
  const a = analytics.build(store.active(), store.settings());
  assert.strictEqual(a.rows.find((r) => r.date === '2026-10-06').steps, 7050);
  const ctx = coach.buildContext(a, '');
  assert.ok(/PHONE SYNC: \d+ days .* Health Connect/.test(ctx), 'coach context names Health Connect');
  const s = hc.summary(); assert.ok(s.origins.find((o) => o.pkg === FB && o.preferred && o.types.HeartRate >= 1)); assert.ok(s.origins.find((o) => o.pkg === FIT && !o.preferred));

  // 8. HTTP: pairing, bearer auth, gzip ingest, status. Files are 0600.
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use(hc.publicRouter()); app.use(hc.privateRouter());
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const j = async (p, o) => { const r = await fetch(base + p, o); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  assert.strictEqual((await j('/api/hc/status')).status, 401);
  assert.strictEqual((await j('/api/hc/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'AAAA-AAAA' }) })).status, 404);
  const pair = await j('/api/hc/pair', { method: 'POST', headers: { host: 'YOUR_TAILSCALE_IP:4870' } });
  assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(pair.body.code)); assert.ok(pair.body.qr.startsWith('<svg')); assert.ok(pair.body.link.startsWith('airhealth://pair?server='));
  const bad = await j('/api/hc/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'ZZZZ-ZZZZ' }) }); assert.strictEqual(bad.status, 404);
  const ok = await j('/api/hc/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pair.body.code.toLowerCase(), device: 'Pixel test' }) });
  assert.strictEqual(ok.status, 200); const token = ok.body.token; assert.ok(token.length >= 40);
  assert.strictEqual((await j('/api/hc/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pair.body.code }) })).status, 404, 'single use');
  assert.ok(!fs.readFileSync(path.join(DATA, 'hc', 'device.json'), 'utf8').includes(token), 'only a hash of the token is stored');
  for (const f of ['device.json', 'state.json', 'derived.json', 'days/2026-10-06.json']) assert.strictEqual(fs.statSync(path.join(DATA, 'hc', f)).mode & 0o777, 0o600, f);
  assert.strictEqual(fs.statSync(path.join(DATA, 'hc')).mode & 0o777, 0o700);
  const gz = zlib.gzipSync(JSON.stringify({ kind: 'changes', records: [rec('Steps', 'st9', '2026-10-06T08:00:00Z', '2026-10-06T08:01:00Z', { count: 100 })] }));
  assert.strictEqual((await j('/api/hc/ingest', { method: 'POST', headers: { 'content-type': 'application/gzip', authorization: 'Bearer wrong-token-wrong-token-wrong-token-xx' }, body: gz })).status, 401);
  const ing = await j('/api/hc/ingest', { method: 'POST', headers: { 'content-type': 'application/gzip', authorization: `Bearer ${token}` }, body: gz });
  assert.strictEqual(ing.status, 200); assert.strictEqual(ing.body.accepted, 1); assert.strictEqual(store.active().days['2026-10-06'].steps, 7150);
  const big = { kind: 'backfill', records: [] }; const hr2 = []; for (let i = 0; i < 60000; i++) hr2.push([T('2026-10-03T00:00:00Z') + i * 1000, 70 + (i % 30)]);
  big.records.push(rec('HeartRate', 'hrBig', '2026-10-03T00:00:00Z', '2026-10-03T20:50:00Z', { hr: hr2 }));
  const gzBig = zlib.gzipSync(JSON.stringify(big)); assert.ok(JSON.stringify(big).length > 1024 * 1024, 'bigger than the 1 MB JSON limit');
  const ingBig = await j('/api/hc/ingest', { method: 'POST', headers: { 'content-type': 'application/gzip', authorization: `Bearer ${token}` }, body: gzBig });
  assert.strictEqual(ingBig.status, 200); assert.ok(intraday.get(DATA, '2026-10-03').samples > 10000);
  const st = await j('/api/hc/status', { headers: { authorization: `Bearer ${token}` } }); assert.strictEqual(st.body.paired, true); assert.ok(st.body.days >= 3);
  await j('/api/hc/resync', { method: 'POST' });
  assert.strictEqual((await j('/api/hc/status', { headers: { authorization: `Bearer ${token}` } })).body.resync, true);
  assert.strictEqual((await j('/api/hc/status?ack=resync', { headers: { authorization: `Bearer ${token}` } })).body.resync, true);
  assert.strictEqual((await j('/api/hc/status', { headers: { authorization: `Bearer ${token}` } })).body.resync, false, 'acknowledged once by the sync engine');
  assert.strictEqual((await fetch(base + '/download/AirHealthSync.apk')).status, fs.existsSync(path.join(__dirname, '..', 'dist', 'AirHealthSync.apk')) ? 200 : 404);
  await j('/api/hc/unpair', { method: 'POST' }); assert.strictEqual((await j('/api/hc/status', { headers: { authorization: `Bearer ${token}` } })).status, 401, 'unpair revokes the token');
  srv.close();

  // 9. "Delete uploaded data" removes the phone copy too.
  store.clearReal(); assert.strictEqual(fs.existsSync(path.join(DATA, 'hc', 'days')), false); assert.strictEqual(hc.summary().days, 0);
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log('OK: Health Connect ingest (dedup by origin, HC-wins merge, sticky sleep, sleep/intraday overlay, idempotency, deletions, aggregates, HTTP auth + gzip, coach context)');
})().catch((e) => { console.error(e); fs.rmSync(DATA, { recursive: true, force: true }); process.exit(1); });
