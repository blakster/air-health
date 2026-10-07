'use strict';
/**
 * Google Health / Fitbit export parser.
 *
 * Handles (tolerantly, by folder name, file name AND content shape):
 *  A. Google Takeout "Fitbit" / "Google Health" archive (JSON + CSV), e.g.
 *     Takeout/Fitbit/Global Export Data/steps-2026-08-01.json      [{dateTime:"08/01/26 00:01:00", value:"12"}]
 *       calories-*, distance-*, heart_rate-* ({value:{bpm,confidence}}), resting_heart_rate-*
 *       ({value:{date,value,error}}), sedentary_minutes-*, lightly/moderately/very_active_minutes-*,
 *       sleep-*.json (sleep logs with levels.summary deep/light/rem/wake)
 *     Takeout/Fitbit/Sleep/sleep_score.csv                           sleep_log_entry_id,timestamp,overall_score,...
 *     Takeout/Fitbit/Heart Rate Variability/Daily Heart Rate Variability Summary - *.csv  timestamp,rmssd,nremhr,entropy
 *     Takeout/Fitbit/Heart Rate Variability/Heart Rate Variability Details - *.csv        timestamp,rmssd,coverage,...
 *     Takeout/Fitbit/Daily Readiness/Daily Readiness Score - *.csv   date,readiness_score_value,readiness_state,...
 *     Takeout/Fitbit/Oxygen Saturation (SpO2)/Daily SpO2 - *.csv     timestamp,average_value,lower_bound,upper_bound
 *     Takeout/Fitbit/Oxygen Saturation (SpO2)/Minute SpO2 - *.csv    timestamp,value
 *     .../Daily Respiratory Rate Summary - *.csv, Stress/Stress Score.csv
 *     Per-day activity summary JSON ({summary:{steps, caloriesOut, ...}})
 *  B. Legacy fitbit.com "Export a selection of your data" CSV (sections: Activities / Sleep).
 *  C. Fitbit Web API style JSON ({"activities-steps":[...]}, {"hrv":[...]}, {"sleep":[...]}, spo2, br).
 *  D. Generic CSV/JSON tables with a date/timestamp column and recognisable metric columns
 *     (steps, resting heart rate, rmssd/hrv, spo2, sleep score, readiness, bpm...).
 *
 * Output is the normalised dataset { days: {date: {...}}, sleep: [sessions] }.
 */
const path = require('path');
const { parseCSV } = require('./csv');
const { GoogleData, classify } = require('./googleHealth');
const { parseStamp, toLocal, shiftStamp, num, round, USER_TZ, todayLocal } = require('./util');

const SKIP_DIRS = /(^|\/)(social|personal & account|food|foods|nutrition|menstrual|body|biometrics|journal|application|programs|google data\/.*location|__macosx)(\/|$)/i;

class Accumulator {
  constructor(opts = {}) {
    // Fitbit Takeout intraday timestamps (steps/heart_rate/calories per minute) are UTC.
    this.intradayUtc = opts.intradayUtc !== false;
    this.tz = opts.tz || USER_TZ;
    this.fields = {}; // date -> field -> {v, p}
    this.intra = {};  // date -> {steps, calories, distance, hrSum, hrN, hrMin, hrMax, hrvSum, hrvN, spo2Sum, spo2N}
    this.sessions = new Map(); // logId -> session
    this.pendingScores = []; // sleep_score rows {logId, date, score}
    this.report = { filesSeen: 0, filesParsed: 0, byType: {}, skipped: [], warnings: [] };
    this.gd = new GoogleData(this.tz);
  }
  set(date, field, value, priority = 1) {
    if (!date) return;
    if (value == null || !Number.isFinite(value) && typeof value !== 'string') return;
    const d = (this.fields[date] ||= {});
    if (!d[field] || d[field].p <= priority) d[field] = { v: value, p: priority };
  }
  intraday(date) { return (this.intra[date] ||= { steps: 0, stepsN: 0, calories: 0, calN: 0, distance: 0, distN: 0, hrSum: 0, hrN: 0, hrMin: Infinity, hrMax: -Infinity, hrvSum: 0, hrvN: 0, spo2Sum: 0, spo2N: 0 }); }
  mark(type) { this.report.byType[type] = (this.report.byType[type] || 0) + 1; this.report.filesParsed++; }
  localStamp(st, intraday) { return intraday && this.intradayUtc ? toLocal({ ...st, utc: true }, this.tz) : toLocal(st, this.tz); }

  addSession(s) {
    const key = s.logId || `${s.start}`;
    this.sessions.set(String(key), s);
  }

