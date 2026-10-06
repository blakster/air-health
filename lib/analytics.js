'use strict';
const { dateRange, addDays, mean, sd, round } = require('./util');

const METRICS = {
  resting_hr: { label: 'Resting heart rate', unit: 'bpm', dec: 1 },
  hrv: { label: 'HRV (RMSSD)', unit: 'ms', dec: 1 },
  steps: { label: 'Steps', unit: '', dec: 0 },
  sleep_minutes: { label: 'Sleep', unit: 'min', dec: 0 },
  sleep_score: { label: 'Sleep score', unit: '', dec: 0 },
  readiness: { label: 'Readiness', unit: '', dec: 0 },
  active_minutes: { label: 'Active minutes', unit: 'min', dec: 0 },
  calories: { label: 'Calories', unit: 'kcal', dec: 0 },
  spo2_avg: { label: 'SpO2', unit: '%', dec: 1 },
  breathing_rate: { label: 'Breathing rate', unit: 'br/min', dec: 1 },
};

// Minutes relative to 12:00 noon so 23:30 and 00:30 are close (690 / 750).
function clockFromNoon(iso) { if (!iso) return null; const m = iso.match(/T(\d{2}):(\d{2})/); if (!m) return null; const t = +m[1] * 60 + +m[2]; return (t - 720 + 1440) % 1440; }
function noonToClock(v) { if (v == null) return null; const t = Math.round(v + 720) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }

