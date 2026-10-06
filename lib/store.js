'use strict';
// Tiny JSON file store. Keeps the SAMPLE dataset and the user's REAL (uploaded/live) dataset separate.
const fs = require('fs');
const path = require('path');
const { generateSample } = require('./sample');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

function blank() {
  return { version: 1, active: 'sample', settings: { stepGoal: 10000, sleepGoalMinutes: 450 }, real: { days: {}, sleep: [], imports: [], updatedAt: null } };
}
let state = null;
let sampleCache = null;

function load() {
  if (state) return state;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try { state = { ...blank(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { state = blank(); }
  return state;
}
function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}
function sample() { if (!sampleCache) sampleCache = generateSample(60); return sampleCache; }

/** Dataset currently shown in the UI, always tagged with whether it is sample data. */
function active() {
  const s = load();
  const hasReal = Object.keys(s.real.days).length > 0;
  if (s.active === 'real' && hasReal) return { isSample: false, days: s.real.days, sleep: s.real.sleep, meta: { imports: s.real.imports, updatedAt: s.real.updatedAt } };
  const smp = sample();
  return { isSample: true, days: smp.days, sleep: smp.sleep, meta: { generated: true } };
}

function sessionKey(x) { return String(x.logId || `${x.date}|${x.start}`); }

/** Merge a normalised import into the real dataset (later imports win per field). */
function mergeReal(parsed, info) {
  const s = load();
  for (const [date, row] of Object.entries(parsed.days)) s.real.days[date] = { ...(s.real.days[date] || {}), ...row };
  const map = new Map(s.real.sleep.map((x) => [sessionKey(x), x]));
  for (const x of parsed.sleep) map.set(sessionKey(x), { ...(map.get(sessionKey(x)) || {}), ...x });
  s.real.sleep = [...map.values()].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  s.real.imports.push({ ...info, at: new Date().toISOString() });
  s.real.updatedAt = new Date().toISOString();
  if (Object.keys(s.real.days).length) s.active = 'real';
  save();
}
function setActive(which) { const s = load(); s.active = which === 'real' ? 'real' : 'sample'; save(); }
function clearReal() { const s = load(); s.real = blank().real; s.active = 'sample'; save(); }
function settings() { return load().settings; }
function updateSettings(patch) {
  const s = load();
  if (patch.stepGoal != null) s.settings.stepGoal = Math.max(1000, Math.min(50000, Math.round(+patch.stepGoal) || 10000));
  if (patch.sleepGoalMinutes != null) s.settings.sleepGoalMinutes = Math.max(240, Math.min(720, Math.round(+patch.sleepGoalMinutes) || 450));
  save(); return s.settings;
}
function status() {
  const s = load();
  const dates = Object.keys(s.real.days).sort();
  return { active: active().isSample ? 'sample' : 'real', real: { days: dates.length, range: dates.length ? [dates[0], dates[dates.length - 1]] : null, sleepSessions: s.real.sleep.length, imports: s.real.imports.slice(-10), updatedAt: s.real.updatedAt } };
}
module.exports = { load, active, mergeReal, setActive, clearReal, settings, updateSettings, status, DATA_DIR };