  finish() {
    this.gd.resolve(this); // Google Health *_GoogleData families (source-aware, see lib/googleHealth.js)
    // Intraday aggregates -> daily fields (low priority: daily summaries win).
    for (const [date, a] of Object.entries(this.intra)) {
      if (a.stepsN) this.set(date, 'steps', Math.round(a.steps), 2);
      if (a.calN) this.set(date, 'calories', Math.round(a.calories), 2);
      if (a.distN) this.set(date, 'distance_km', round(a.distance > 1000 ? a.distance / 100000 : a.distance, 2), 2);
      if (a.hrN) { this.set(date, 'hr_avg', round(a.hrSum / a.hrN, 1), 0); this.set(date, 'hr_min', a.hrMin, 0); this.set(date, 'hr_max', a.hrMax, 0); }
      if (a.hrvN) this.set(date, 'hrv', round(a.hrvSum / a.hrvN, 1), 0);
      if (a.spo2N) this.set(date, 'spo2_avg', round(a.spo2Sum / a.spo2N, 1), 0);
    }
    // Sleep scores -> sessions / days
    for (const sc of this.pendingScores) {
      const sess = sc.logId && this.sessions.get(String(sc.logId));
      if (sess) sess.score = sc.score;
      this.set(sess ? sess.date : sc.date, 'sleep_score', sc.score, 2);
    }
    // Sleep sessions -> daily sleep fields
    const byDate = {};
    for (const s of this.sessions.values()) (byDate[s.date] ||= []).push(s);
    for (const [date, list] of Object.entries(byDate)) {
      const main = list.find((s) => s.main) || list.slice().sort((a, b) => (b.minutes_asleep || 0) - (a.minutes_asleep || 0))[0];
      const sum = (k) => list.reduce((t, s) => t + (s[k] || 0), 0);
      this.set(date, 'sleep_minutes', sum('minutes_asleep'), 1);
      this.set(date, 'time_in_bed', sum('time_in_bed'), 1);
      for (const k of ['deep', 'light', 'rem', 'wake']) if (list.some((s) => s[k] != null)) this.set(date, `sleep_${k}`, sum(k), 1);
      if (main.efficiency != null) this.set(date, 'sleep_efficiency', main.efficiency, 1);
      if (main.start) this.set(date, 'bedtime', main.start, 1);
      if (main.end) this.set(date, 'waketime', main.end, 1);
      if (main.score != null) this.set(date, 'sleep_score', main.score, 3);
      if (main.stages && main.stages.length) {
        const d = (this.fields[date] ||= {});
        if (!d.sleep_stages || d.sleep_stages.p <= 1) d.sleep_stages = { v: main.stages, p: 1 };
      }
    }
    const days = {};
    const today = this.today || todayLocal(this.tz);
    const dropped = { future: 0, empty: 0 };
    for (const [date, f] of Object.entries(this.fields)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (date > today) { dropped.future++; continue; }
      if (!hasRealData(f)) { dropped.empty++; continue; }
      const row = { date };
      for (const [k, { v }] of Object.entries(f)) row[k] = v;
      // active minutes = fairly + very when available
      if (row.active_minutes == null && (row.fairly_active_minutes != null || row.very_active_minutes != null)) row.active_minutes = (row.fairly_active_minutes || 0) + (row.very_active_minutes || 0);
      days[date] = row;
    }
    const sleep = [...this.sessions.values()].filter((x) => x.date <= today && (x.minutes_asleep || x.time_in_bed || x.deep || x.light || x.rem)).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    this.report.droppedDays = dropped;
    const dates = Object.keys(days).sort();
    this.report.dateRange = dates.length ? [dates[0], dates[dates.length - 1]] : null;
    this.report.daysWithData = dates.length;
    this.report.sleepSessions = sleep.length;
    const intraday = {}; for (const [d, v] of Object.entries(this.intradayHR || {})) if (d <= today) intraday[d] = v;
    this.report.intradayDays = Object.keys(intraday).length;
    return { days, sleep, report: this.report, intraday };
  }
}

// ---------- helpers ----------
// A day counts only if the band (or phone) actually recorded something. Fitbit/Google exports pad
// daily series to whole months with placeholders: sedentary 1440, zero active minutes, BMR-only calories.
const SIGNAL = ['steps', 'distance_km', 'light_minutes', 'fairly_active_minutes', 'very_active_minutes', 'active_minutes', 'azm',
  'resting_hr', 'hr_avg', 'hrv', 'spo2_avg', 'breathing_rate', 'sleep_minutes', 'time_in_bed', 'sleep_score', 'readiness', 'stress_score'];
