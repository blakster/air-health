'use strict';
/**
 * Per-day intraday heart rate, kept out of store.json: data/intraday/<YYYY-MM-DD>.json (dir 0700, files 0600).
 * Shape: { date, tz, source, step: 60, samples, avg[1440], min[1440], max[1440], zones: [{type,min,max}]|null }
 * Index i = minute of the local (IST) day; null = no samples that minute (band not worn).
 */
const fs = require('fs'); const path = require('path');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dir(dataDir) { return path.join(dataDir, 'intraday'); }
function save(dataDir, map) {
  const d = dir(dataDir); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.chmodSync(d, 0o700);
  let n = 0;
  for (const [date, day] of Object.entries(map || {})) {
    if (!DATE.test(date) || !day || !Array.isArray(day.avg)) continue;
    const f = path.join(d, `${date}.json`); const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(day), { mode: 0o600 }); fs.renameSync(tmp, f); n++;
  }
  return n;
}
function list(dataDir) {
  try { return fs.readdirSync(dir(dataDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort(); } catch { return []; }
}
function get(dataDir, date) {
  if (!DATE.test(String(date))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir(dataDir), `${date}.json`), 'utf8')); } catch { return null; }
}
function clear(dataDir) { fs.rmSync(dir(dataDir), { recursive: true, force: true }); }

/** Deterministic synthetic day for the sample dataset (never written to disk). */
function sampleDay(date, rhr = 60) {
  let seed = [...date].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const avg = new Array(1440).fill(null), min = new Array(1440).fill(null), max = new Array(1440).fill(null);
  const walk = 7 * 60 + Math.floor(rnd() * 90), run = 18 * 60 + Math.floor(rnd() * 60);
  for (let i = 0; i < 1440; i++) {
    if (i > 13 * 60 + 10 && i < 13 * 60 + 55) continue; // band off (shower) -> gap
    const asleep = i < 6 * 60 + 30 || i > 23 * 60; let v = asleep ? rhr - 4 + Math.sin(i / 40) * 2 : rhr + 18 + Math.sin(i / 25) * 6;
    if (i >= walk && i < walk + 30) v = rhr + 45; if (i >= run && i < run + 35) v = rhr + 85 + Math.sin((i - run) / 5) * 10;
    v += (rnd() - 0.5) * 6; const sp = 2 + rnd() * (asleep ? 3 : 9);
    avg[i] = Math.round(v * 10) / 10; min[i] = Math.round(v - sp); max[i] = Math.round(v + sp);
  }
  const zones = [{ type: 'LIGHT', min: 30, max: 129 }, { type: 'MODERATE', min: 130, max: 151 }, { type: 'VIGOROUS', min: 152, max: 180 }, { type: 'PEAK', min: 181, max: 220 }];
  return { date, tz: 'Asia/Calcutta', source: 'sample', step: 60, samples: avg.filter((x) => x != null).length * 12, avg, min, max, zones, sample: true };
}
function hhmm(m) {
  const x = Math.max(0, Math.min(1439, Math.round(m) | 0));
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}

/** Choose 5–10 min buckets aiming for ~48–96 series points across the worn span. */
function pickSeriesBucket(spanMin) {
  const span = Math.max(1, spanMin | 0);
  for (const b of [5, 10]) if (Math.ceil(span / b) <= 96) return b;
  return Math.max(10, Math.ceil(span / 72));
}

/** Runs of consecutive minutes where avg bpm >= threshold. Caps to keep prompt size down. */
function peakWindows(avg, len, threshold, { maxWindows = 8, minLen = 2 } = {}) {
  const wins = [];
  let start = null, peak = 0;
  const flush = (end) => {
    if (start == null) return;
    const dur = end - start + 1;
    if (dur >= minLen) wins.push({ from: hhmm(start), to: hhmm(end), minutes: dur, peakBpm: Math.round(peak) });
    start = null; peak = 0;
  };
  for (let i = 0; i < len; i++) {
    const v = avg[i];
    if (v != null && Number.isFinite(v) && v >= threshold) {
      if (start == null) { start = i; peak = v; }
      else if (v > peak) peak = v;
    } else flush(i - 1);
  }
  flush(len - 1);
  // Prefer longer / higher-peak windows if we must trim
  if (wins.length > maxWindows) {
    wins.sort((a, b) => (b.minutes - a.minutes) || (b.peakBpm - a.peakBpm));
    const top = wins.slice(0, maxWindows);
    top.sort((a, b) => a.from.localeCompare(b.from));
    return top;
  }
  return wins;
}

/**
 * Compact through-the-day HR summary for the coach prompt (not the raw 1440-minute dump).
 * Dense sparse series (5–10 min buckets, ~48–96 pts) + peak windows for activity-timing guesses.
 * Zone minutes mirror the Today-tab: non-LIGHT zones by 1-minute average; fallback above-100.
 */