function build(dataset, settings) {
  const dates = Object.keys(dataset.days).sort();
  if (!dates.length) return { empty: true, isSample: dataset.isSample };
  const all = dateRange(dates[0], dates[dates.length - 1]);
  const rows = all.map((d) => ({ date: d, ...(dataset.days[d] || {}) }));
  const series = (k) => rows.map((r) => (r[k] == null ? null : r[k]));

  // Rolling 7-day averages + 30-day baseline (preceding days only).
  for (const k of ['resting_hr', 'hrv', 'steps', 'sleep_minutes', 'readiness', 'active_minutes', 'sleep_score']) {
    const s = series(k);
    rows.forEach((r, i) => {
      const w = s.slice(Math.max(0, i - 6), i + 1).filter((x) => x != null);
      r[`${k}_avg7`] = w.length >= 3 ? round(mean(w), METRICS[k].dec) : null;
      const b = s.slice(Math.max(0, i - 30), i).filter((x) => x != null);
      if (b.length >= 10) { r[`${k}_base`] = round(mean(b), METRICS[k].dec); r[`${k}_sd`] = round(sd(b), 2); }
    });
  }

  // Neutral deviation flags vs personal baseline.
  const flags = [];
  const rules = [
    { k: 'resting_hr', test: (v, b, s) => v - b >= 3 && (v - b) / (s || 1) >= 1.5, text: (v, b) => `Resting HR ${round(v, 1)} bpm — ${round(v - b, 1)} above your 30-day baseline (${round(b, 1)}).`, dir: 'up' },
    { k: 'resting_hr', test: (v, b, s) => b - v >= 3 && (b - v) / (s || 1) >= 1.5, text: (v, b) => `Resting HR ${round(v, 1)} bpm — ${round(b - v, 1)} below your 30-day baseline (${round(b, 1)}).`, dir: 'down' },
    { k: 'hrv', test: (v, b, s) => (b - v) / b >= 0.2 && (b - v) / (s || 1) >= 1.5, text: (v, b) => `HRV ${round(v, 1)} ms — ${Math.round((b - v) / b * 100)}% below your 30-day baseline (${round(b, 1)} ms).`, dir: 'down' },
    { k: 'hrv', test: (v, b, s) => (v - b) / b >= 0.25 && (v - b) / (s || 1) >= 1.5, text: (v, b) => `HRV ${round(v, 1)} ms — ${Math.round((v - b) / b * 100)}% above your 30-day baseline.`, dir: 'up' },
    { k: 'sleep_minutes', test: (v, b) => v <= b - 75, text: (v, b) => `Slept ${fmtMin(v)} — about ${fmtMin(b - v)} less than your usual ${fmtMin(b)}.`, dir: 'down' },
  ];
  rows.forEach((r) => {
    for (const rule of rules) {
      const v = r[rule.k], b = r[`${rule.k}_base`], s = r[`${rule.k}_sd`];
      if (v == null || b == null) continue;
      if (rule.test(v, b, s)) flags.push({ date: r.date, metric: rule.k, label: METRICS[rule.k].label, dir: rule.dir, text: rule.text(v, b) });
    }
  });

  // Sleep consistency over last 14 nights.
  const last14 = rows.slice(-14);
  const bed = last14.map((r) => clockFromNoon(r.bedtime)).filter((x) => x != null);
  const wake = last14.map((r) => clockFromNoon(r.waketime)).filter((x) => x != null);
  const sdBed = sd(bed), sdWake = sd(wake);
  const consistency = bed.length >= 5 ? {
    avgBedtime: noonToClock(mean(bed)), avgWaketime: noonToClock(mean(wake)),
    sdBedMin: round(sdBed), sdWakeMin: round(sdWake),
    score: Math.max(0, Math.min(100, Math.round(100 - ((sdBed || 0) + (sdWake || 0)) / 2 * 0.9))),
  } : null;
  rows.forEach((r) => { r.bed_clock = clockFromNoon(r.bedtime); r.wake_clock = clockFromNoon(r.waketime); });

  // Recovery: Fitbit readiness when present, else a transparent estimate.
  rows.forEach((r) => {
    if (r.readiness != null) { r.recovery = r.readiness; r.recovery_src = 'readiness'; return; }
    const parts = [];
    if (r.hrv != null && r.hrv_base) parts.push(Math.max(0, Math.min(100, 70 + (r.hrv - r.hrv_base) / r.hrv_base * 150)));
    if (r.resting_hr != null && r.resting_hr_base) parts.push(Math.max(0, Math.min(100, 70 - (r.resting_hr - r.resting_hr_base) * 6)));
    if (r.sleep_minutes != null) parts.push(Math.max(0, Math.min(100, r.sleep_minutes / (settings.sleepGoalMinutes || 450) * 85)));
    if (parts.length >= 2) { r.recovery = Math.round(mean(parts)); r.recovery_src = 'estimate'; }
  });

  // Activity: weekly averages (Mon–Sun) and step-goal streaks.
  const goal = settings.stepGoal || 10000;
  const weeks = {};
  for (const r of rows) {
    const d = new Date(r.date + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; const wk = addDays(r.date, -dow);
    (weeks[wk] ||= []).push(r);
  }
  const weekly = Object.entries(weeks).map(([wk, rs]) => ({
    week: wk, days: rs.filter((r) => r.steps != null).length,
    steps: round(mean(rs.map((r) => r.steps))), active_minutes: round(mean(rs.map((r) => r.active_minutes))),
    sleep_minutes: round(mean(rs.map((r) => r.sleep_minutes))), resting_hr: round(mean(rs.map((r) => r.resting_hr)), 1), hrv: round(mean(rs.map((r) => r.hrv)), 1),
  }));
  let cur = 0, best = 0, run = 0;
  for (const r of rows) { if (r.steps != null && r.steps >= goal) { run++; best = Math.max(best, run); } else run = 0; }
  for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].steps != null && rows[i].steps >= goal) cur++; else if (i === rows.length - 1 && rows[i].steps == null) continue; else break; }
  const last30 = rows.slice(-30);
  const streaks = { goal, current: cur, longest: best, hitLast30: last30.filter((r) => r.steps >= goal).length, daysLast30: last30.filter((r) => r.steps != null).length };

  // Window summaries.
  const win = (n, offset = 0) => rows.slice(Math.max(0, rows.length - n - offset), rows.length - offset);
  const summary = {};
  for (const k of Object.keys(METRICS)) {
    const l7 = mean(win(7).map((r) => r[k])), p7 = mean(win(7, 7).map((r) => r[k])), l30 = mean(win(30).map((r) => r[k]));
    const latest = [...rows].reverse().find((r) => r[k] != null);
    summary[k] = { ...METRICS[k], latest: latest ? latest[k] : null, latestDate: latest ? latest.date : null, avg7: round(l7, METRICS[k].dec), prev7: round(p7, METRICS[k].dec), avg30: round(l30, METRICS[k].dec), count: rows.filter((r) => r[k] != null).length };
  }
  const stages = ['sleep_deep', 'sleep_light', 'sleep_rem', 'sleep_wake'].reduce((o, k) => { o[k] = round(mean(win(14).map((r) => r[k]))); return o; }, {});
  const available = Object.fromEntries(['steps', 'calories', 'active_minutes', 'resting_hr', 'hrv', 'hr_avg', 'spo2_avg', 'breathing_rate', 'sleep_minutes', 'sleep_deep', 'sleep_score', 'readiness', 'bedtime', 'azm', 'distance_km'].map((k) => [k, rows.some((r) => r[k] != null)]));

  return {
    isSample: dataset.isSample, meta: dataset.meta, settings, range: [rows[0].date, rows[rows.length - 1].date],
    rows, sleep: dataset.sleep.slice(-90), flags, recentFlags: flags.filter((f) => f.date >= addDays(rows[rows.length - 1].date, -13)),
    consistency, weekly, streaks, summary, stages, available,
  };
}

function fmtMin(m) { if (m == null) return '—'; m = Math.round(m); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; }
module.exports = { build, METRICS, fmtMin, noonToClock };