function hasRealData(f) {
  for (const k of SIGNAL) { const v = f[k] && f[k].v; if (typeof v === 'number' && v > 0) return true; }
  const sed = f.sedentary_minutes && f.sedentary_minutes.v;
  if (typeof sed === 'number' && sed > 0 && sed < 1440) return true; // a partial day of wear
  return false;
}
// Find a header by regex on the normalised (lowercase, alnum only) name.
const findH = (H, re) => H.findIndex((h) => re.test(h));
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function stageMinutes(levels) {
  const s = levels && levels.summary; if (!s) return {};
  const g = (k) => (s[k] && s[k].minutes != null ? num(s[k].minutes) : null);
  if (s.deep || s.rem || s.light) return { deep: g('deep'), light: g('light'), rem: g('rem'), wake: g('wake') };
  // classic sleep: asleep / restless / awake
  return { wake: (g('awake') || 0) + (g('restless') || 0) || null };
}
function hhmm(st) { if (!st || st.minutes == null) return null; const m = Math.round(st.minutes) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
// For overnight measurements (HRV details, minute SpO2): readings after 18:00 belong to the next morning's date.
function nightDate(st) { if (st.minutes != null && st.minutes >= 18 * 60) return shiftStamp({ date: st.date, minutes: 0 }, 1440).date; return st.date; }

// ---------- sleep log (Takeout JSON + Web API JSON) ----------
function addSleepLog(acc, s) {
  const startSt = parseStamp(s.startTime || s.start_time || s.StartDate);
  const endSt = parseStamp(s.endTime || s.end_time || s.EndDate);
  const date = (s.dateOfSleep && parseStamp(s.dateOfSleep)?.date) || endSt?.date || startSt?.date;
  if (!date) return;
  const st = stageMinutes(s.levels);
  const stages = stagesFromLevelsData(s.levels, startSt);
  acc.addSession({
    logId: s.logId != null ? String(s.logId) : null,
    date,
    start: startSt ? `${startSt.date}T${hhmm(startSt)}` : null,
    end: endSt ? `${endSt.date}T${hhmm(endSt)}` : null,
    minutes_asleep: num(s.minutesAsleep ?? s.MinutesAsleep),
    minutes_awake: num(s.minutesAwake ?? s.MinutesAwake),
    time_in_bed: num(s.timeInBed ?? s.TimeInBed),
    efficiency: num(s.efficiency ?? s.Efficiency),
    deep: st.deep ?? num(s.SleepLevelDeep), light: st.light ?? num(s.SleepLevelLight), rem: st.rem ?? num(s.SleepLevelRem), wake: st.wake ?? num(s.SleepLevelWake),
    main: s.mainSleep === true || s.mainSleep === 'true' || s.IsMainSleep === 'True' || s.isMainSleep === true,
    type: s.type || s.Type || null,
    score: null,
    stages,
  });
}

// Google Health style sleep records (Takeout "Google Data" / Google Health API shapes):
//   { sleep: { interval: {startTime,endTime}, stages: [{type:'DEEP', startTime, endTime}], summary: {...} } }
//   { startTime, endTime, stages: [{ stage|type|level, startTime|start, endTime|end }] }
//   { start_time, end_time, stages: { awake: <seconds>, light, deep, rem } }   (seconds per stage)
const STAGE = (t) => { const x = String(t || '').toLowerCase(); if (/deep/.test(x)) return 'deep'; if (/rem/.test(x)) return 'rem'; if (/light|asleep|sleeping|^sleep$/.test(x)) return 'light'; if (/wake|awake|out_of_bed|restless/.test(x)) return 'wake'; return null; };
function packEpochs(segs) {
  if (!segs || !segs.length) return undefined;
  const out = [];
  for (const g of segs) {
    if (!g || !g.t || !(g.d > 0)) continue;
    const s = Math.max(0, Math.round(g.s));
    const d = Math.max(1, Math.round(g.d));
    const last = out[out.length - 1];
    if (last && last.t === g.t && last.s + last.d === s) last.d += d;
    else out.push({ t: g.t, s, d });
  }
  return out.length ? out : undefined;
}
/** Fitbit levels.data → [{t,s,d}] minutes from session start. */
function stagesFromLevelsData(levels, startSt) {
  const data = levels && levels.data;
  if (!Array.isArray(data) || !data.length || !startSt) return undefined;
  const t0 = Date.parse(`${startSt.date}T00:00:00Z`) + (startSt.minutes || 0) * 60000;
  const segs = [];
  for (const g of data) {
    const k = STAGE(g.level || g.stage || g.value); if (!k) continue;
    const st = parseStamp(g.dateTime || g.datetime || g.date_time);
    const sec = num(g.seconds ?? g.durationSeconds ?? g.duration);
    if (!st || !(sec > 0)) continue;
    const t = Date.parse(`${st.date}T00:00:00Z`) + (st.minutes || 0) * 60000;
    segs.push({ t: k, s: Math.max(0, (t - t0) / 60000), d: sec / 60 });
  }
  return packEpochs(segs);
}
function isGHSleep(o) {
  if (!o || typeof o !== 'object') return false;
  const x = o.sleep && typeof o.sleep === 'object' && !Array.isArray(o.sleep) ? o.sleep : o;
  const hasTimes = (x.interval && x.interval.startTime) || x.startTime || x.start_time || x.sleepStart || x.start;
  const hasStages = Array.isArray(x.stages) || (x.stages && typeof x.stages === 'object') || Array.isArray(x.segments) || (x.summary && (x.summary.minutesAsleep != null || Array.isArray(x.summary.stagesSummary)));
  return !!(hasTimes && hasStages);
}
function addGHSleep(acc, o) {
  const x = o.sleep && typeof o.sleep === 'object' && !Array.isArray(o.sleep) ? o.sleep : o;
  const startRaw = x.interval?.startTime || x.startTime || x.start_time || x.sleepStart || x.start;
  const endRaw = x.interval?.endTime || x.endTime || x.end_time || x.sleepEnd || x.end;
  const s0 = parseStamp(startRaw), e0 = parseStamp(endRaw);
  if (!s0 || !e0) return;
  const s1 = toLocal(s0, acc.tz), e1 = toLocal(e0, acc.tz);
  const mins = { deep: 0, light: 0, rem: 0, wake: 0 }; let any = false;
  const segs = Array.isArray(x.stages) ? x.stages : Array.isArray(x.segments) ? x.segments : null;
  const epochRaw = [];
  const t0ms = Date.parse(`${s1.date}T00:00:00Z`) + s1.minutes * 60000;
  if (segs) {
    for (const g of segs) {
      const k = STAGE(g.type || g.stage || g.level || g.sleepStage); if (!k) continue;
      const a = parseStamp(g.startTime || g.start || g.start_time), b = parseStamp(g.endTime || g.end || g.end_time);
      let m = null;
      if (a && b) m = (Date.parse(`${b.date}T00:00:00Z`) + b.minutes * 60000 - Date.parse(`${a.date}T00:00:00Z`) - a.minutes * 60000) / 60000;
      else if (g.durationSeconds != null || g.seconds != null) m = num(g.durationSeconds ?? g.seconds) / 60;
      else if (g.minutes != null) m = num(g.minutes);
      if (m != null && m > 0) {
        mins[k] += m; any = true;
        if (a) {
          const ams = Date.parse(`${a.date}T00:00:00Z`) + a.minutes * 60000;
          epochRaw.push({ t: k, s: Math.max(0, (ams - t0ms) / 60000), d: m });
        }
      }
    }
  } else if (x.stages && typeof x.stages === 'object') {
    const vals = Object.values(x.stages).map(num).filter((v) => v != null);
    const secs = vals.some((v) => v > 1000); // seconds-per-stage exports
    for (const [k0, v] of Object.entries(x.stages)) { const k = STAGE(k0); const n = num(v); if (k && n != null) { mins[k] += secs ? n / 60 : n; any = true; } }
  }
  const sm = x.summary || {};
  if (!any && Array.isArray(sm.stagesSummary)) for (const g of sm.stagesSummary) { const k = STAGE(g.type); const n = num(g.minutes); if (k && n != null) { mins[k] += n; any = true; } }
  const r = (v) => Math.round(v);
  const asleep = num(sm.minutesAsleep) ?? (any ? r(mins.deep + mins.light + mins.rem) : null);
  const awake = num(sm.minutesAwake) ?? (any ? r(mins.wake) : null);
  const tib = num(sm.minutesInSleepPeriod ?? sm.timeInBed) ?? Math.round((Date.parse(`${e1.date}T00:00:00Z`) + e1.minutes * 60000 - Date.parse(`${s1.date}T00:00:00Z`) - s1.minutes * 60000) / 60000);
  acc.addSession({
    logId: x.logId != null ? String(x.logId) : (o.name || x.id || null), date: e1.date,
    start: `${s1.date}T${hhmm(s1)}`, end: `${e1.date}T${hhmm(e1)}`,
    minutes_asleep: asleep, minutes_awake: awake, time_in_bed: tib,
    efficiency: num(x.efficiency ?? sm.efficiency) ?? (asleep && tib ? Math.round(asleep / tib * 100) : null),
    deep: any ? r(mins.deep) : null, light: any ? r(mins.light) : null, rem: any ? r(mins.rem) : null, wake: any ? r(mins.wake) : null,
    main: x.isMainSleep === true || x.mainSleep === true || String(x.type || '').toUpperCase() !== 'NAP', type: x.type || 'google-health', score: null,
    stages: packEpochs(epochRaw),
  });
}

// ---------- JSON ----------
const TAKEOUT_PREFIX = /^(steps|calories|distance|heart_rate|resting_heart_rate|sedentary_minutes|lightly_active_minutes|moderately_active_minutes|very_active_minutes|sleep|active_zone_minutes|time_in_heart_rate_zones|daily_heart_rate_variability|heart_rate_variability|spo2|oxygen_saturation)[-_]/i;

function handleJSON(acc, relPath, data) {
  const base = path.basename(relPath).toLowerCase();
  const pm = base.match(TAKEOUT_PREFIX);
  const prefix = pm ? pm[1].toLowerCase() : null;

  // Google Health style sleep (single record, {dataPoints:[...]}, or array)
  const ghList = Array.isArray(data) ? data : data && Array.isArray(data.dataPoints) ? data.dataPoints : data && Array.isArray(data.sleep) && data.sleep.some(isGHSleep) && !data.sleep.some((x) => x && x.levels) ? data.sleep : [data];
  if (ghList.length && ghList.some(isGHSleep) && !ghList.some((x) => x && (x.levels || x.dateOfSleep))) {
    ghList.filter(isGHSleep).forEach((x) => addGHSleep(acc, x));
    return acc.mark('sleep_google_json');
  }
  // Web API shapes
  if (data && !Array.isArray(data) && typeof data === 'object') {
    let used = false;
    for (const [k, arr] of Object.entries(data)) {
      if (!Array.isArray(arr)) continue;
      const kk = k.toLowerCase();
      if (kk === 'sleep') { arr.forEach((s) => addSleepLog(acc, s)); used = true; }
      else if (kk === 'activities-steps' || kk === 'activities-tracker-steps') { arr.forEach((r) => acc.set(parseStamp(r.dateTime)?.date, 'steps', num(r.value), 2)); used = true; }
      else if (kk === 'activities-calories' || kk === 'activities-tracker-calories') { arr.forEach((r) => acc.set(parseStamp(r.dateTime)?.date, 'calories', num(r.value), 2)); used = true; }
      else if (kk === 'activities-heart') { arr.forEach((r) => acc.set(parseStamp(r.dateTime)?.date, 'resting_hr', num(r.value?.restingHeartRate), 2)); used = true; }
      else if (kk === 'hrv') { arr.forEach((r) => acc.set(parseStamp(r.dateTime)?.date, 'hrv', num(r.value?.dailyRmssd), 2)); used = true; }
      else if (kk === 'br') { arr.forEach((r) => acc.set(parseStamp(r.dateTime)?.date, 'breathing_rate', num(r.value?.breathingRate), 2)); used = true; }
      else if (kk === 'spo2') { arr.forEach((r) => { const d = parseStamp(r.dateTime)?.date; acc.set(d, 'spo2_avg', num(r.value?.avg), 2); acc.set(d, 'spo2_min', num(r.value?.min), 2); }); used = true; }
    }
    if (used) return acc.mark('webapi_json');
    // Per-day activity summary {summary:{...}} — date from filename or field
    if (data.summary && (data.summary.steps != null || data.summary.caloriesOut != null)) {
      const d = parseStamp(data.date || data.dateTime)?.date || (base.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
      if (d) {
        const s = data.summary;
        acc.set(d, 'steps', num(s.steps), 2); acc.set(d, 'calories', num(s.caloriesOut), 2);
        acc.set(d, 'sedentary_minutes', num(s.sedentaryMinutes), 2); acc.set(d, 'light_minutes', num(s.lightlyActiveMinutes), 2);
        acc.set(d, 'fairly_active_minutes', num(s.fairlyActiveMinutes), 2); acc.set(d, 'very_active_minutes', num(s.veryActiveMinutes), 2);
        acc.set(d, 'resting_hr', num(s.restingHeartRate), 2);
        const tot = Array.isArray(s.distances) && s.distances.find((x) => x.activity === 'total');
        if (tot) acc.set(d, 'distance_km', num(tot.distance), 2);
        return acc.mark('activity_summary_json');
      }
    }
    return acc.report.skipped.push(relPath);
  }
  if (!Array.isArray(data) || !data.length) return acc.report.skipped.push(relPath);
  const first = data.find((x) => x && typeof x === 'object') || {};

  // Sleep logs
  if (prefix === 'sleep' || 'dateOfSleep' in first || ('levels' in first && 'startTime' in first)) {
    data.forEach((s) => addSleepLog(acc, s));
    return acc.mark('sleep_json');
  }
  // Takeout {dateTime, value} series
  if ('dateTime' in first && 'value' in first) {
    const v0 = first.value;
    if (prefix === 'resting_heart_rate' || (v0 && typeof v0 === 'object' && 'error' in v0 && 'date' in v0)) {
      for (const r of data) {
        const v = num(r.value?.value); if (!v) continue; // 0 = no data
        const d = parseStamp(r.value?.date)?.date || parseStamp(r.dateTime)?.date;
        acc.set(d, 'resting_hr', round(v, 1), 2);
      }
      return acc.mark('resting_heart_rate_json');
    }
    if (prefix === 'heart_rate' || (v0 && typeof v0 === 'object' && 'bpm' in v0)) {
      for (const r of data) {
        const st = parseStamp(r.dateTime); const bpm = num(r.value?.bpm); if (!st || !bpm) continue;
        const a = acc.intraday(acc.localStamp(st, true).date);
        a.hrSum += bpm; a.hrN++; if (bpm < a.hrMin) a.hrMin = bpm; if (bpm > a.hrMax) a.hrMax = bpm;
      }
      return acc.mark('heart_rate_json');
    }
    if (prefix === 'active_zone_minutes' || (v0 && typeof v0 === 'object' && 'total_minutes' in v0)) {
      for (const r of data) { const st = parseStamp(r.dateTime); if (!st) continue; const d = acc.localStamp(st, true).date; const f = (acc.fields[d] ||= {}); const cur = f.azm?.v || 0; f.azm = { v: cur + (num(r.value?.total_minutes) || 0), p: 1 }; }
      return acc.mark('active_zone_minutes_json');
    }
    if (prefix === 'demographic_vo2_max' || (v0 && typeof v0 === 'object' && 'demographicVO2Max' in v0)) {
      for (const r of data) { const v = num(r.value?.filteredDemographicVO2Max) || num(r.value?.demographicVO2Max); if (v) acc.set(parseStamp(r.dateTime)?.date, 'vo2_max', round(v, 1), 2); }
      return acc.mark('vo2_max_json');
    }
    const scalar = (r) => num(typeof r.value === 'object' && r.value !== null ? (r.value.value ?? r.value.minutes) : r.value);
    const stamps = data.slice(0, 50).map((r) => parseStamp(r.dateTime)).filter(Boolean);
    const isDaily = stamps.length && stamps.every((s) => !s.minutes);
    const dailyField = { sedentary_minutes: 'sedentary_minutes', lightly_active_minutes: 'light_minutes', moderately_active_minutes: 'fairly_active_minutes', very_active_minutes: 'very_active_minutes' }[prefix];
    if (dailyField) { for (const r of data) acc.set(parseStamp(r.dateTime)?.date, dailyField, scalar(r), 2); return acc.mark(prefix + '_json'); }
    if (prefix === 'steps' || prefix === 'calories' || prefix === 'distance') {
      if (isDaily) {
        const f = prefix === 'distance' ? 'distance_km' : prefix;
        for (const r of data) { let v = scalar(r); if (prefix === 'distance' && v > 1000) v = round(v / 100000, 2); acc.set(parseStamp(r.dateTime)?.date, f, v, 2); }
      } else {
        for (const r of data) {
          const st = parseStamp(r.dateTime); const v = scalar(r); if (!st || v == null) continue;
          // Verified on a real 2026 export: steps/distance minute stamps are UTC, calories minute stamps are local.
          const a = acc.intraday(acc.localStamp(st, prefix !== 'calories').date);
          if (prefix === 'steps') { a.steps += v; a.stepsN++; } else if (prefix === 'calories') { a.calories += v; a.calN++; } else { a.distance += v; a.distN++; }
        }
      }
      return acc.mark(prefix + '_json');
    }
  }
  // Generic array of objects -> treat as table
  const headers = [...new Set(data.slice(0, 20).flatMap((r) => Object.keys(flatten(r))))];
  const rows = data.map((r) => { const f = flatten(r); return headers.map((h) => f[h]); });
  if (handleTable(acc, relPath, headers, rows)) return;
  acc.report.skipped.push(relPath);
}
function flatten(o, pre = '', out = {}) {
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, pre + k + '_', out); else out[pre + k] = v; }
  return out;
}

