// Regression test built from the REAL structure of the Google Health Takeout of 6 Oct 2026
// (folder names, file names, column headers, JSON keys, stamp formats and timezone conventions copied from the
// real export; every value is synthetic). See docs/takeout-format.md.
'use strict';
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process');
const takeout = require('../lib/sources/takeout');
const { shouldRead } = require('../lib/parser');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh2026-')); const root = path.join(dir, 'Takeout', 'Google Health');
const put = (rel, body) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body, null, 2)); };
const PA = 'Physical Activity_GoogleData', HF = 'Health Fitness Data_GoogleData', GE = 'Global Export Data';
const us = (d, t) => { const [y, m, dd] = d.split('-'); return `${m}/${dd}/${y.slice(2)} ${t}`; }; // Global Export "MM/DD/YY HH:MM:SS"
const A = '2026-09-10', B = '2026-09-11', C = '2026-09-12'; // C = band day; A/B = phone only; plus a future pad day
const csv = (h, rows) => h + '\n' + rows.map((r) => r.join(',')).join('\n') + '\n';

// --- Steps: phone (MobileTrack) + its Health Connect mirror (same minutes) + band, UTC Z stamps -----------------
put(`${PA}/Steps/steps_2026-09-01.csv`, csv('timestamp,steps,data source', [
  [`${A}T04:00:00.000Z`, 1000, 'MobileTrack'], [`${A}T04:00:00.000Z`, 1000, 'Fit Health Connect'], [`${A}T10:00:00.000Z`, 500, 'MobileTrack'], [`${A}T10:00:00.000Z`, 450, 'Fit Health Connect'],
  // 19:00Z on A is 00:30 IST on B
  [`${A}T19:00:00.000Z`, 70, 'MobileTrack'],
  [`${C}T05:00:00Z`, 3000, 'MobileTrack'], [`${C}T05:00:00Z`, 2800, 'Google Fitbit Air'], [`${C}T05:00:00Z`, 3000, 'Fit Health Connect']]));
put(`${PA}/Distance/distance_2026-09-01.csv`, csv('timestamp,distance,data source', [[`${A}T04:00:00.000Z`, 800.5, 'Google Health App'], [`${A}T04:00:00.000Z`, 800.5, 'Fit Health Connect'], [`${A}T10:00:00.000Z`, 399.5, 'Google Health App']]));
// Live Pace repeats the band's steps -> must never be counted
put(`${PA}/Live Pace/live_pace_2026-09-12.csv`, csv('timestamp,steps,distance millimeters,altitude gain millimeters,data source', [[`${C}T05:00:00Z`, 99999, 1, 0, 'Google Fitbit Air']]));
put(`${PA}/Calories/calories_2026-09-01.csv`, csv('timestamp,calories,data source', [[`${A}T04:00:00Z`, 1.5, 'Google Health App'], [`${A}T04:01:00Z`, 1.5, 'Google Health App'], [`${A}T04:00:00Z`, 9, 'Fit Health Connect']]));
put(`${PA}/Active Minutes/active_minutes_2026-09-01.csv`, csv('timestamp,light,moderate,very,data source', [[`${A}T04:00:00Z`, 1, 0, 0, 'Google Health App'], [`${A}T04:01:00Z`, 0, 1, 0, 'Google Health App'], [`${A}T04:02:00Z`, 0, 0, 1, 'Google Health App']]));
// --- Band-only families on C -------------------------------------------------------------------------------------
put(`${PA}/Heart Rate/heart_rate_2026-09-12.csv`, csv('timestamp,beats per minute,data source', [[`${C}T04:00:00Z`, 80, 'Google Fitbit Air'], [`${C}T04:00:05Z`, 100, 'Google Fitbit Air'], [`${C}T04:00:10Z`, 120.0, 'Google Fitbit Air'], [`${C}T04:00:00Z`, 60, 'Some Phone App'],
  [`${C}T18:45:00Z`, 70, 'Google Fitbit Air']])); // 00:15 IST next day -> must land on C+1
