'use strict';
/**
 * Google Health Takeout ("Takeout/Google Health/…", 2026 layout) — the *_GoogleData CSV families.
 * Layout verified against a real Fitbit Air / Google Health export (6 Oct 2026) (see docs/takeout-format.md):
 *
 *  Physical Activity_GoogleData/<Family>/<family>_YYYY-MM-DD.csv   columns: timestamp, <value cols…>, data source
 *    - timestamps are UTC with a trailing Z (sometimes with fractional seconds)
 *    - one row per sample (≈ per minute); several "data source" values can cover the SAME minutes:
 *        "MobileTrack" / "Google Health App" (phone, Fitbit app), "Fit Health Connect" (mirror via Android
 *        Health Connect — duplicates the phone data, and is the only source before the Fitbit account existed),
 *        "Google Fitbit Air" (the band).  => never sum across sources.
 *    - daily families (Daily Resting Heart Rate, Daily Heart Rate Zones) use T00:00:00Z to mean the LOCAL date.
 *  Health Fitness Data_GoogleData/UserSleeps_*.csv + UserSleepStages_*.csv   (joined on sleep_id,
 *    sleep_start / sleep_end in UTC + start_utc_offset / end_utc_offset)
 *
 * Values are accumulated per local day *per source* and resolved in resolve(): band first for heart data,
 * and for counts the single best source per day (max), never a sum of sources.
 */
const { parseCSV } = require('./csv');
const { parseStamp, num, round, USER_TZ, tzOffsetMinutes } = require('./util');

const BAND = /fitbit air|google fitbit|pixel watch|fitbit (charge|inspire|sense|versa|luxe|ace)|tracker/i;
const isBand = (s) => BAND.test(s || '');
const MIRROR = /health connect/i;

// Families we read; everything else under *_GoogleData is skipped without parsing (some are 17 MB+).
const FAMILIES = {
  'steps': { kind: 'count', field: 'steps', col: 'steps' },
  'distance': { kind: 'count', field: 'distance_m', col: 'distance' },
  'calories': { kind: 'count', field: 'calories', col: 'calories' },
  'active minutes': { kind: 'activemin' },
  'active zone minutes': { kind: 'count', field: 'azm', col: 'total minutes' },
  'heart rate': { kind: 'hr' },
  'daily resting heart rate': { kind: 'dailyLocal', field: 'resting_hr', col: 'beats per minute', dec: 1 },
  'body temperature': { kind: 'mean', field: 'skin_temp_c', col: 'temperature celsius' },
  'weight': { kind: 'last', field: 'weight_kg', col: 'weight grams', scale: 1 / 1000 },
  'daily heart rate zones': { kind: 'zones' },
};
const HFD = { usersleeps: 'sleeps', usersleepstages: 'stages', userexercises: 'exercises' };

// Present in the real export but not used (duplicates, derived, personal, or huge with no daily value).
const PA_SKIP = new Set(['active energy burned', 'activity level', 'calories in heart rate zone', 'time in heart rate zone',
  'cardio load', 'cardio load observed interval', 'coarse physical location', 'weather forecast',
  'live pace', 'micro motion', 'micro stillness', 'nutrition log', 'sedentary period', 'swim lengths data', 'height']);
const HFD_SKIP = /^(AppContentHistory|CalibrationStatus|Coach|GoalSettings|UserActivityProbabilities|UserActivityRecognition|UserAppSetting|UserConversations|UserDemographic|UserDeviceLanguage|UserFood|UserLegacySetting|UserLocation|UserMBD|UserPremium|UserProfile|UserSensorCompression|WeeklyFitnessPlans|WorkoutSummaries)/i;
const DIR_SKIP = /(?:^|\/)(Account Changes|User Security Data|Biometrics|Menstrual Health|Social|Social_GoogleData|User Profile_GoogleData|Commerce_GoogleData|Email Notifications Settings_GoogleData|InAppNotifications_GoogleData|Fitbit Premium|Discover|Guided Programs|Your Profile|Stress Journal|Snore and Noise Detect|Atrial Fibrillation PPG)\//i;

/**
 * Classify a path. Returns { family, spec } | { hfd } | { devices } | { skip: true } | null.
 * null = not a known Google-data family: the caller falls back to the legacy Fitbit CSV/JSON handlers, so
 * families that are absent from today's export (HRV, SpO2, readiness, …) are still picked up when they appear.
 */