// ---------- CSV ----------
function handleCSVText(acc, relPath, text) {
  const rows = parseCSV(text).filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!rows.length) return acc.report.skipped.push(relPath);
  // Legacy selection export: sections introduced by a one-cell row ("Activities", "Sleep", ...)
  const sectionIdx = rows.findIndex((r) => r.length === 1 && /^(activities|sleep|body|foods)$/i.test(r[0].trim()));
  if (sectionIdx >= 0) return handleSelectionExport(acc, relPath, rows);
  const headers = rows[0];
  if (!handleTable(acc, relPath, headers, rows.slice(1))) acc.report.skipped.push(relPath);
}

function handleSelectionExport(acc, relPath, rows) {
  let section = null; let header = null;
  for (const r of rows) {
    if (r.length === 1 && /^[A-Za-z ]+$/.test(r[0].trim())) { section = r[0].trim().toLowerCase(); header = null; continue; }
    if (!header) { header = r.map(norm); continue; }
    const g = (name) => { const i = header.indexOf(name); return i >= 0 ? r[i] : null; };
    if (section === 'activities') {
      const d = parseStamp(g('date'))?.date; if (!d) continue;
      acc.set(d, 'steps', num(g('steps')), 2); acc.set(d, 'calories', num(g('caloriesburned')), 2);
      acc.set(d, 'distance_km', num(g('distance')), 2); acc.set(d, 'sedentary_minutes', num(g('minutessedentary')), 2);
      acc.set(d, 'light_minutes', num(g('minuteslightlyactive')), 2); acc.set(d, 'fairly_active_minutes', num(g('minutesfairlyactive')), 2);
      acc.set(d, 'very_active_minutes', num(g('minutesveryactive')), 2);
    } else if (section === 'sleep') {
      const s = parseStamp(g('starttime')); const e = parseStamp(g('endtime')); if (!e) continue;
      acc.addSession({ logId: null, date: e.date, start: s ? `${s.date}T${hhmm(s)}` : null, end: `${e.date}T${hhmm(e)}`,
        minutes_asleep: num(g('minutesasleep')), minutes_awake: num(g('minutesawake')), time_in_bed: num(g('timeinbed')), efficiency: null,
        deep: num(g('minutesdeepsleep')), light: num(g('minuteslightsleep')), rem: num(g('minutesremsleep')), wake: num(g('minutesawake')), main: true, type: 'selection', score: null });
    }
  }
  acc.mark('selection_export_csv');
}

