'use strict';
// Shared date helpers. All dates are local calendar dates "YYYY-MM-DD".
const USER_TZ = process.env.APP_TZ || 'Asia/Calcutta';

function pad(n) { return String(n).padStart(2, '0'); }

// Offset in minutes of a timezone at a given instant (e.g. +330 for IST).
function tzOffsetMinutes(tz, date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

function todayLocal(tz = USER_TZ) {
  const d = new Date(Date.now() + tzOffsetMinutes(tz) * 60000);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Parse the many timestamp shapes found in Fitbit / Google Health exports.
 * Returns { date: 'YYYY-MM-DD', minutes: minutes-after-midnight|null, utc: boolean } in
 * the timestamp's own wall clock, or null.
 *   "10/01/23 00:00:05"        (Takeout Global Export Data, MM/DD/YY)
 *   "10/01/2023"               (selection export)
 *   "2023-10-01T23:10:30.000"  (sleep logs, local wall clock)
 *   "2023-10-01T07:12:30Z"     (sleep score csv, UTC)
 *   "2023-10-01 23:10:30"      (newer CSVs)
 *   "2023-10-01 11:10 PM"      (selection export sleep)
 */
function parseStamp(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^"|"$/g, '');
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i))) {
    let h = m[4] != null ? +m[4] : null;
    if (h != null && m[7]) { const pm = m[7].toUpperCase() === 'PM'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    const tzs = m[8] || null;
    const res = { date: `${m[1]}-${m[2]}-${m[3]}`, minutes: h == null ? null : h * 60 + +m[5] + (+(m[6] || 0)) / 60, utc: false };
    if (tzs) {
      // Normalise to UTC, mark utc=true so caller can shift to the user's zone.
      let off = 0;
      if (tzs.toUpperCase() !== 'Z') { const mm = tzs.match(/([+-])(\d{2}):?(\d{2})/); off = (mm[1] === '-' ? -1 : 1) * (+mm[2] * 60 + +mm[3]); }
      return shiftStamp({ ...res, minutes: res.minutes ?? 0 }, -off, true);
    }
    return res;
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i))) {
    let y = +m[3]; if (y < 100) y += 2000;
    let h = m[4] != null ? +m[4] : null;
    if (h != null && m[7]) { const pm = m[7].toUpperCase() === 'PM'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return { date: `${y}-${pad(m[1])}-${pad(m[2])}`, minutes: h == null ? null : h * 60 + +m[5] + (+(m[6] || 0)) / 60, utc: false };
  }
  // Epoch millis / seconds
  if (/^\d{10,13}$/.test(s)) {
    const ms = s.length === 13 ? +s : +s * 1000;
    const d = new Date(ms);
    return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), utc: true };
  }
  return null;
}

function shiftStamp(st, offsetMin, utcFlag = false) {
  if (!st) return st;
  const base = Date.parse(st.date + 'T00:00:00Z') + (st.minutes || 0) * 60000 + offsetMin * 60000;
  const d = new Date(base);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60, utc: utcFlag };
}

// Convert a UTC stamp to user's local wall clock.
function toLocal(st, tz = USER_TZ) {
  if (!st || !st.utc) return st;
  const off = tzOffsetMinutes(tz, new Date(Date.parse(st.date + 'T00:00:00Z') + (st.minutes || 0) * 60000));
  return { ...shiftStamp(st, off), utc: false };
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mean(arr) { const a = arr.filter((x) => x != null && Number.isFinite(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function sd(arr) { const a = arr.filter((x) => x != null && Number.isFinite(x)); if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }
function round(v, d = 0) { if (v == null) return null; const f = 10 ** d; return Math.round(v * f) / f; }

module.exports = { USER_TZ, pad, tzOffsetMinutes, todayLocal, addDays, dateRange, parseStamp, shiftStamp, toLocal, num, mean, sd, round };
