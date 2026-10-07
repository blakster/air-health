#!/usr/bin/env node
// Re-derive sleep (and other HC fields) into store.json from already-stored Health Connect
// raw records in data/hc/days/<date>.json — no phone re-upload.
//
// Usage:
//   node scripts/restore_hc_sleep.js                 # days that still have SleepSession raw
//   node scripts/restore_hc_sleep.js 2026-10-07       # specific wake date(s)
//   node scripts/restore_hc_sleep.js --scan           # list days with raw SleepSession; do not write
//   node scripts/restore_hc_sleep.js --all            # re-apply every HC day file
//   node scripts/restore_hc_sleep.js --request-phone  # ask phone for sleep-only window (needs app ≥ sleep-resync)
//   node scripts/restore_hc_sleep.js --request-phone --days 3
'use strict';
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const hc = require('../lib/sources/healthConnect');
const store = require('../lib/store');

const args = process.argv.slice(2);
const scanOnly = args.includes('--scan');
const all = args.includes('--all');
const requestPhone = args.includes('--request-phone');
const daysFlag = args.indexOf('--days');
const phoneDays = daysFlag >= 0 ? Math.min(14, Math.max(1, +args[daysFlag + 1] || 3)) : 3;
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

function print(obj) { console.log(JSON.stringify(obj, null, 2)); }

(async () => {
  if (requestPhone) {
    const s = hc.requestSleepResync(phoneDays);
    print({
      ok: true,
      action: 'sleepResync-requested',
      sleepResync: s.sleepResync,
      note: 'Open Air Health Sync on the phone and tap Sync now. App 1.1.1+ re-reads SleepSession for the last N nights only (no full history backfill). Older apps ignore this flag — rebuild/install the APK, or use full "Resend everything" as a last resort.',
    });
    return;
  }

  const list = hc.listDays();
  const withSleep = list.filter((d) => {
    const day = hc.readDay(d);
    return Object.values(day.records || {}).some((r) => r && r.t === 'SleepSession');
  });

  if (scanOnly) {
    print({
      hcDays: list.length,
      range: list.length ? [list[0], list[list.length - 1]] : null,
      rawSleepDays: withSleep,
      note: withSleep.length
        ? 'Raw SleepSession still on disk — run without --scan to re-apply into the dashboard.'
        : 'No SleepSession records in data/hc/days/. Cannot re-derive sleep locally. Use --request-phone (sleep-only) or a full phone resync.',
    });
    return;
  }

  const targets = all ? list : (dates.length ? dates : withSleep);
  if (!targets.length) {
    print({
      ok: false,
      restored: [],
      rawSleepDays: withSleep,
      error: 'No HC days to restore. Raw SleepSession is missing from data/hc/days/.',
      recovery: [
        '1) Prefer: node scripts/restore_hc_sleep.js --request-phone --days 3  then Sync now on the phone (needs Air Health Sync with sleep-resync support).',
        '2) Or Data page → "Recover last-night sleep" (same flag).',
        '3) Last resort: Data page → "Resend everything" (full history; slow).',
        '4) Takeout zip in data/takeout-raw/ has no recent sleep (only May 2026 manual) — re-import will not bring last night back.',
      ],
    });
    process.exit(2);
  }

  const out = hc.restoreFromStore(targets);
  const today = (store.active().days || {})[targets[targets.length - 1]] || {};
  print({
    ok: out.restored.some((r) => r.sleep_minutes != null),
    ...out,
    todaySample: {
      date: targets[targets.length - 1],
      sleep_minutes: today.sleep_minutes ?? null,
      sleep_deep: today.sleep_deep ?? null,
      sleep_light: today.sleep_light ?? null,
      sleep_rem: today.sleep_rem ?? null,
      sleep_wake: today.sleep_wake ?? null,
      bedtime: today.bedtime ?? null,
      waketime: today.waketime ?? null,
      sleep_stages: Array.isArray(today.sleep_stages) ? today.sleep_stages.length : 0,
    },
  });
  if (!out.restored.some((r) => r.sleep_minutes != null)) process.exit(2);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