// Header-driven table handler used for Takeout CSVs and generic tables.
function handleTable(acc, relPath, headersRaw, rows) {
  const H = headersRaw.map(norm);
  const idx = (...names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const lp = relPath.toLowerCase();
  const dateI = idx('date', 'timestamp', 'datetime', 'time', 'day', 'sleepday', 'activitydate', 'starttime', 'start', 'datetimeutc', 'calendardate');
  if (dateI < 0) return false;
  const stampOf = (r) => parseStamp(r[dateI]);
  const localOf = (r) => { const st = stampOf(r); return st ? toLocal(st, acc.tz) : null; };

  // --- Google-data style CSVs (lowercase headers with units, e.g. "beats per minute", "data source") ---
  // Sleep sessions: one row per sleep with start/end and minutes or stage totals.
  const sStartI = findH(H, /^(sleepstart|starttime|start|startdate|sleepstarttime|bedtime)$/), sEndI = findH(H, /^(sleepend|endtime|end|enddate|sleependtime|waketime)$/);
  if (sStartI >= 0 && sEndI >= 0 && (/sleep/.test(lp) || H.some((h) => /asleep|sleepstage|sleeplevel|minutesdeep|deepsleep/.test(h)))) {
    const stageI = findH(H, /^(stage|sleepstage|level|sleeplevel|type|value)$/);
    const asleepI = findH(H, /^(minutesasleep|totalminutesasleep|asleepminutes|minutesofsleep|sleepminutes|durationasleepminutes)$/);
    if (stageI >= 0 && asleepI < 0 && !H.some((h) => /^(minutesdeep|deepminutes|sleepleveldeep)/.test(h))) {
      // Stage segments: group into nights (gap > 90 min starts a new session) or by a log/session id.
      const idI = findH(H, /^(logid|sleeplogid|sessionid|sleepsessionid|id)$/);
      const segs = rows.map((r) => ({ a: parseStamp(r[sStartI]), b: parseStamp(r[sEndI]), k: STAGE(r[stageI]), id: idI >= 0 ? r[idI] : null })).filter((x) => x.a && x.b && x.k)
        .map((x) => ({ ...x, a: toLocal(x.a, acc.tz), b: toLocal(x.b, acc.tz) }))
        .map((x) => ({ ...x, ta: Date.parse(`${x.a.date}T00:00:00Z`) + x.a.minutes * 60000, tb: Date.parse(`${x.b.date}T00:00:00Z`) + x.b.minutes * 60000 }))
        .sort((p, q) => p.ta - q.ta);
      let cur = null; const sessions = [];
      for (const g of segs) {
        if (!cur || (idI >= 0 ? g.id !== cur.id : g.ta - cur.tb > 90 * 60000)) { cur = { id: g.id, ta: g.ta, tb: g.tb, a: g.a, b: g.b, m: { deep: 0, light: 0, rem: 0, wake: 0 }, epochs: [] }; sessions.push(cur); }
        const dur = (g.tb - g.ta) / 60000;
        cur.m[g.k] += dur; if (g.tb > cur.tb) { cur.tb = g.tb; cur.b = g.b; }
        cur.epochs.push({ t: g.k, s: (g.ta - cur.ta) / 60000, d: dur });
      }
      for (const x of sessions) {
        const asleep = Math.round(x.m.deep + x.m.light + x.m.rem); const tib = Math.round((x.tb - x.ta) / 60000);
        if (asleep < 30) continue;
        acc.addSession({ logId: x.id ? String(x.id) : `seg-${x.a.date}T${hhmm(x.a)}`, date: x.b.date, start: `${x.a.date}T${hhmm(x.a)}`, end: `${x.b.date}T${hhmm(x.b)}`,
          minutes_asleep: asleep, minutes_awake: Math.round(x.m.wake), time_in_bed: tib, efficiency: tib ? Math.round(asleep / tib * 100) : null,
          deep: Math.round(x.m.deep), light: Math.round(x.m.light), rem: Math.round(x.m.rem), wake: Math.round(x.m.wake), main: asleep >= 180, type: 'stages', score: null,
          stages: packEpochs(x.epochs) });
      }
      acc.mark('sleep_stages_csv'); return true;
    }
    const g = (re) => findH(H, re);
    const dI = g(/^(minutesdeep|deepminutes|deepsleepminutes|sleepleveldeep|deep)$/), lI = g(/^(minuteslight|lightminutes|lightsleepminutes|sleeplevellight|light)$/),
      rI = g(/^(minutesrem|remminutes|remsleepminutes|sleeplevelrem|rem)$/), wI = g(/^(minutesawake|awakeminutes|wakeminutes|sleeplevelwake|sleeplevelawake|awake|wake)$/),
      tI = g(/^(timeinbed|minutesinbed|minutesinsleepperiod)$/), eI = g(/^(efficiency|sleepefficiency)$/), mainI = g(/^(ismainsleep|mainsleep)$/), idI = g(/^(logid|sleeplogid|sessionid|id)$/);
    let n = 0;
    for (const r of rows) {
      const a0 = parseStamp(r[sStartI]), b0 = parseStamp(r[sEndI]); if (!a0 || !b0) continue;
      const a = toLocal(a0, acc.tz), b = toLocal(b0, acc.tz);
      const tibCalc = Math.round((Date.parse(`${b.date}T00:00:00Z`) + b.minutes * 60000 - Date.parse(`${a.date}T00:00:00Z`) - a.minutes * 60000) / 60000);
      const deep = dI >= 0 ? num(r[dI]) : null, light = lI >= 0 ? num(r[lI]) : null, rem = rI >= 0 ? num(r[rI]) : null, wake = wI >= 0 ? num(r[wI]) : null;
      const asleep = asleepI >= 0 ? num(r[asleepI]) : (deep != null || light != null || rem != null ? (deep || 0) + (light || 0) + (rem || 0) : null);
      if (!asleep && !tibCalc) continue;
      acc.addSession({ logId: idI >= 0 && r[idI] ? String(r[idI]) : null, date: b.date, start: `${a.date}T${hhmm(a)}`, end: `${b.date}T${hhmm(b)}`,
        minutes_asleep: asleep, minutes_awake: wake, time_in_bed: tI >= 0 ? num(r[tI]) : tibCalc, efficiency: eI >= 0 ? num(r[eI]) : (asleep && tibCalc ? Math.round(asleep / tibCalc * 100) : null),
        deep, light, rem, wake, main: mainI >= 0 ? /true|1|yes/i.test(r[mainI]) : (asleep || 0) >= 180, type: 'csv', score: null });
      n++;
    }
    if (n) { acc.mark('sleep_sessions_csv'); return true; }
  }
  // Daily resting heart rate (e.g. daily_resting_heart_rate.csv: timestamp, beats per minute, data source)
  const bpmI = findH(H, /^(beatsperminute|bpm|heartrate|heartratebpm|valuebpm|restingheartrate|restingheartratebeatsperminute)$/);
  if (/resting/.test(lp) && bpmI >= 0) {
    for (const r of rows) { const st = localOf(r); const v = num(r[bpmI]); if (st && v) acc.set(stampOf(r).date, 'resting_hr', round(v, 1), 2); }
    acc.mark('resting_hr_csv'); return true;
  }
  // HRV with long unit-suffixed headers (daily_heart_rate_variability.csv / heart_rate_variability.csv)
  const hrvLongI = findH(H, /^(averageheartratevariabilitymilliseconds|heartratevariabilitymilliseconds|rootmeansquareofsuccessivedifferencesmilliseconds|rmssdmilliseconds|dailyrmssdmilliseconds)$/);
  if (hrvLongI >= 0) {
    const daily = /daily/.test(lp);
    for (const r of rows) { const st = stampOf(r); const v = num(r[hrvLongI]); if (!st || !v) continue; if (daily) acc.set(st.date, 'hrv', round(v, 1), 2); else { const a = acc.intraday(nightDate(toLocal(st, acc.tz))); a.hrvSum += v; a.hrvN++; } }
    acc.mark(daily ? 'hrv_daily_csv' : 'hrv_details_csv'); return true;
  }
  // SpO2 with percentage headers
  const spAvgI = findH(H, /^(averagepercentage|averageoxygensaturationpercentage|spo2percentavg|averagespo2percentage)$/);
  const spMinI = findH(H, /^(lowerboundpercentage|minimumpercentage|spo2percentmin)$/);
  const spValI = findH(H, /^(oxygensaturationpercentage|percentage|spo2percentage)$/);
  if (spAvgI >= 0 || (spValI >= 0 && /oxygen|spo2/.test(lp))) {
    for (const r of rows) {
      const st = stampOf(r); if (!st) continue;
      if (spAvgI >= 0) { acc.set(st.date, 'spo2_avg', num(r[spAvgI]), 2); if (spMinI >= 0) acc.set(st.date, 'spo2_min', num(r[spMinI]), 2); }
      else { const v = num(r[spValI]); if (v) { const a = acc.intraday(nightDate(toLocal(st, acc.tz))); a.spo2Sum += v; a.spo2N++; } }
    }
    acc.mark(spAvgI >= 0 ? 'spo2_daily_csv' : 'spo2_minute_csv'); return true;
  }
  // Breathing rate ("breaths per minute")
  const brI = findH(H, /^(breathsperminute|respiratoryratebreathsperminute|fullsleepbreathsperminute)$/);
  if (brI >= 0) {
    for (const r of rows) { const st = stampOf(r); const v = num(r[brI]); if (st && v) acc.set(/daily/.test(lp) ? st.date : nightDate(toLocal(st, acc.tz)), 'breathing_rate', round(v, 1), 2); }
    acc.mark('respiratory_rate_csv'); return true;
  }

  // Sleep score
  if (idx('overallscore') >= 0) {
    const sI = idx('overallscore'), lI = idx('sleeplogentryid'), rI = idx('restingheartrate');
    for (const r of rows) {
      const st = stampOf(r); const sc = num(r[sI]); if (!st || sc == null) continue;
      const loc = toLocal(st, acc.tz);
      acc.pendingScores.push({ logId: lI >= 0 ? r[lI] : null, date: loc.date, score: sc });
      if (rI >= 0) acc.set(loc.date, 'resting_hr', num(r[rI]), 0.5);
    }
    acc.mark('sleep_score_csv'); return true;
  }
  // Daily readiness
  if (idx('readinessscorevalue', 'readinessscore', 'readiness') >= 0) {
    const vI = idx('readinessscorevalue', 'readinessscore', 'readiness'), sI = idx('readinessstate');
    for (const r of rows) { const st = stampOf(r); if (!st) continue; acc.set(st.date, 'readiness', num(r[vI]), 2); if (sI >= 0 && r[sI]) acc.set(st.date, 'readiness_state', String(r[sI]).toLowerCase(), 2); }
    acc.mark('readiness_csv'); return true;
  }
  // HRV
  if (idx('rmssd', 'dailyrmssd', 'hrvdailyrmssd') >= 0) {
    const vI = idx('rmssd', 'dailyrmssd', 'hrvdailyrmssd');
    const isDetail = idx('coverage') >= 0 || /details/.test(lp);
    for (const r of rows) {
      const st = stampOf(r); const v = num(r[vI]); if (!st || v == null || v <= 0) continue;
      if (isDetail) { const a = acc.intraday(nightDate(st)); a.hrvSum += v; a.hrvN++; }
      else acc.set(st.date, 'hrv', round(v, 1), 2);
    }
    acc.mark(isDetail ? 'hrv_details_csv' : 'hrv_daily_csv'); return true;
  }
  // SpO2
  if (/spo2|oxygen/.test(lp) || idx('averagespo2', 'spo2avg', 'spo2') >= 0) {
    const aI = idx('averagevalue', 'averagespo2', 'spo2avg', 'spo2', 'avg');
    const loI = idx('lowerbound', 'minspo2', 'spo2min', 'min');
    const vI = idx('value');
    if (aI >= 0) { for (const r of rows) { const st = stampOf(r); if (!st) continue; acc.set(st.date, 'spo2_avg', num(r[aI]), 2); if (loI >= 0) acc.set(st.date, 'spo2_min', num(r[loI]), 2); } acc.mark('spo2_daily_csv'); return true; }
    if (vI >= 0) { for (const r of rows) { const st = stampOf(r); const v = num(r[vI]); if (!st || v == null) continue; const a = acc.intraday(nightDate(st)); a.spo2Sum += v; a.spo2N++; } acc.mark('spo2_minute_csv'); return true; }
  }
  // Respiratory rate
  if (idx('fullsleepbreathingrate', 'breathingrate', 'respiratoryrate', 'dailyrespiratoryrate') >= 0) {
    const vI = idx('fullsleepbreathingrate', 'breathingrate', 'respiratoryrate', 'dailyrespiratoryrate');
    for (const r of rows) { const st = stampOf(r); if (st) acc.set(st.date, 'breathing_rate', num(r[vI]), 2); }
    acc.mark('respiratory_rate_csv'); return true;
  }
  // Stress score
  if (idx('stressscore') >= 0) {
    const vI = idx('stressscore');
    for (const r of rows) { const st = stampOf(r); const v = num(r[vI]); if (st && v) acc.set(st.date, 'stress_score', v, 2); }
    acc.mark('stress_csv'); return true;
  }
  // Generic metric columns
  const SUM = { steps: ['steps', 'totalsteps', 'stepcount', 'stepsvalue', 'value_steps'], calories: ['calories', 'caloriesburned', 'caloriesout', 'totalcalories', 'energykcal'], active_minutes: ['activeminutes', 'activityminutes'], azm: ['activezoneminutes', 'azm'] };
  const MEAN = { resting_hr: ['restingheartrate', 'restinghr', 'rhr', 'restingheartratebpm'], hrv: ['hrv', 'heartratevariability', 'hrvms'], spo2_avg: ['oxygensaturation'], sleep_score: ['sleepscore'], sleep_minutes: ['minutesasleep', 'totalminutesasleep', 'sleepminutes', 'sleepdurationminutes'] };
  const HR = ['bpm', 'heartrate', 'heartratebpm', 'value_bpm', 'valuebpm', 'beatsperminute'];
  const found = [];
  for (const [f, names] of Object.entries(SUM)) { const i = idx(...names); if (i >= 0) found.push({ f, i, agg: 'sum' }); }
  for (const [f, names] of Object.entries(MEAN)) { const i = idx(...names); if (i >= 0) found.push({ f, i, agg: 'mean' }); }
  const hrI = idx(...HR);
  // Plain "value" column: infer metric from the file name.
  if (!found.length && hrI < 0) {
    const vI = idx('value', 'count', 'quantity');
    if (vI >= 0) {
      if (/resting/.test(lp)) found.push({ f: 'resting_hr', i: vI, agg: 'mean' });
      else if (/heart/.test(lp)) found.push({ f: '__hr', i: vI, agg: 'hr' });
      else if (/step/.test(lp)) found.push({ f: 'steps', i: vI, agg: 'sum' });
      else if (/calor/.test(lp)) found.push({ f: 'calories', i: vI, agg: 'sum' });
    }
  }
  if (hrI >= 0) found.push({ f: '__hr', i: hrI, agg: 'hr' });
  if (!found.length) return false;
  const agg = {};
  for (const r of rows) {
    const st0 = stampOf(r); if (!st0) continue;
    const st = toLocal(st0, acc.tz);
    for (const { f, i, agg: kind } of found) {
      const v = num(r[i]); if (v == null) continue;
      const k = `${st.date}|${f}`; const a = (agg[k] ||= { s: 0, n: 0, mn: Infinity, mx: -Infinity, kind, f, date: st.date });
      a.s += v; a.n++; if (v < a.mn) a.mn = v; if (v > a.mx) a.mx = v;
    }
  }
  for (const a of Object.values(agg)) {
    if (a.kind === 'sum') acc.set(a.date, a.f, Math.round(a.s), 1.5);
    else if (a.kind === 'mean') acc.set(a.date, a.f, round(a.s / a.n, 1), 1.5);
    else { const x = acc.intraday(a.date); x.hrSum += a.s; x.hrN += a.n; x.hrMin = Math.min(x.hrMin, a.mn); x.hrMax = Math.max(x.hrMax, a.mx); }
  }
  acc.mark('generic_table'); return true;
}

// ---------- entry points ----------
function handleFile(acc, relPath, buf) {
  acc.report.filesSeen++;
  const lower = relPath.toLowerCase();
  if (SKIP_DIRS.test(lower.replace(/\\/g, '/'))) { acc.report.skipped.push(relPath); return; }
  const cls = classify(relPath);
  if (cls && cls.skip) { acc.report.skipped.push(relPath); return; }
  if (cls) {
    if (!lower.endsWith('.csv')) { acc.report.skipped.push(relPath); return; }
    try { const t = acc.gd.handle(cls, buf.toString('utf8')); if (t === 'empty' || t === 'unknown') acc.report.skipped.push(relPath); else acc.mark(t); } catch (e) { acc.report.warnings.push(`${relPath}: ${e.message}`); }
    return;
  }
  try {
    if (lower.endsWith('.json')) handleJSON(acc, relPath, JSON.parse(buf.toString('utf8')));
    else if (lower.endsWith('.csv')) handleCSVText(acc, relPath, buf.toString('utf8'));
    else acc.report.skipped.push(relPath);
  } catch (e) {
    acc.report.warnings.push(`${relPath}: ${e.message}`);
  }
}

const RELEVANT = /\.(json|csv)$/i;
/** Cheap pre-check so large irrelevant files are not even decompressed. */
function shouldRead(relPath) { if (!RELEVANT.test(relPath)) return false; if (SKIP_DIRS.test(relPath.replace(/\\/g, '/').toLowerCase())) return false; const c = classify(relPath); return !(c && c.skip); }
module.exports = { Accumulator, handleFile, RELEVANT, hasRealData, shouldRead };