put(`${PA}/Daily Resting Heart Rate/daily_resting_heart_rate.csv`, csv('timestamp,beats per minute,data source', [[`${C}T00:00:00Z`, 61.234, 'Google Health App']]));
put(`${PA}/Active Zone Minutes/active_zone_minutes_2026-09-01.csv`, csv('timestamp,heart rate zone,total minutes,data source', [[`${C}T04:00:00Z`, 'FAT_BURN', 1, 'Google Fitbit Air'], [`${C}T04:01:00Z`, 'CARDIO', 2, 'Google Fitbit Air'], [`${C}T04:02:00Z`, 'PEAK', 2, 'Google Fitbit Air']]));
put(`${PA}/Body Temperature/body_temperature_2026-09-12.csv`, csv('timestamp,temperature celsius,data source', [[`${C}T04:00:00Z`, 33.0, 'Google Fitbit Air'], [`${C}T05:00:00Z`, 34.0, 'Google Fitbit Air']]));
put(`${PA}/Weight/weight.csv`, csv('timestamp,weight grams,data source', [[`${A}T03:00:00.000000Z`, 70000, 'Fit Health Connect'], [`${A}T05:00:00.000000Z`, 70500, 'Google Health App']]));
put(`${PA}/Calories In Heart Rate Zone/calories_in_heart_rate_zone_2026-09-12.csv`, csv('timestamp,heart rate zone,kcal,data source', [[`${C}T04:00:00Z`, 'PEAK', 5, 'Google Fitbit Air']]));
// --- Sleep: UserSleeps + UserSleepStages (UTC + explicit offsets). Night ending on C at 06:30 IST ----------------
const SH = 'sleep_id,sleep_type,minutes_in_sleep_period,minutes_after_wake_up,minutes_to_fall_asleep,minutes_asleep,minutes_awake,minutes_longest_awakening,minutes_to_persistent_sleep,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source,algorithm_version,sleep_created,sleep_last_updated';
put(`${HF}/UserSleeps_2026-09-01.csv`, csv(SH, [['111', 'STAGES', 450, 0, 5, 410, 40, 12, 9, '+05:30', `${B}T17:30:00Z`, '+05:30', `${C}T01:00:00Z`, 'GOOGLE_FITBIT_AIR', 3, `${C}T01:05:00Z`, `${C}T01:05:00Z`]]));
const GH = 'sleep_id,sleep_stage_id,sleep_stage_type,start_utc_offset,sleep_stage_start,end_utc_offset,sleep_stage_end,data_source,algorithm_version,sleep_stage_created,sleep_stage_last_updated';
const seg = [['AWAKE', '17:30', '17:45', B], ['LIGHT', '17:45', '19:15', B], ['DEEP', '19:15', '20:30', B], ['REM', '20:30', '22:00', B], ['LIGHT', '22:00', '23:55', B], ['AWAKE', '23:55', '00:20', B, C], ['REM', '00:20', '01:00', C]];
put(`${HF}/UserSleepStages_2026-09-01.csv`, csv(GH, seg.map(([t, s, e, d1, d2], i) => ['111', i, t, '+05:30', `${d1}T${s}:00Z`, '+05:30', `${d2 || d1}T${e}:00Z`, 'GOOGLE_FITBIT_AIR', 3, '', ''])));
put(`${HF}/UserExercises_2026-09-01.csv`, 'exercise_id,exercise_start,exercise_end,utc_offset,activity_name,log_type\n1,x,y,+05:30,Outdoor Walk,AUTO_DETECTED\n');
put(`${HF}/UserActivityProbabilities_2026-09-01.csv`, csv('timestamp,steps,data source', [[`${A}T04:00:00Z`, 77777, 'x']]));
// --- Global Export Data (reconciled Fitbit stream) -------------------------------------------------------------
// steps/distance minute stamps are UTC; calories minute stamps are LOCAL; daily minutes series are local dates and
// padded with 1440-minute sedentary placeholders past the export date.
put(`${GE}/steps-2026-09-11.json`, [{ dateTime: us(C, '05:00:00'), value: '2900' }, { dateTime: us(C, '20:00:00'), value: '15' }]); // 20:00Z = 01:30 IST next day
put(`${GE}/distance-2026-09-11.json`, [{ dateTime: us(C, '05:00:00'), value: '230000' }]); // cm -> 2.3 km
put(`${GE}/calories-2026-09-11.json`, [{ dateTime: us(C, '23:59:00'), value: '1.25' }, { dateTime: us(C, '00:05:00'), value: '1.25' }]); // both local C
put(`${GE}/sedentary_minutes-2026-09-11.json`, [{ dateTime: us(C, '00:00:00'), value: '800' }, { dateTime: '12/31/99 00:00:00', value: '1440' }]);
put(`${GE}/very_active_minutes-2026-09-11.json`, [{ dateTime: us(C, '00:00:00'), value: '30' }]);
put(`${GE}/moderately_active_minutes-2026-09-11.json`, [{ dateTime: us(C, '00:00:00'), value: '20' }]);
put(`${GE}/lightly_active_minutes-2026-09-11.json`, [{ dateTime: us(C, '00:00:00'), value: '200' }]);
put(`${GE}/resting_heart_rate-2026-09-11.json`, [{ dateTime: us(B, '00:00:00'), value: { date: null, value: 0.0, error: 0.0 } }, { dateTime: us(C, '00:00:00'), value: { date: us(C, '').trim(), value: 61.2, error: 5 } }]);
put(`${GE}/demographic_vo2_max-2026-09-11.json`, [{ dateTime: us(C, '00:00:00'), value: { demographicVO2Max: 41.234, demographicVO2MaxError: 3, filteredDemographicVO2Max: 40.8, filteredDemographicVO2MaxError: 2 } }]);
put(`${GE}/weight-2026-09-11.json`, [{ logId: 1, weight: 999, bmi: 99, date: us(A, '').trim(), time: '00:00:00', source: 'API' }]);
// --- Legacy folders as found: header-only / README-only / device list --------------------------------------------
put('Sleep Score/sleep_score.csv', 'sleep_log_entry_id,timestamp,overall_score,composition_score,revitalization_score,duration_score,deep_sleep_in_minutes,resting_heart_rate,restlessness\n');
put('Stress Score/Stress Score.csv', 'DATE,UPDATED_AT,STRESS_SCORE,SLEEP_POINTS,MAX_SLEEP_POINTS,RESPONSIVENESS_POINTS,MAX_RESPONSIVENESS_POINTS,EXERTION_POINTS,MAX_EXERTION_POINTS,STATUS,CALCULATION_FAILED\n');
put('Heart Rate Variability/README.txt', 'readme');
put('Active Zone Minutes (AZM)/Active Zone Minutes - 2026-09-01.csv', `date_time,heart_zone_id,total_minutes\n${C}T09:30,FAT_BURN,50\n`);
put('Paired Devices/Trackers.csv', 'tracker_id,date_added,last_sync_date_time,batt_level,tracker_name,device_type\n1,2026-05-08,2026-09-12T11:00:00.000Z,50,,MobileTrack\n2,2026-09-12,2026-09-12T12:00:00.000Z,90,,Fitbit Air\n');
put('Biometrics/Glucose 202609.csv', 'no data');
put('Account Changes/Account_Access_Events_1.csv', 'timestamp,steps\n2026-09-10T00:00:00Z,123456\n');

