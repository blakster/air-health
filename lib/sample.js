'use strict';
// Deterministic, realistic SAMPLE data (~60 days). Always labelled as sample in the UI.
const { addDays, todayLocal, round } = require('./util');

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const hm = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

function generateSample(days = 60, endDate = addDays(todayLocal(), -1)) {
  const r = rng(20261006);
  const start = addDays(endDate, -(days - 1));
  const out = { days: {}, sleep: [] };
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay(); // 0 Sun
    const weekend = dow === 0 || dow === 6;
    // A short "busy / under-recovered" stretch around day 38-41 to demo deviation flags.
    const strain = i >= 38 && i <= 41 ? 1 : 0;
    const fitnessTrend = i / days; // gentle improvement over the window

    // Sleep (night before `date`). Bedtime minutes after 18:00 -> e.g. 23:40 = 340.
    const bedBase = weekend ? 24 * 60 + 10 : 23 * 60 + 15;
    const bed = bedBase + gauss(r) * 25 + strain * 55;
    const asleep = clamp(Math.round(415 + gauss(r) * 32 + (weekend ? 25 : 0) - strain * 70 + fitnessTrend * 10), 290, 540);
    const wake = clamp(Math.round(asleep * (0.1 + r() * 0.05)), 25, 80);
    const tib = asleep + wake;
    const deep = Math.round(asleep * clamp(0.16 + gauss(r) * 0.02 - strain * 0.03, 0.09, 0.24));
    const rem = Math.round(asleep * clamp(0.21 + gauss(r) * 0.025 - strain * 0.03, 0.12, 0.28));
    const light = asleep - deep - rem;
    const startMin = bed; const endMin = bed + tib;
    const prev = addDays(date, -1);
    const startStr = startMin >= 1440 ? `${date}T${hm(startMin - 1440)}` : `${prev}T${hm(startMin)}`;
    const endStr = `${date}T${hm(endMin - 1440)}`;
    const sleepScore = clamp(Math.round(55 + (asleep - 330) / 6 + (deep + rem) / asleep * 40 - wake / 10 + gauss(r) * 3), 50, 95);
    out.sleep.push({ logId: `sample-${date}`, date, start: startStr, end: endStr, minutes_asleep: asleep, minutes_awake: wake, time_in_bed: tib,
      efficiency: Math.round(asleep / tib * 100), deep, light, rem, wake, main: true, type: 'stages', score: sleepScore });

    // Heart
    const rhr = round(61.5 - fitnessTrend * 1.5 + gauss(r) * 1.1 + strain * 5 + (asleep < 360 ? 1 : 0), 1);
    const hrv = round(clamp(41 + fitnessTrend * 3 + gauss(r) * 4 - strain * 12, 18, 75), 1);
    const readiness = clamp(Math.round(72 + (hrv - 41) * 1.2 - (rhr - 61) * 3 + (asleep - 420) / 8 + gauss(r) * 4), 25, 99);
    const readinessState = readiness >= 70 ? 'high' : readiness >= 45 ? 'moderate' : 'low';

    // Activity
    const steps = Math.max(1200, Math.round((weekend ? 10400 : 8100) + gauss(r) * 2300 + fitnessTrend * 900 - strain * 2600 + (r() < 0.12 ? 4500 : 0)));
    const veryActive = Math.max(0, Math.round((steps - 6000) / 280 + gauss(r) * 6));
    const fairly = Math.max(0, Math.round(12 + gauss(r) * 7));
    const lightMin = Math.round(170 + gauss(r) * 35 + steps / 200);
    const calories = Math.round(1720 + steps * 0.052 + veryActive * 6 + gauss(r) * 70);

    out.days[date] = {
      date, steps, distance_km: round(steps * 0.00074, 2), calories,
      very_active_minutes: veryActive, fairly_active_minutes: fairly, active_minutes: veryActive + fairly, light_minutes: lightMin,
      sedentary_minutes: Math.round(1440 - tib - lightMin - veryActive - fairly), azm: Math.round(veryActive * 1.6 + fairly),
      resting_hr: rhr, hr_avg: round(rhr + 14 + gauss(r) * 2, 1), hr_min: Math.round(rhr - 6), hr_max: Math.round(125 + veryActive * 0.8 + gauss(r) * 10),
      hrv, spo2_avg: round(clamp(96.6 + gauss(r) * 0.6, 94, 99), 1), spo2_min: round(clamp(93 + gauss(r) * 1, 89, 96), 1), breathing_rate: round(14.2 + gauss(r) * 0.6 + strain * 0.8, 1),
      readiness, readiness_state: readinessState,
      sleep_minutes: asleep, time_in_bed: tib, sleep_deep: deep, sleep_light: light, sleep_rem: rem, sleep_wake: wake,
      sleep_efficiency: Math.round(asleep / tib * 100), sleep_score: sleepScore, bedtime: startStr, waketime: endStr,
    };
  }
  return { ...out, report: { generated: true, dateRange: [start, endDate], daysWithData: days, sleepSessions: out.sleep.length } };
}
module.exports = { generateSample };
