'use strict';
/**
 * Health Connect phone sync (Android app "Air Health Sync", android/).
 *
 * The phone reads Health Connect (fed by the Google Health app, i.e. the Fitbit Air) and POSTs gzip JSON batches to
 * /api/hc/ingest with a per-device bearer token. Records are stored raw per local day in data/hc/days/<date>.json
 * (idempotent by record id + lastModified), then derived into the normalised day rows / sleep sessions / intraday HR
 * used everywhere else and overlaid on the real dataset with source 'Health Connect'.
 *
 * Merge rules
 *  - For a day and metric that Health Connect has, Health Connect wins (also over a later Takeout re-import:
 *    store.mergeReal is wrapped so HC fields are re-applied on top). Metrics HC lacks (AZM, readiness, ...) are kept.
 *  - Never sum origins. Per day and metric one origin is used: the Google Health / Fitbit app first
 *    (com.fitbit.FitbitMobile), then HC's own de-duplicated daily aggregate (steps/distance/calories), then the
 *    best-ranked other origin.
 *  - Sleep sessions from HC replace Takeout sessions that overlap them in time.
 *  - Intraday HR: an HC day replaces that day's intraday file (zones are kept).
 *
 * Wire format: see android/app/src/main/java/com/vansh/airhealth/sync/Wire.kt.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const express = require('express');
const store = require('../store');
const intraday = require('../intraday');
const { USER_TZ, tzOffsetMinutes, todayLocal, addDays } = require('../util');

const HC_DIR = () => path.join(store.DATA_DIR, 'hc');
const DAYS_DIR = () => path.join(HC_DIR(), 'days');
const DEVICE_FILE = () => path.join(HC_DIR(), 'device.json');
const STATE_FILE = () => path.join(HC_DIR(), 'state.json');
const DERIVED_FILE = () => path.join(HC_DIR(), 'derived.json');
const APK = () => process.env.HC_APK_PATH || path.join(__dirname, '..', '..', 'dist', 'AirHealthSync.apk');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE = 'Health Connect';

const TYPES = new Set(['Steps', 'Distance', 'ActiveCaloriesBurned', 'TotalCaloriesBurned', 'HeartRate', 'RestingHeartRate', 'HeartRateVariabilityRmssd',
  'SleepSession', 'OxygenSaturation', 'RespiratoryRate', 'SkinTemperature', 'Vo2Max', 'ExerciseSession', 'Weight']);
const SIGNAL = ['steps', 'distance_km', 'active_calories', 'resting_hr', 'hr_avg', 'hrv', 'spo2_avg', 'breathing_rate', 'sleep_minutes', 'time_in_bed', 'exercise_count', 'vo2_max'];
const NIGHT_TYPES = new Set(['HeartRateVariabilityRmssd', 'OxygenSaturation', 'RespiratoryRate']); // >= 18:00 local -> next morning's date

// ---------------------------------------------------------------- origins
const ORIGINS = [
  { re: /^com\.fitbit\.FitbitMobile$/, label: 'Google Health app (Fitbit)', rank: 100 },
  { re: /^com\.google\.android\.apps\.(fitbit|health)/, label: 'Google Health', rank: 95 },
  { re: /^com\.google\.android\.apps\.fitness$/, label: 'Google Fit', rank: 50 },
  { re: /^com\.sec\.android\.app\.shealth$/, label: 'Samsung Health', rank: 40 },
  { re: /^(android|com\.google\.android\.apps\.healthdata|com\.android\.healthconnect.*)$/, label: 'Android / Health Connect (phone)', rank: 20 },
];
function originInfo(pkg) { const o = ORIGINS.find((x) => x.re.test(pkg || '')); return o ? { label: o.label, rank: o.rank } : { label: pkg || 'unknown', rank: 30 }; }
const isFitbit = (pkg) => originInfo(pkg).rank >= 95;

// ---------------------------------------------------------------- small fs helpers (0700 dirs, 0600 files)
function ensureDirs() { for (const d of [HC_DIR(), DAYS_DIR()]) { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); try { fs.chmodSync(d, 0o700); } catch {} } }
function readJson(f, dflt) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } }
function writeJson(f, v) { const d = path.dirname(f); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); try { fs.chmodSync(HC_DIR(), 0o700); fs.chmodSync(d, 0o700); } catch {} const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 }); fs.renameSync(tmp, f); }
const dayFile = (d) => path.join(DAYS_DIR(), `${d}.json`);
function readDay(d) { return readJson(dayFile(d), null) || { date: d, records: {}, agg: null }; }
function listDays() { try { return fs.readdirSync(DAYS_DIR()).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort(); } catch { return []; } }
const blankState = () => ({ lastIngestAt: null, ingests: 0, records: 0, duplicates: 0, deleted: 0, origins: {}, lastBatch: null, resync: false });
function readState() { return { ...blankState(), ...readJson(STATE_FILE(), {}) }; }

// ---------------------------------------------------------------- time helpers
function offMin(ms, offSec) { return offSec != null && Number.isFinite(+offSec) ? Math.round(+offSec / 60) : tzOffsetMinutes(USER_TZ, new Date(ms)); }
/** Local wall clock of an instant: { date: 'YYYY-MM-DD', min: minute of day, hhmm: 'YYYY-MM-DDTHH:MM' }. */
function local(ms, offSec) {
  const iso = new Date(ms + offMin(ms, offSec) * 60000).toISOString();
  return { date: iso.slice(0, 10), min: +iso.slice(11, 13) * 60 + +iso.slice(14, 16), hhmm: iso.slice(0, 16) };
}
const r1 = (v) => Math.round(v * 10) / 10; const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- device token + pairing
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function device() { return readJson(DEVICE_FILE(), null); }
function checkBearer(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/);
  const d = device(); if (!m || !d || !d.tokenHash) return null;
  const a = Buffer.from(sha(m[1])), b = Buffer.from(d.tokenHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? d : null;
}
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let pairing = null; // { hash, expires, tries } — in memory only, single use, 10 minutes
function newPairingCode() {
  let c = ''; for (let i = 0; i < 8; i++) c += CODE_ALPHA[crypto.randomInt(CODE_ALPHA.length)];
  pairing = { hash: sha(c), expires: Date.now() + 10 * 60000, tries: 0 };
  return { code: `${c.slice(0, 4)}-${c.slice(4)}`, expiresAt: pairing.expires };
}
/** Exchange a pairing code for a new device token (replaces any previous phone). Returns the token or throws {status}. */
function claim(code, deviceName) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const err = (status, msg) => Object.assign(new Error(msg), { status });
  if (!pairing) throw err(404, 'No pairing code is active. Make a new code on the Data page.');
  if (Date.now() > pairing.expires) { pairing = null; throw err(410, 'That pairing code has expired.'); }
  if (++pairing.tries > 5) { pairing = null; throw err(429, 'Too many wrong codes. Make a new code on the Data page.'); }
  const a = Buffer.from(sha(c)), b = Buffer.from(pairing.hash);
  if (!crypto.timingSafeEqual(a, b)) throw err(404, 'That pairing code is not valid.');
  pairing = null;
  const token = crypto.randomBytes(32).toString('base64url');
  writeJson(DEVICE_FILE(), { tokenHash: sha(token), deviceName: String(deviceName || 'Android phone').slice(0, 120), pairedAt: new Date().toISOString(), lastSeenAt: null });
  const st = readState(); st.resync = false; writeJson(STATE_FILE(), st);
  return token;
}
function unpair() { try { fs.rmSync(DEVICE_FILE(), { force: true }); } catch {} pairing = null; }