function summarizeForCoach(day) {
  if (!day || !Array.isArray(day.avg) || day.avg.length < 1) return null;
  let lo = null, hi = null, loAt = 0, hiAt = 0, sum = 0, n = 0, first = null, last = null, above = 0;
  const zones = (day.zones || []).filter((z) => z && z.type && z.type !== 'LIGHT');
  const inZone = Object.fromEntries(zones.map((z) => [z.type, 0]));
  const len = Math.min(1440, day.avg.length);
  for (let i = 0; i < len; i++) {
    const v = day.avg[i]; if (v == null || !Number.isFinite(v)) continue;
    if (first == null) first = i; last = i;
    sum += v; n++;
    const mn = (day.min && day.min[i] != null) ? day.min[i] : v;
    const mx = (day.max && day.max[i] != null) ? day.max[i] : v;
    if (lo == null || mn < lo) { lo = mn; loAt = i; }
    if (hi == null || mx > hi) { hi = mx; hiAt = i; }
    if (v >= 100) above++;
    for (const z of zones) if (v >= z.min && v <= z.max) inZone[z.type]++;
  }
  if (!n || first == null) return null;

  const span = last - first + 1;
  const bucket = pickSeriesBucket(span);
  const series = [];
  for (let t = first - (first % bucket); t <= last; t += bucket) {
    let s = 0, c = 0;
    const end = Math.min(t + bucket, len);
    for (let i = Math.max(t, 0); i < end; i++) {
      const v = day.avg[i]; if (v == null || !Number.isFinite(v)) continue;
      s += v; c++;
    }
    if (c) series.push({ t: hhmm(t), bpm: Math.round(s / c) });
  }

  const modZ = zones.find((z) => z.type === 'MODERATE');
  const vigZ = zones.find((z) => z.type === 'VIGOROUS');
  const modTh = modZ ? modZ.min : 130;
  const vigTh = vigZ ? vigZ.min : 152;
  const peaksModerate = peakWindows(day.avg, len, modTh, { maxWindows: 8, minLen: 2 });
  const peaksVigorous = peakWindows(day.avg, len, vigTh, { maxWindows: 6, minLen: 2 });

  return {
    date: day.date || null,
    source: day.source || null,
    samples: day.samples != null ? day.samples : n,
    wornMin: n,
    avg: Math.round((sum / n) * 10) / 10,
    min: lo, minAt: hhmm(loAt),
    max: hi, maxAt: hhmm(hiAt),
    wornFrom: hhmm(first),
    wornTo: hhmm(last),
    zones: zones.map((z) => ({ type: z.type, threshold: z.min, minutes: inZone[z.type] || 0 })),
    above100: above,
    bucketMin: bucket,
    series,
    peaksModerate: { threshold: modTh, windows: peaksModerate },
    peaksVigorous: { threshold: vigTh, windows: peaksVigorous },
  };
}

function fmtWindows(list) {
  if (!list || !list.length) return '(none ≥2 min)';
  return list.map((w) => `${w.from}–${w.to} (${w.minutes} min, peak ${w.peakBpm})`).join('; ');
}

/** One short text block for the coach context. */
function formatCoachBlock(s, { label } = {}) {
  if (!s) return '';
  const title = label || `INTRADAY HR (${s.date})`;
  const lines = [];
  lines.push(`\n${title}:`);
  lines.push(`date ${s.date}, source ${s.source || '?'}, raw samples ${s.samples}, worn ${s.wornMin} of 1440 min (${s.wornFrom || '?'}–${s.wornTo || '?'} IST).`);
  lines.push(`avg ${s.avg} bpm; min ${s.min} at ${s.minAt} IST; max ${s.max} at ${s.maxAt} IST.`);
  if (s.zones && s.zones.length) {
    lines.push(`zone minutes (by 1-min avg, excl. Light): ${s.zones.map((z) => `${z.type}≥${z.threshold} → ${z.minutes} min`).join('; ')}.`);
  } else {
    lines.push(`elevated (≥100 bpm): ${s.above100} min.`);
  }
  const seriesStr = (s.series || []).map((p) => `${p.t}=${p.bpm}`).join(', ');
  lines.push(`${s.bucketMin || 10}-min avg bpm series across worn window (IST, ${(s.series || []).length} pts): ${seriesStr || '(none)'}.`);
  if (s.peaksModerate) {
    lines.push(`elevated windows MODERATE≥${s.peaksModerate.threshold}: ${fmtWindows(s.peaksModerate.windows)}.`);
  }
  if (s.peaksVigorous) {
    lines.push(`elevated windows VIGOROUS≥${s.peaksVigorous.threshold}: ${fmtWindows(s.peaksVigorous.windows)}.`);
  }
  lines.push('(Use the series + elevated windows for activity-timing guesses. Sparse only — do not invent finer minute-level detail.)');
  return lines.join('\n');
}

module.exports = { save, list, get, clear, sampleDay, summarizeForCoach, formatCoachBlock, hhmm, pickSeriesBucket, peakWindows };