function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; }

function check(out, label) {
  const D = out.days;
  // Steps: never summed across sources. A = phone 1500 (mirror ignored); B = the 00:30 IST minute; C = Global JSON wins.
  assert.strictEqual(D[A].steps, 1500, `${label}: A steps`);
  assert.strictEqual(D[B].steps, 70, `${label}: B steps (UTC->IST rollover)`);
  assert.strictEqual(D[C].steps, 2900, `${label}: C steps = reconciled Global Export, not 3000+2800+3000 or Live Pace`);
  assert.strictEqual(D[A].distance_km, 1.2, `${label}: A distance metres->km, one source`);
  assert.strictEqual(D[C].distance_km, 2.3, `${label}: C distance from cm JSON`);
  assert.strictEqual(D[A].calories, 3, `${label}: A calories from Google Health App, mirror not added`);
  assert.strictEqual(D[C].calories, 3, `${label}: C calories, JSON local stamps (23:59 stays on C)`);
  assert.deepStrictEqual([D[A].light_minutes, D[A].fairly_active_minutes, D[A].very_active_minutes], [1, 1, 1], `${label}: A active minutes`);
  assert.deepStrictEqual([D[C].light_minutes, D[C].fairly_active_minutes, D[C].very_active_minutes, D[C].sedentary_minutes], [200, 20, 30, 800], `${label}: C daily JSON`);
  assert.strictEqual(D[A].weight_kg, 70.5, `${label}: latest weight grams->kg`);
  // Heart: band preferred, IST day boundary
  assert.deepStrictEqual([D[C].hr_avg, D[C].hr_min, D[C].hr_max, D[C].hr_samples], [100, 80, 120, 3], `${label}: C HR from band only`);
  assert.strictEqual(D['2026-09-13'].hr_avg, 70, `${label}: 18:45Z HR -> next IST day`);
  assert.strictEqual(D[C].resting_hr, 61.2, `${label}: resting HR`);
  assert.strictEqual(D[B].resting_hr, undefined, `${label}: zero placeholder RHR ignored`);
  assert.strictEqual(D[C].azm, 5, `${label}: AZM from Google-data family (legacy AZM folder not added)`);
  assert.strictEqual(D[C].skin_temp_c, 33.5, `${label}: body temperature mean`);
  assert.strictEqual(D[C].vo2_max, 40.8, `${label}: VO2 max filtered value`);
  // Sleep
  const s = out.sleep.find((x) => x.logId === '111'); assert.ok(s, `${label}: sleep session`);
  assert.strictEqual(s.date, C); assert.strictEqual(s.start, `${B}T23:00`); assert.strictEqual(s.end, `${C}T06:30`);
  assert.deepStrictEqual([s.minutes_asleep, s.time_in_bed, s.deep, s.light, s.rem, s.wake], [410, 450, 75, 205, 130, 40], `${label}: sleep stages`);
  assert.strictEqual(D[C].sleep_minutes, 410); assert.strictEqual(D[C].sleep_deep, 75); assert.strictEqual(D[C].waketime, `${C}T06:30`);
  // No placeholder/future days, nothing from skipped families
  assert.ok(!Object.keys(D).some((d) => d > '2026-10-06' || d.startsWith('2099')), `${label}: future padding dropped`);
  assert.ok(!Object.values(D).some((d) => d.steps >= 77777), `${label}: skipped families not parsed`);
  assert.strictEqual(out.report.devices.length, 2); assert.strictEqual(out.report.exercises, 1);
  assert.deepStrictEqual(Object.keys(out.report.dataSources.steps).sort(), ['Fit Health Connect', 'Google Fitbit Air', 'MobileTrack']);
}