// ---------------------------------------------------------------- ingest
function validRecord(r) {
  return r && typeof r === 'object' && TYPES.has(r.t) && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 200 &&
    Number.isFinite(+r.lm) && Number.isFinite(+r.s) && +r.s > Date.UTC(2000, 0, 1) && +r.s < Date.now() + 2 * 864e5 && (r.e == null || Number.isFinite(+r.e));
}
/** Which local day file(s) a record lives in: { date: storedRecord }. HR samples are split per local day. */
function placements(r) {
  const base = { t: r.t, lm: +r.lm, o: String(r.o || 'unknown').slice(0, 200), dev: r.dev ? String(r.dev).slice(0, 120) : null, s: +r.s, e: r.e == null ? null : +r.e, so: r.so ?? null, eo: r.eo ?? null };
  const v = r.v && typeof r.v === 'object' ? r.v : {};
  if (r.t === 'HeartRate') {
    const by = {};
    for (const x of Array.isArray(v.hr) ? v.hr : []) {
      if (!Array.isArray(x) || !Number.isFinite(+x[0]) || !(+x[1] > 20 && +x[1] < 260)) continue;
      (by[local(+x[0], base.so).date] ||= []).push([+x[0], +x[1]]);
    }
    return Object.fromEntries(Object.entries(by).map(([d, hr]) => [d, { ...base, v: { hr } }]));
  }
  let date;
  if (r.t === 'SleepSession' || r.t === 'SkinTemperature') date = local(base.e ?? base.s, base.e != null ? base.eo : base.so).date; // night -> wake date
  else if (NIGHT_TYPES.has(r.t)) { const l = local(base.s, base.so); date = l.min >= 18 * 60 ? addDays(l.date, 1) : l.date; }
  else date = local(base.s, base.so).date;
  return { [date]: { ...base, v } };
}

