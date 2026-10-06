'use strict';
/**
 * Data-source interface.
 *
 * Every source produces the same normalised shape and is merged into the store:
 *   { days: { 'YYYY-MM-DD': { steps, calories, active_minutes, resting_hr, hrv, spo2_avg,
 *                              sleep_minutes, sleep_deep/light/rem/wake, sleep_score, readiness, ... } },
 *     sleep: [ { logId, date, start, end, minutes_asleep, deep, light, rem, wake, efficiency, score, main } ],
 *     report: { ... } }
 *
 * interface DataSource {
 *   id: string; label: string; kind: 'sample' | 'file' | 'live';
 *   status(): { available: boolean, configured: boolean, note: string }
 *   // file sources:   importFiles(files) -> Promise<{days, sleep, report}>
 *   // live sources:   authUrl(), handleCallback(query), sync({ since }) -> Promise<{days, sleep, report}>
 * }
 */
const sample = require('./sample');
const takeout = require('./takeout');
const googleHealthApi = require('./googleHealthApi');

const sources = { [sample.id]: sample, [takeout.id]: takeout, [googleHealthApi.id]: googleHealthApi };
const healthConnect = require('./healthConnect'); // Android Health Connect phone sync
sources[healthConnect.id] = healthConnect;
function list() { return Object.values(sources).map((s) => ({ id: s.id, label: s.label, kind: s.kind, ...s.status() })); }
module.exports = { sources, list };