function classify(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (DIR_SKIP.test(p)) return { skip: true };
  let m = p.match(/(?:^|\/)Physical Activity_GoogleData\/([^/]+)\/[^/]+$/i);
  if (m) { const fam = m[1].toLowerCase(); if (FAMILIES[fam]) return { family: fam, spec: FAMILIES[fam] }; return PA_SKIP.has(fam) ? { skip: true } : null; }
  m = p.match(/(?:^|\/)Health Fitness Data_GoogleData\/([A-Za-z]+)[^/]*$/i);
  if (m) { const k = HFD[m[1].toLowerCase()]; if (k) return { hfd: k }; return HFD_SKIP.test(m[1]) ? { skip: true } : null; }
  if (/(?:^|\/)Paired Devices\/Trackers\.csv$/i.test(p)) return { devices: true };
  if (/(?:^|\/)Paired Devices\//i.test(p)) return { skip: true };
  if (/(?:^|\/)Active Zone Minutes \(AZM\)\//i.test(p)) return { skip: true }; // legacy copy of the Google-data AZM family
  if (/(?:^|\/)Global Export Data\/(badge|height|weight|swim_lengths_data|exercise)-/i.test(p)) return { skip: true }; // weight comes from the grams CSV
  return null;
}

function offsetMin(s) { const m = String(s || '').match(/([+-])(\d{2}):?(\d{2})/); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null; }
/** UTC stamp string -> { date, minutes } on the local wall clock (explicit offset if given, else user's zone). */
function local(raw, tz, offStr) {
  const st = parseStamp(raw); if (!st) return null;
  const ms = Date.parse(`${st.date}T00:00:00Z`) + (st.minutes || 0) * 60000;
  const off = offStr != null && offsetMin(offStr) != null ? offsetMin(offStr) : st.utc ? tzOffsetMinutes(tz, new Date(ms)) : 0;
  const d = new Date(ms + off * 60000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), ms };
}
const hhmm = (l) => `${String(Math.floor(l.minutes / 60)).padStart(2, '0')}:${String(l.minutes % 60).padStart(2, '0')}`;

class GoogleData {
  constructor(tz = USER_TZ) { this.tz = tz; this.b = {}; this.sleeps = new Map(); this.stages = []; this.exercises = 0; this.devices = []; this.sources = {}; this.minuteHR = new Map(); this.zones = {}; }
  bucket(field, date, src) { const f = (this.b[field] ||= {}); const d = (f[date] ||= {}); return (d[src] ||= { s: 0, n: 0, mn: Infinity, mx: -Infinity, last: null, lastMs: -1 }); }
  seen(field, src) { const f = (this.sources[field] ||= {}); f[src] = (f[src] || 0) + 1; }

  handle(cls, text) {
    const rows = parseCSV(text).filter((r) => r.some((c) => String(c).trim() !== ''));
    if (rows.length < 2) return 'empty';
    const H = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name) => H.indexOf(name);
    const body = rows.slice(1);
    if (cls.devices) { const t = col('device_type'), a = col('date_added'), s = col('last_sync_date_time'); for (const r of body) this.devices.push({ device: r[t], added: r[a], lastSync: r[s] }); return 'devices_csv'; }
    if (cls.hfd === 'sleeps') {
      const g = (r, k) => r[col(k)];
      for (const r of body) {
        const s = local(g(r, 'sleep_start'), this.tz, g(r, 'start_utc_offset')), e = local(g(r, 'sleep_end'), this.tz, g(r, 'end_utc_offset'));
        if (!s || !e) continue;
        this.sleeps.set(g(r, 'sleep_id'), { s, e, type: g(r, 'sleep_type'), asleep: num(g(r, 'minutes_asleep')), awake: num(g(r, 'minutes_awake')), period: num(g(r, 'minutes_in_sleep_period')), source: g(r, 'data_source') });
      }
      return 'sleeps_csv';
    }
    if (cls.hfd === 'stages') {
      const g = (r, k) => r[col(k)];
      for (const r of body) {
        const s = local(g(r, 'sleep_stage_start'), this.tz, g(r, 'start_utc_offset')), e = local(g(r, 'sleep_stage_end'), this.tz, g(r, 'end_utc_offset'));
        if (s && e) this.stages.push({ id: g(r, 'sleep_id'), type: String(g(r, 'sleep_stage_type') || '').toUpperCase(), min: (e.ms - s.ms) / 60000, startMs: s.ms, endMs: e.ms });
      }
      return 'sleep_stages_csv';
    }
    if (cls.hfd === 'exercises') { this.exercises += body.length; return 'exercises_csv'; }

    const spec = cls.spec; const tI = col('timestamp'), sI = col('data source');
    if (tI < 0) return 'unknown';
    const srcOf = (r) => (sI >= 0 && r[sI] ? r[sI] : 'unknown');
    if (spec.kind === 'activemin') {
      const li = col('light'), mi = col('moderate'), vi = col('very');
      for (const r of body) { const l = local(r[tI], this.tz); if (!l) continue; const src = srcOf(r);
        for (const [f, i] of [['light_minutes', li], ['fairly_active_minutes', mi], ['very_active_minutes', vi]]) { const v = num(r[i]); if (v) { this.bucket(f, l.date, src).s += v; } }
        this.seen('active_minutes', src); }
      return 'active_minutes_csv';
    }
    if (spec.kind === 'zones') { // thresholds per local date: "{""heart_rate_zone_type"": LIGHT, ""min_heart_rate_bpm"": 30, ""max_heart_rate_bpm"": 129},{…}"
      const zI = col('heart_rate_zone');
      for (const r of body) {
        const date = (parseStamp(r[tI]) || {}).date; if (!date || zI < 0) continue;
        const z = [...String(r[zI]).matchAll(/heart_rate_zone_type"*\s*:\s*"*([A-Z_]+)"*\s*,\s*"*min_heart_rate_bpm"*\s*:\s*(\d+)\s*,\s*"*max_heart_rate_bpm"*\s*:\s*(\d+)/g)].map((m) => ({ type: m[1], min: +m[2], max: +m[3] }));
        if (z.length) this.zones[date] = z;
      }
      return 'heart_rate_zones_csv';
    }
    if (spec.kind === 'hr') {
      const vI = col('beats per minute');
      for (const r of body) { const l = local(r[tI], this.tz); const v = num(r[vI]); if (!l || !v) continue; const src = srcOf(r); const b = this.bucket('hr', l.date, src); b.s += v; b.n++; if (v < b.mn) b.mn = v; if (v > b.mx) b.mx = v; this.seen('hr', src);
        const key = l.date + '|' + src; let m = this.minuteHR.get(key);
        if (!m) { m = { s: new Float64Array(1440), n: new Uint16Array(1440), mn: new Float32Array(1440).fill(Infinity), mx: new Float32Array(1440).fill(-Infinity) }; this.minuteHR.set(key, m); }
        const i = l.minutes; m.s[i] += v; m.n[i]++; if (v < m.mn[i]) m.mn[i] = v; if (v > m.mx[i]) m.mx[i] = v; }
      return 'heart_rate_csv';
    }
    const vI = col(spec.col); if (vI < 0) return 'unknown';
    for (const r of body) {
      const v = num(r[vI]); if (v == null) continue;
      const src = srcOf(r);
      let date;
      if (spec.kind === 'dailyLocal') date = (parseStamp(r[tI]) || {}).date; // T00:00:00Z == local calendar date
      else { const l = local(r[tI], this.tz); date = l && l.date; }
      if (!date) continue;
      const b = this.bucket(spec.field, date, src);
      if (spec.kind === 'last') { const ms = Date.parse(String(r[tI]).replace(/(\.\d{3})\d+/, '$1')); if (ms >= b.lastMs) { b.last = v * (spec.scale || 1); b.lastMs = ms; } }
      else if (spec.kind === 'dailyLocal') b.last = v;
      else { b.s += v; b.n++; }
      this.seen(spec.field, src);
    }
    return cls.family.replace(/ /g, '_') + '_csv';
  }

  /** Write resolved per-day values into the parser's Accumulator. */
  resolve(acc) {
    const pick = (bySrc, how) => {
      let e = Object.entries(bySrc); if (!e.length) return null;
      // Health Connect rows mirror what the Fitbit app already wrote; use them only for days with nothing else.
      const native = e.filter(([s]) => !MIRROR.test(s)); if (native.length) e = native;
      const band = e.filter(([s]) => isBand(s));
      if (how === 'band') return (band.length ? band : e).sort((a, b) => b[1].n - a[1].n)[0];
      return e.sort((a, b) => b[1].s - a[1].s)[0]; // count metrics: the most complete single native source (phone vs band), never a sum
    };
    const F = this.b;
    for (const [date, by] of Object.entries(F.steps || {})) { const p = pick(by); if (p && p[1].s > 0) acc.set(date, 'steps', Math.round(p[1].s), 1.8); }
    for (const [date, by] of Object.entries(F.distance_m || {})) { const p = pick(by); if (p && p[1].s > 0) acc.set(date, 'distance_km', round(p[1].s / 1000, 2), 1.8); }
    for (const [date, by] of Object.entries(F.calories || {})) { const p = pick(by); if (p && p[1].s > 0) acc.set(date, 'calories', Math.round(p[1].s), 1); }
    for (const f of ['light_minutes', 'fairly_active_minutes', 'very_active_minutes']) for (const [date, by] of Object.entries(F[f] || {})) { const p = pick(by); if (p) acc.set(date, f, Math.round(p[1].s), 1); }
    for (const [date, by] of Object.entries(F.azm || {})) { const p = pick(by, 'band'); if (p) acc.set(date, 'azm', Math.round(p[1].s), 2.5); }
    for (const [date, by] of Object.entries(F.hr || {})) { const p = pick(by, 'band'); if (p && p[1].n) { acc.set(date, 'hr_avg', round(p[1].s / p[1].n, 1), 2.5); acc.set(date, 'hr_min', p[1].mn, 2.5); acc.set(date, 'hr_max', p[1].mx, 2.5); acc.set(date, 'hr_samples', p[1].n, 2.5); } }
    for (const [date, by] of Object.entries(F.resting_hr || {})) { const p = pick(by, 'band'); if (p && p[1].last) acc.set(date, 'resting_hr', round(p[1].last, 1), 2.5); }
    for (const [date, by] of Object.entries(F.skin_temp_c || {})) { const p = pick(by, 'band'); if (p && p[1].n) acc.set(date, 'skin_temp_c', round(p[1].s / p[1].n, 1), 2); }
    for (const [date, by] of Object.entries(F.weight_kg || {})) { const p = Object.values(by).sort((a, b) => b.lastMs - a.lastMs)[0]; if (p && p.last) acc.set(date, 'weight_kg', round(p.last, 1), 2); }
    // Sleep: sessions from UserSleeps, stage minutes + epoch series from UserSleepStages.
    const tone = (t) => ({ DEEP: 'deep', LIGHT: 'light', REM: 'rem', AWAKE: 'wake', ASLEEP: 'light' }[t] || null);
    const st = {}; const byId = {};
    for (const g of this.stages) {
      const x = (st[g.id] ||= { DEEP: 0, LIGHT: 0, REM: 0, AWAKE: 0, ASLEEP: 0 }); if (x[g.type] != null) x[g.type] += g.min;
      (byId[g.id] ||= []).push(g);
    }
    for (const [id, s] of this.sleeps) {
      const g = st[id] || {}; const staged = g.DEEP + g.LIGHT + g.REM > 0;
      let stages;
      if (byId[id] && byId[id].length) {
        const segs = [];
        for (const g0 of byId[id].slice().sort((a, b) => a.startMs - b.startMs)) {
          const k = tone(g0.type); if (!k || !(g0.min > 0)) continue;
          const off = Math.max(0, Math.round((g0.startMs - s.s.ms) / 60000));
          const d = Math.max(1, Math.round(g0.min));
          const last = segs[segs.length - 1];
          if (last && last.t === k && last.s + last.d === off) last.d += d;
          else segs.push({ t: k, s: off, d });
        }
        if (segs.length) stages = segs;
      }
      acc.addSession({ logId: String(id), date: s.e.date, start: `${s.s.date}T${hhmm(s.s)}`, end: `${s.e.date}T${hhmm(s.e)}`,
        minutes_asleep: s.asleep, minutes_awake: s.awake, time_in_bed: s.period ?? Math.round((s.e.ms - s.s.ms) / 60000),
        efficiency: s.asleep && s.period ? Math.round(s.asleep / s.period * 100) : null,
        deep: staged ? Math.round(g.DEEP) : null, light: staged ? Math.round(g.LIGHT) : null, rem: staged ? Math.round(g.REM) : null, wake: staged ? Math.round(g.AWAKE) : s.awake,
        main: (s.asleep || 0) >= 180, type: String(s.type || '').toLowerCase() || null, source: s.source || null, score: null,
        stages });
    }
    // Intraday HR: one source per day (band first), 1-minute mean/min/max; null where not worn (no interpolation).
    const perDay = {};
    for (const [key, m] of this.minuteHR) { const [date, src] = key.split('|'); (perDay[date] ||= {})[src] = { s: 0, n: [...m.n].reduce((a, b) => a + b, 0), m }; }
    acc.intradayHR = {};
    for (const [date, by] of Object.entries(perDay)) {
      const p = pick(by, 'band'); if (!p) continue; const { m } = p[1];
      const avg = new Array(1440).fill(null), mn = new Array(1440).fill(null), mx = new Array(1440).fill(null);
      for (let i = 0; i < 1440; i++) if (m.n[i]) { avg[i] = round(m.s[i] / m.n[i], 1); mn[i] = Math.round(m.mn[i]); mx[i] = Math.round(m.mx[i]); }
      acc.intradayHR[date] = { date, tz: this.tz, source: p[0], step: 60, samples: p[1].n, avg, min: mn, max: mx, zones: this.zones[date] || null };
    }
    acc.report.dataSources = this.sources;
    acc.report.devices = this.devices;
    acc.report.exercises = this.exercises;
  }
}
module.exports = { GoogleData, classify, isBand };