/**
 * Apply one batch. payload: { kind, batch, tz, app, device, days, records[], deleted[], aggregates[] }.
 * Returns { accepted, duplicates, deleted, days }.
 */
function ingest(payload, info = {}) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.records || [])) throw Object.assign(new Error('bad payload'), { status: 400 });
  ensureDirs();
  const st = readState();
  const touched = new Map(); // date -> day object (loaded lazily)
  const load = (d) => { if (!touched.has(d)) touched.set(d, readDay(d)); return touched.get(d); };
  let accepted = 0, dup = 0, del = 0, bad = 0;
  for (const r of payload.records || []) {
    if (!validRecord(r)) { bad++; continue; }
    const pl = placements(r); let any = false, fresh = false;
    for (const [d, rec] of Object.entries(pl)) {
      if (!DATE.test(d)) continue; any = true;
      const day = load(d); const old = day.records[r.id];
      if (old && old.lm > rec.lm) continue; // never go back to an older version
      if (old && old.lm === rec.lm && sameValues(old.v, rec.v)) continue;
      day.records[r.id] = rec; fresh = true;
    }
    if (!any) { bad++; continue; }
    if (fresh) accepted++; else dup++;
    const o = (st.origins[String(r.o || 'unknown')] ||= { types: {}, devices: [], first: null, last: null });
    o.types[r.t] = (o.types[r.t] || 0) + (fresh ? 1 : 0);
    if (r.dev && !o.devices.includes(String(r.dev)) && o.devices.length < 8) o.devices.push(String(r.dev).slice(0, 120));
    const day = local(+r.s, r.so).date; if (!o.first || day < o.first) o.first = day; if (!o.last || day > o.last) o.last = day;
  }
  for (const a of payload.aggregates || []) {
    if (!a || !DATE.test(a.date)) continue;
    const day = load(a.date);
    day.agg = { steps: num(a.steps), distance_m: num(a.distance_m), kcal_total: num(a.kcal_total), kcal_active: num(a.kcal_active), origins: Array.isArray(a.origins) ? a.origins.slice(0, 20).map(String) : [], at: Date.now() };
  }
  const gone = new Set((payload.deleted || []).filter((x) => typeof x === 'string' && x.length <= 200));
  if (gone.size) {
    // Prefer days already touched / named in the batch / recent — full scan only if IDs remain.
    const prefer = new Set([...touched.keys()]);
    for (const d of payload.days || []) if (DATE.test(d)) prefer.add(d);
    const all = listDays();
    for (const d of all.slice(-45)) prefer.add(d);
    const tryDays = (dates) => {
      for (const d of dates) {
        if (!gone.size) break;
        const day = touched.get(d) || readDay(d); let hit = false;
        for (const id of [...gone]) if (day.records[id]) { delete day.records[id]; gone.delete(id); hit = true; del++; }
        if (hit) touched.set(d, day);
      }
    };
    tryDays([...prefer]);
    if (gone.size) tryDays(all.filter((d) => !prefer.has(d)));
  }
  const changed = accepted > 0 || del > 0 || (payload.aggregates || []).length > 0;
  if (changed) for (const [d, day] of touched) writeJson(dayFile(d), day);
  else if (touched.size) { /* aggregates-only already marked changed; pure-dup batch: skip rewrite */ }
  // Always refresh last-seen so the dashboard shows the phone is alive, even on no-op syncs.
  st.lastIngestAt = Date.now(); st.ingests++; st.records += accepted; st.duplicates += dup; st.deleted += del;
  st.lastBatch = { kind: String(payload.kind || ''), batch: String(payload.batch || '').slice(0, 64), at: st.lastIngestAt, accepted, duplicates: dup, deleted: del, invalid: bad, days: [...touched.keys()].sort() };
  if (payload.kind === 'backfill') st.resync = false;
  if (payload.app) st.app = String(payload.app).slice(0, 40);
  writeJson(STATE_FILE(), st);
  const dev = device(); if (dev) { dev.lastSeenAt = new Date().toISOString(); if (payload.device) dev.deviceName = String(payload.device).slice(0, 120); writeJson(DEVICE_FILE(), dev); }
  const daysOut = [...touched.keys()].sort();
  // Derive into the dashboard store. HTTP path can defer this so the phone gets an ACK first.
  if (changed && !info.deferApply) applyDays(daysOut);
  return { accepted, duplicates: dup, deleted: del, invalid: bad, days: daysOut, _changed: changed };
}
/** Cheap equality for HC values: HR compares sample counts + first/last; others JSON. */
function sameValues(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (Array.isArray(a.hr) && Array.isArray(b.hr)) {
    if (a.hr.length !== b.hr.length) return false;
    if (!a.hr.length) return true;
    const x0 = a.hr[0], y0 = b.hr[0], x1 = a.hr[a.hr.length - 1], y1 = b.hr[b.hr.length - 1];
    return x0[0] === y0[0] && x0[1] === y0[1] && x1[0] === y1[0] && x1[1] === y1[1];
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
const num = (v) => (v == null || !Number.isFinite(+v) ? null : +v);

// ---------------------------------------------------------------- derive normalised rows from one day's raw records
function pickOrigin(byOrigin) {
  return Object.entries(byOrigin).sort((a, b) => originInfo(b[0]).rank - originInfo(a[0]).rank || b[1].length - a[1].length)[0] || null;
}
function sleepSession(id, r) {
  const st = { DEEP: 0, LIGHT: 0, REM: 0, ASLEEP: 0, AWAKE: 0, AWAKE_IN_BED: 0, OUT_OF_BED: 0, UNKNOWN: 0 };
  for (const g of Array.isArray(r.v.stages) ? r.v.stages : []) { const k = st[g[2]] != null ? g[2] : 'UNKNOWN'; st[k] += Math.max(0, (+g[1] - +g[0]) / 60000); }
  const total = Math.round(((r.e ?? r.s) - r.s) / 60000);
  const staged = st.DEEP + st.LIGHT + st.REM > 0;
  const hasStages = Object.values(st).some((x) => x > 0);
  const asleep = Math.round(hasStages ? st.DEEP + st.LIGHT + st.REM + st.ASLEEP : total);
  const wake = Math.round(st.AWAKE + st.AWAKE_IN_BED + st.OUT_OF_BED);
  const s = local(r.s, r.so), e = local(r.e ?? r.s, r.eo ?? r.so);
  return { logId: `hc:${id}`, date: e.date, start: s.hhmm, end: e.hhmm, minutes_asleep: asleep, minutes_awake: wake, time_in_bed: total,
    efficiency: total > 0 ? Math.round(asleep / total * 100) : null, deep: staged ? Math.round(st.DEEP) : null, light: staged ? Math.round(st.LIGHT) : null,
    rem: staged ? Math.round(st.REM) : null, wake: hasStages ? wake : null, main: asleep >= 180, type: staged ? 'stages' : 'classic', source: SOURCE, origin: r.o, score: null };
}
function derive(day) {
  const by = {}; // type -> origin -> [[id, rec]]
  for (const [id, r] of Object.entries(day.records || {})) ((by[r.t] ||= {})[r.o] ||= []).push([id, r]);
  const f = {}; let mainOrigin = null; let hr = null; const sessions = [];
  const sum = (list, k) => list.reduce((t, [, r]) => t + (+r.v[k] || 0), 0);
  const latest = (list, k) => { const x = list.slice().sort((a, b) => b[1].s - a[1].s)[0]; return x ? +x[1].v[k] : null; };
  const mean = (list, k) => { const v = list.map(([, r]) => +r.v[k]).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  // HC's aggregate fills total calories with an estimated BMR even on empty days, so it only counts on days with records.
  const agg = Object.keys(day.records || {}).length ? day.agg || {} : {};
  // Additive daily totals: Fitbit-origin records, else HC's de-duplicated aggregate, else the best single origin.
  for (const [type, k, field, aggKey, fmt] of [['Steps', 'count', 'steps', 'steps', Math.round], ['Distance', 'm', 'distance_km', 'distance_m', (m) => r2(m / 1000)],
    ['TotalCaloriesBurned', 'kcal', 'calories', 'kcal_total', Math.round], ['ActiveCaloriesBurned', 'kcal', 'active_calories', 'kcal_active', Math.round]]) {
    const p = pickOrigin(by[type] || {});
    if (p && isFitbit(p[0])) { f[field] = fmt(sum(p[1], k)); if (type === 'Steps') mainOrigin = p[0]; }
    else if (agg[aggKey] != null && agg[aggKey] > 0) f[field] = fmt(agg[aggKey]);
    else if (p) { f[field] = fmt(sum(p[1], k)); if (type === 'Steps') mainOrigin = p[0]; }
  }
  { const p = pickOrigin(by.HeartRate || {}); if (p) {
    const s = [], m = { s: new Array(1440).fill(0), n: new Array(1440).fill(0), mn: new Array(1440).fill(Infinity), mx: new Array(1440).fill(-Infinity) };
    const seen = new Set(); // overlapping records from one app must not double-count a sample
    for (const [, r] of p[1]) for (const [t, b] of r.v.hr || []) { const l = local(t, r.so); if (l.date !== day.date || seen.has(t)) continue; seen.add(t); s.push(b); m.s[l.min] += b; m.n[l.min]++; if (b < m.mn[l.min]) m.mn[l.min] = b; if (b > m.mx[l.min]) m.mx[l.min] = b; }
    if (s.length) {
      f.hr_avg = r1(s.reduce((a, b) => a + b, 0) / s.length); f.hr_min = Math.min(...s); f.hr_max = Math.max(...s); f.hr_samples = s.length;
      const avg = m.n.map((n, i) => (n ? r1(m.s[i] / n) : null)), mn = m.n.map((n, i) => (n ? Math.round(m.mn[i]) : null)), mx = m.n.map((n, i) => (n ? Math.round(m.mx[i]) : null));
      hr = { date: day.date, tz: USER_TZ, source: SOURCE, origin: p[0], step: 60, samples: s.length, avg, min: mn, max: mx, zones: null };
      mainOrigin ||= p[0];
    }
  } }
  const one = (type) => pickOrigin(by[type] || {});
  { const p = one('RestingHeartRate'); if (p) f.resting_hr = r1(latest(p[1], 'bpm')); }
  { const p = one('HeartRateVariabilityRmssd'); if (p) f.hrv = r1(mean(p[1], 'ms')); }
  { const p = one('OxygenSaturation'); if (p) f.spo2_avg = r1(mean(p[1], 'pct')); }
  { const p = one('RespiratoryRate'); if (p) f.breathing_rate = r1(mean(p[1], 'rate')); }
  { const p = one('Vo2Max'); if (p) f.vo2_max = r1(latest(p[1], 'v')); }
  { const p = one('Weight'); if (p) f.weight_kg = r1(latest(p[1], 'kg')); }
  { const p = one('SkinTemperature'); if (p) {
    const ds = p[1].flatMap(([, r]) => (r.v.deltas || []).map((x) => +x[1]).filter(Number.isFinite));
    if (ds.length) f.skin_temp_delta_c = r2(ds.reduce((a, b) => a + b, 0) / ds.length);
    const base = p[1].map(([, r]) => +r.v.baseline).find(Number.isFinite);
    if (base != null) f.skin_temp_c = r1(base + (f.skin_temp_delta_c || 0));
  } }
  { const p = one('ExerciseSession'); if (p) { f.exercise_count = p[1].length; f.exercise_minutes = Math.round(p[1].reduce((t, [, r]) => t + Math.max(0, ((r.e ?? r.s) - r.s) / 60000), 0)); f.exercises = p[1].map(([, r]) => r.v.name || 'Exercise').slice(0, 10).join(', '); } }
  { const p = one('SleepSession'); if (p) {
    for (const [id, r] of p[1]) { const x = sleepSession(id, r); if (x.date === day.date && (x.minutes_asleep || x.time_in_bed)) sessions.push(x); }
    if (sessions.length) {
      const main = sessions.find((x) => x.main) || sessions.slice().sort((a, b) => b.minutes_asleep - a.minutes_asleep)[0];
      const s = (k) => sessions.reduce((t, x) => t + (x[k] || 0), 0);
      f.sleep_minutes = s('minutes_asleep'); f.time_in_bed = s('time_in_bed');
      for (const k of ['deep', 'light', 'rem', 'wake']) if (sessions.some((x) => x[k] != null)) f[`sleep_${k}`] = s(k);
      if (main.efficiency != null) f.sleep_efficiency = main.efficiency; f.bedtime = main.start; f.waketime = main.end;
    }
  } }
  const fields = Object.keys(f);
  if (fields.length) { f.hc_source = SOURCE; if (mainOrigin) f.hc_origin = mainOrigin; }
  return { fields: f, sessions, hr };
}

// ---------------------------------------------------------------- overlay onto the store
const realMerge = store.mergeReal; const realClear = store.clearReal;
function derivedCache() { return readJson(DERIVED_FILE(), {}); }
const overlaps = (a, b) => a.start && a.end && b.start && b.end && a.start < b.end && b.start < a.end;

/** Serialize deferred applyDays so overlapping HTTP ingests cannot clobber store.json. */
let applyQueue = Promise.resolve();
function enqueueApply(dates) {
  applyQueue = applyQueue.then(() => { try { applyDays(dates); } catch (e) { console.warn('hc applyDays failed:', e.message); } });
  return applyQueue;
}

/** Re-derive the given HC days and write them into the real dataset (HC wins per field; stale HC fields removed). */
function applyDays(dates) {
  const cache = derivedCache(); const s = store.load();
  const parsed = { days: {}, sleep: [] }; const hcSessions = [];
  for (const d of dates) {
    if (!DATE.test(d) || d > todayLocal(USER_TZ)) continue;
    const day = readDay(d); const { fields, sessions, hr } = derive(day);
    const prev = cache[d]; const row = s.real.days[d];
    if (prev && row) for (const k of prev.fields || []) if (!(k in fields)) delete row[k];
    if (hr) { const old = intraday.get(store.DATA_DIR, d); hr.zones = old?.zones || null; intraday.save(store.DATA_DIR, { [d]: hr }); }
    else if (prev?.hr) { const old = intraday.get(store.DATA_DIR, d); if (old?.source === SOURCE) fs.rmSync(path.join(store.DATA_DIR, 'intraday', `${d}.json`), { force: true }); }
    if (Object.keys(fields).length && (row || SIGNAL.some((k) => fields[k] > 0))) parsed.days[d] = { date: d, ...fields }; // no calorie/weight-only days
    cache[d] = { fields: parsed.days[d] ? Object.keys(fields) : [], sessions, hr: !!hr };
    if (!parsed.days[d] && !sessions.length && !hr) delete cache[d];
    hcSessions.push(...sessions);
  }
  writeJson(DERIVED_FILE(), cache);
  // Sleep: drop this app's old sessions for these days and any other source's sessions they overlap.
  const set = new Set(dates);
  s.real.sleep = s.real.sleep.filter((x) => !(String(x.logId || '').startsWith('hc:') && set.has(x.date)) && !hcSessions.some((h) => !String(x.logId || '').startsWith('hc:') && overlaps(x, h)));
  parsed.sleep = hcSessions;
  realMerge.call(store, parsed, importInfo(s, cache));
}
function importInfo(s, cache) {
  // Keep one rolling "Health Connect" entry in the import list instead of one per hourly sync.
  s.real.imports = s.real.imports.filter((i) => i.source !== 'health-connect');
  const ds = Object.keys(cache).sort();
  return { source: 'health-connect', label: SOURCE, files: 0, days: ds.length, range: ds.length ? [ds[0], ds[ds.length - 1]] : null };
}
/** After a Takeout import: put HC fields / sessions back on top of the parsed export, and restore HC intraday days. */
function wrappedMerge(parsed, info) {
  if (info && info.source === 'health-connect') return realMerge.call(store, parsed, info);
  const cache = derivedCache();
  if (parsed && parsed.days) {
    for (const [d, c] of Object.entries(cache)) {
      if (!parsed.days[d]) continue;
      for (const k of c.fields || []) delete parsed.days[d][k]; // HC wins for these fields; the stored HC value stays
    }
    const hcSess = Object.values(cache).flatMap((c) => c.sessions || []);
    if (Array.isArray(parsed.sleep)) parsed.sleep = parsed.sleep.filter((x) => !hcSess.some((h) => overlaps(x, h)));
  }
  const out = realMerge.call(store, parsed, info);
  try { for (const [d, c] of Object.entries(cache)) if (c.hr) { const { hr } = derive(readDay(d)); if (hr) { const old = intraday.get(store.DATA_DIR, d); hr.zones = old?.zones || null; intraday.save(store.DATA_DIR, { [d]: hr }); } } } catch (e) { console.warn('hc: intraday restore failed:', e.message); }
  return out;
}
store.mergeReal = wrappedMerge;
/** "Delete uploaded data" also deletes the phone-synced copy (pairing is kept). */
store.clearReal = function clearAll(...a) { const r = realClear.apply(store, a); for (const f of [DAYS_DIR(), DERIVED_FILE()]) fs.rmSync(f, { recursive: true, force: true }); const st = readState(); writeJson(STATE_FILE(), { ...blankState(), resync: false, app: st.app }); return r; };

// ---------------------------------------------------------------- status
function summary() {
  const st = readState(); const dev = device(); const cache = derivedCache(); const ds = Object.keys(cache).sort();
  const origins = Object.entries(st.origins).map(([pkg, o]) => ({ pkg, label: originInfo(pkg).label, preferred: isFitbit(pkg), types: o.types, devices: o.devices, first: o.first, last: o.last }))
    .sort((a, b) => originInfo(b.pkg).rank - originInfo(a.pkg).rank);
  let apk = null; try { const s = fs.statSync(APK()); apk = { size: s.size, builtAt: s.mtime.toISOString(), url: '/download/AirHealthSync.apk' }; } catch {}
  return { paired: !!dev, device: dev ? { name: dev.deviceName, pairedAt: dev.pairedAt, lastSeenAt: dev.lastSeenAt } : null, lastIngestAt: st.lastIngestAt, ingests: st.ingests,
    records: st.records, days: ds.length, range: ds.length ? [ds[0], ds[ds.length - 1]] : null, origins, lastBatch: st.lastBatch, app: st.app || null, resync: !!st.resync, apk,
    pairingActive: !!(pairing && pairing.expires > Date.now()) };
}
function coachLine() {
  const s = summary(); if (!s.lastIngestAt) return null;
  const when = new Date(s.lastIngestAt).toLocaleString('en-IN', { timeZone: USER_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  return `PHONE SYNC: ${s.days} days (${s.range ? s.range.join(' to ') : '-'}) come from Health Connect on his Android phone (Google Health app / Fitbit Air), last synced ${when} IST; for those days Health Connect values replace the export. Origins: ${s.origins.map((o) => o.label).join(', ') || '-'}.`;
}

// ---------------------------------------------------------------- HTTP
const claimTries = new Map();
function publicRouter() {
  const r = express.Router();
  r.post('/api/hc/claim', express.json({ limit: '16kb' }), (req, res) => {
    const ip = req.socket.remoteAddress || 'x'; const a = claimTries.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now(); }
    if (a.n >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    try { const token = claim(req.body?.code, req.body?.device); claimTries.delete(ip); res.set('Cache-Control', 'no-store'); res.json({ ok: true, token }); }
    catch (e) { a.n++; claimTries.set(ip, a); res.status(e.status || 500).json({ error: e.message }); }
  });
  const auth = (req, res, next) => { const d = checkBearer(req); if (!d) return res.status(401).json({ error: 'not paired' }); req.hcDevice = d; next(); };
  r.get('/api/hc/status', auth, (req, res) => { const s = summary(); if (s.resync && req.query.ack === 'resync') { /* only the sync engine acknowledges, not the app's status view */ const st = readState(); st.resync = false; writeJson(STATE_FILE(), st); } res.json({ ok: true, paired: true, device: s.device, lastIngestAt: s.lastIngestAt, days: s.days, range: s.range, records: s.records, origins: s.origins.map((o) => o.pkg), resync: s.resync }); });
  r.post('/api/hc/ingest', auth, express.raw({ type: ['application/gzip', 'application/octet-stream', 'application/x-gzip'], limit: '25mb', inflate: false }), (req, res) => {
    let payload = req.body;
    try {
      if (Buffer.isBuffer(payload)) {
        const buf = payload[0] === 0x1f && payload[1] === 0x8b ? zlib.gunzipSync(payload, { maxOutputLength: 256 * 1024 * 1024 }) : payload;
        payload = JSON.parse(buf.toString('utf8'));
      }
    } catch (e) { return res.status(400).json({ error: 'Could not read the batch (expected gzip JSON).' }); }
    try {
      const out = ingest(payload, { deferApply: true });
      const { _changed, ...publicOut } = out;
      res.json({ ok: true, ...publicOut, resync: readState().resync });
      // Derive after the ACK so the phone is not blocked on store merge / intraday rewrite.
      if (_changed && publicOut.days.length) setImmediate(() => { enqueueApply(publicOut.days); });
    } catch (e) { console.warn('hc ingest failed:', e.message); res.status(e.status || 500).json({ error: e.status ? e.message : 'could not save the batch' }); }
  });
  return r;
}
function privateRouter() {
  const r = express.Router();
  r.get('/api/hc/info', (req, res) => res.json(summary()));
  r.post('/api/hc/pair', async (req, res) => {
    const { code, expiresAt } = newPairingCode();
    const fallback = process.env.PUBLIC_SYNC_URL || process.env.TAILSCALE_URL || `http://${req.headers.host || '127.0.0.1:4870'}`;
    const host = req.headers.host && /^[\w.:\-[\]]+$/.test(req.headers.host) ? req.headers.host : null;
    const server = host && !/^(localhost|127\.)/.test(host) ? `http://${host}` : fallback.replace(/\/$/, '');
    const link = `airhealth://pair?server=${encodeURIComponent(server)}&code=${code}`;
    let qr = null; try { qr = await require('qrcode').toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch {}
    res.set('Cache-Control', 'no-store'); res.json({ code, expiresAt, server, link, qr });
  });
  r.post('/api/hc/unpair', (req, res) => { unpair(); res.json(summary()); });
  r.post('/api/hc/resync', (req, res) => { const st = readState(); st.resync = true; writeJson(STATE_FILE(), st); res.json(summary()); });
  r.get('/download/AirHealthSync.apk', (req, res) => {
    if (!fs.existsSync(APK())) return res.status(404).type('text/plain').send('The app has not been built yet.');
    res.set('Content-Type', 'application/vnd.android.package-archive'); res.set('Cache-Control', 'no-store');
    res.download(APK(), 'AirHealthSync.apk');
  });
  return r;
}

module.exports = {
  id: 'health-connect', label: 'Phone sync (Health Connect)', kind: 'live',
  status: () => { const s = summary(); return { available: true, configured: s.paired, note: s.paired ? `Android app${s.lastIngestAt ? `, last sync ${new Date(s.lastIngestAt).toLocaleString('en-IN', { timeZone: USER_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} IST` : ', waiting for the first sync'}` : 'Android app that reads Health Connect and syncs about every 15 minutes over Tailscale. Pair it below.' }; },
  publicRouter, privateRouter, ingest, derive, applyDays, summary, coachLine, claim, newPairingCode, unpair, checkBearer, originInfo, placements, local,
};
