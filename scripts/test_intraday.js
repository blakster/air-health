// Intraday heart rate: per-minute aggregation from the real Google-data layout (synthetic values),
// IST minute mapping, band preference, gaps left as null, zone thresholds, and the per-day file store.
'use strict';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const takeout = require('../lib/sources/takeout'); const intraday = require('../lib/intraday');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihr-'));
const put = (rel, body) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); return { path: p, relPath: rel }; };
const D = '2026-09-12', PA = 'Takeout/Google Health/Physical Activity_GoogleData';
const rows = [
  // 03:55Z = 09:25 IST -> minute 565: three band samples (80, 90, 100) + one phone sample that must be ignored
  `${D}T03:55:01Z,80,Google Fitbit Air`, `${D}T03:55:20Z,90,Google Fitbit Air`, `${D}T03:55:59Z,100.0,Google Fitbit Air`, `${D}T03:55:30Z,40,Some Phone`,
  `${D}T03:56:10Z,110,Google Fitbit Air`, // minute 566
  `${D}T05:00:00Z,70,Google Fitbit Air`, // 10:30 IST -> minute 630; 567..629 are a gap
  `${D}T18:29:59Z,60,Google Fitbit Air`, // 23:59 IST -> minute 1439
  `${D}T18:30:00Z,65,Google Fitbit Air`, // 00:00 IST next day
];
const files = [
  put(`${PA}/Heart Rate/heart_rate_2026-09-12.csv`, 'timestamp,beats per minute,data source\n' + rows.join('\n') + '\n'),
  put(`${PA}/Daily Heart Rate Zones/daily_heart_rate_zones_2026-09-01.csv`, 'timestamp,heart_rate_zone,data source\n' +
    `${D}T00:00:00Z,"{""heart_rate_zone_type"": LIGHT, ""min_heart_rate_bpm"": 30, ""max_heart_rate_bpm"": 129},{""heart_rate_zone_type"": MODERATE, ""min_heart_rate_bpm"": 130, ""max_heart_rate_bpm"": 151},{""heart_rate_zone_type"": VIGOROUS, ""min_heart_rate_bpm"": 152, ""max_heart_rate_bpm"": 180},{""heart_rate_zone_type"": PEAK, ""min_heart_rate_bpm"": 181, ""max_heart_rate_bpm"": 220}",Google Health App\n`),
];

(async () => {
  const out = await takeout.importFiles(files);
  const day = out.intraday[D]; assert.ok(day, 'intraday day present');
  assert.strictEqual(day.source, 'Google Fitbit Air'); assert.strictEqual(day.step, 60); assert.strictEqual(day.avg.length, 1440);
  assert.deepStrictEqual([day.avg[565], day.min[565], day.max[565]], [90, 80, 100], 'minute mean/min/max from band only');
  assert.strictEqual(day.avg[566], 110); assert.strictEqual(day.avg[630], 70); assert.strictEqual(day.avg[1439], 60);
  assert.ok(day.avg.slice(567, 630).every((v) => v === null), 'unworn minutes are null (no interpolation)');
  assert.strictEqual(day.avg[564], null);
  assert.strictEqual(day.samples, 6, 'band samples on the IST day');
  assert.deepStrictEqual(day.zones.map((z) => [z.type, z.min, z.max]), [['LIGHT', 30, 129], ['MODERATE', 130, 151], ['VIGOROUS', 152, 180], ['PEAK', 181, 220]]);
  const next = out.intraday['2026-09-13']; assert.ok(next && next.avg[0] === 65, '18:30Z belongs to 00:00 IST next day');
  assert.strictEqual(out.days[D].hr_samples, 6);

  // file store
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ihd-'));
  assert.strictEqual(intraday.save(data, { ...out.intraday, 'bad/../x': day, '2026-13-0': day }), 2, 'only valid dates saved');
  assert.deepStrictEqual(intraday.list(data), ['2026-09-12', '2026-09-13']);
  assert.strictEqual((fs.statSync(path.join(data, 'intraday')).mode & 0o777), 0o700);
  assert.strictEqual((fs.statSync(path.join(data, 'intraday', `${D}.json`)).mode & 0o777), 0o600);
  assert.deepStrictEqual(intraday.get(data, D).avg[565], 90);
  assert.strictEqual(intraday.get(data, '../store'), null);
  intraday.clear(data); assert.deepStrictEqual(intraday.list(data), []);
  // sample day (demo mode) has a worn-off gap and stays in range
  const s = intraday.sampleDay('2026-09-12', 60); assert.ok(s.avg.some((v) => v === null) && s.avg.filter((v) => v != null).every((v) => v > 30 && v < 220));
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true });
  console.log('OK: intraday HR minute aggregation, IST mapping, band preference, gaps, zones, file store');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
