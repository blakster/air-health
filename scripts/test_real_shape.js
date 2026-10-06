// Regression test shaped like the real Google Health Takeout upload of 6 Oct 2026 (synthetic values).
// The original zip was not kept, so the layout comes from the import report (which files were recognised)
// plus the stored day fields: monthly Global Export Data JSON padded past today with placeholder days,
// a header-only sleep_score.csv and Stress Score.csv, a single non-zero resting HR day, minute steps/calories
// CSVs in "Physical Activity_GoogleData", and Google-data style CSVs ("beats per minute", "data source").
'use strict';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const takeout = require('../lib/sources/takeout');
const { todayLocal, addDays } = require('../lib/util');

const T = todayLocal(); const D = (n) => addDays(T, -n);
const us = (d, t = '00:00:00') => { const [y, m, dd] = d.split('-'); return `${m}/${dd}/${y.slice(2)} ${t}`; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realshape-')); const files = [];
const put = (rel, body) => { const p = path.join(dir, rel.replace(/\//g, '__')); fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); files.push({ path: p, relPath: 'takeout-20261006T100000Z-001.zip/Takeout/Fitbit/' + rel }); };

// Global Export Data: 30-day file starting 3 days ago -> 27 future placeholder days, like the real upload.
const start = D(3); const span = [...Array(30)].map((_, i) => addDays(start, i));
const worn = new Set([D(3), D(2), D(1)]); // band worn the last few days only
const daily = (k, f) => put(`Global Export Data/${k}-${start}.json`, span.map((d) => ({ dateTime: us(d), value: String(f(d)) })));
daily('sedentary_minutes', (d) => (worn.has(d) ? 700 : 1440));
daily('lightly_active_minutes', (d) => (worn.has(d) ? 200 : 0));
daily('moderately_active_minutes', (d) => (worn.has(d) ? 15 : 0));
daily('very_active_minutes', (d) => (worn.has(d) ? 25 : 0));
daily('calories', () => 1650); // BMR fills every day, even unworn / future ones
// Minute steps (Global Export intraday)
put(`Global Export Data/steps-${start}.json`, [...worn].flatMap((d) => [{ dateTime: us(d, '04:00:00'), value: '4000' }, { dateTime: us(d, '10:30:00'), value: '4500' }]));
put(`Global Export Data/resting_heart_rate-${start}.json`, span.map((d) => ({ dateTime: us(d), value: { date: us(d).slice(0, 8), value: d === D(1) ? 61.4 : 0, error: d === D(1) ? 6.1 : 0 } })));
put('Sleep/sleep_score.csv', 'sleep_log_entry_id,timestamp,overall_score,composition_score,revitalization_score,duration_score,deep_sleep_in_minutes,resting_heart_rate,restlessness\n');
put('Stress Score/Stress Score.csv', 'DATE,UPDATED_AT,STRESS_SCORE,SLEEP_POINTS,MAX_SLEEP_POINTS,RESPONSIVENESS_POINTS,MAX_RESPONSIVENESS_POINTS,EXERTION_POINTS,MAX_EXERTION_POINTS,STATUS,CALCULATION_FAILED\n' + `${D(1)}T00:00:00,${D(1)}T08:00:00,0,0,30,0,30,0,40,READY,false\n`);
// Google-data CSVs (minute rows, UTC 'Z' stamps)
const z = (d, hh, mm = '00') => `${d}T${hh}:${mm}:00Z`;
put(`Physical Activity_GoogleData/heart_rate_${start}.csv`, 'timestamp,beats per minute,data source\n' + [...worn].flatMap((d) => [`${z(d, '04')},70,Fitbit Air`, `${z(d, '04', '01')},90,Fitbit Air`, `${z(d, '12')},56,Fitbit Air`]).join('\n') + '\n');
put(`Health Fitness Data_GoogleData/daily_resting_heart_rate_${start}.csv`, `timestamp,beats per minute,data source\n${D(2)}T00:00:00,62,Fitbit Air\n`);
put(`Health Fitness Data_GoogleData/daily_heart_rate_variability_${start}.csv`, `timestamp,average heart rate variability milliseconds,non rem heart rate beats per minute,entropy,deep sleep root mean square of successive differences milliseconds,data source\n${D(2)}T00:00:00,41.5,58,2.9,45.0,Fitbit Air\n${D(1)}T00:00:00,44.2,57,3.0,47.1,Fitbit Air\n`);
put(`Health Fitness Data_GoogleData/daily_oxygen_saturation_${start}.csv`, `timestamp,average percentage,lower bound percentage,upper bound percentage,baseline percentage,standard deviation percentage,data source\n${D(1)}T00:00:00,96.3,93.8,98.9,96.0,0.8,Fitbit Air\n`);
put(`Health Fitness Data_GoogleData/daily_respiratory_rate_${start}.csv`, `timestamp,breaths per minute,data source\n${D(1)}T00:00:00,14.8,Fitbit Air\n`);
put(`Health Fitness Data_GoogleData/daily_readiness_${start}.csv`, `timestamp,readiness score,readiness state,data source\n${D(1)}T00:00:00,74,HIGH,Fitbit Air\n`);
// Sleep: one row per stage segment (UTC). Night ending D(1) ~06:30 IST.
const segs = [['17:40', '17:55', 'AWAKE'], ['17:55', '19:20', 'LIGHT'], ['19:20', '20:30', 'DEEP'], ['20:30', '22:30', 'LIGHT'], ['22:30', '23:40', 'REM'], ['23:40', '00:20', 'LIGHT'], ['00:20', '00:58', 'REM'], ['00:58', '01:05', 'AWAKE']];
const n0 = D(2), n1 = D(1);
put(`Health Fitness Data_GoogleData/sleep_stages_${start}.csv`, 'start time,end time,sleep stage,data source\n' + segs.map(([a, b, k]) => `${a < '12:00' ? n1 : n0}T${a}:00Z,${b < '12:00' ? n1 : n0}T${b}:00Z,${k},Fitbit Air`).join('\n') + '\n');
// Google Health JSON sleep (other plausible shape), night ending D(2)
put(`Sleep/sleep-${start}.json`, [{ sleep: { interval: { startTime: `${D(3)}T17:30:00Z`, endTime: `${D(2)}T01:00:00Z` }, type: 'STAGES', stages: [{ type: 'LIGHT', startTime: `${D(3)}T17:30:00Z`, endTime: `${D(3)}T20:30:00Z` }, { type: 'DEEP', startTime: `${D(3)}T20:30:00Z`, endTime: `${D(3)}T21:30:00Z` }, { type: 'REM', startTime: `${D(3)}T21:30:00Z`, endTime: `${D(3)}T23:00:00Z` }, { type: 'LIGHT', startTime: `${D(3)}T23:00:00Z`, endTime: `${D(2)}T00:40:00Z` }, { type: 'AWAKE', startTime: `${D(2)}T00:40:00Z`, endTime: `${D(2)}T01:00:00Z` }] } }]);

(async () => {
  const out = await takeout.importFiles(files);
  const dates = Object.keys(out.days).sort(); if (process.env.DBG) console.log(JSON.stringify(out.days[T]), JSON.stringify(out.sleep));
  // 1. no future days, no placeholder days
  assert(dates.every((d) => d <= T), 'future day kept: ' + dates.filter((d) => d > T));
  assert.deepStrictEqual(dates, [D(3), D(2), D(1)], 'days ' + dates.join(','));
  assert(out.report.droppedDays.future >= 26, JSON.stringify(out.report.droppedDays));
  const y = out.days[D(1)], y2 = out.days[D(2)];
  // 2. activity
  assert.strictEqual(y.steps, 8500); assert.strictEqual(y.sedentary_minutes, 700); assert.strictEqual(y.active_minutes, 40);
  // 3. heart: resting HR (JSON zero entries ignored), HR from "beats per minute", HRV, SpO2, BR, readiness
  assert.strictEqual(y.resting_hr, 61.4); assert.strictEqual(y2.resting_hr, 62);
  assert(y.hr_avg > 50 && y.hr_min === 56 && y.hr_max === 90, `hr ${y.hr_avg} ${y.hr_min} ${y.hr_max}`);
  assert.strictEqual(y.hrv, 44.2); assert.strictEqual(y2.hrv, 41.5);
  assert.strictEqual(y.spo2_avg, 96.3); assert.strictEqual(y.spo2_min, 93.8);
  assert.strictEqual(y.breathing_rate, 14.8); assert.strictEqual(y.readiness, 74);
  // 4. sleep from stage-segment CSV (night ending D(1)) and Google Health JSON (night ending D(2))
  assert.strictEqual(out.sleep.length, 2, 'sessions ' + out.sleep.length);
  const s1 = out.sleep.find((s) => s.date === D(1));
  assert.strictEqual(s1.start, `${n0}T23:10`); assert.strictEqual(s1.end, `${n1}T06:35`);
  assert.strictEqual(s1.deep, 70); assert.strictEqual(s1.rem, 108); assert.strictEqual(s1.light, 245); assert.strictEqual(s1.wake, 22);
  assert.strictEqual(y.sleep_minutes, 423); assert.strictEqual(y.bedtime, `${n0}T23:10`);
  const s2 = out.sleep.find((s) => s.date === D(2));
  assert.strictEqual(s2.deep, 60); assert.strictEqual(s2.rem, 90); assert.strictEqual(s2.light, 280); assert.strictEqual(s2.wake, 20);
  assert.strictEqual(y2.sleep_minutes, 430);
  console.log('recognised', JSON.stringify(out.report.byType));
  console.log(`OK: real-shape export -> ${dates.length} days, ${out.sleep.length} sleep sessions, dropped ${JSON.stringify(out.report.droppedDays)}`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