(async () => {
  const files = walk(path.join(dir, 'Takeout')).map((p) => ({ path: p, relPath: path.relative(dir, p) }));
  check(await takeout.importFiles(files), 'folder');
  // Same tree as a zip (exercises the decompression pre-filter)
  const zip = path.join(dir, 'takeout-20260912T000000Z-1-001.zip');
  execFileSync('python3', ['-c', 'import sys,os,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED)\nfor r,_,fs in os.walk(sys.argv[2]):\n  for f in fs:\n    p=os.path.join(r,f); z.write(p,os.path.relpath(p,os.path.dirname(sys.argv[2])))\nz.close()', zip, path.join(dir, 'Takeout')]);
  check(await takeout.importFiles([{ path: zip, relPath: path.basename(zip) }]), 'zip');
  for (const [p, want] of [[`Takeout/Google Health/${HF}/UserActivityProbabilities_2026-09-01.csv`, false], [`Takeout/Google Health/${PA}/Live Pace/x.csv`, false], [`Takeout/Google Health/${PA}/Steps/s.csv`, true], ['Takeout/Google Health/Account Changes/a.csv', false], [`Takeout/Google Health/${HF}/UserSleeps_x.csv`, true]]) assert.strictEqual(shouldRead(p), want, p);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('OK: 2026 Google Health Takeout structure (folder + zip): dedup, timezones, sleep join, band preference, skips');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
