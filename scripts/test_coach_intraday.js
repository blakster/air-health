'use strict';
// Compact intraday summary for coach context (zones, dense series, peak windows, date pick).
const assert = require('assert');
const intraday = require('../lib/intraday');
const store = require('../lib/store');
const analytics = require('../lib/analytics');
const coach = require('../lib/coach');

const day = intraday.sampleDay('2026-09-12', 60);
const s = intraday.summarizeForCoach(day);
assert.ok(s && s.wornMin > 0 && s.avg > 40 && s.avg < 200);
assert.ok(s.minAt && s.maxAt && s.wornFrom && s.wornTo);
assert.ok(s.bucketMin >= 5, 'bucket at least 5 min');
assert.ok(s.series && s.series.length >= 48 && s.series.length <= 96, `series length ${s.series && s.series.length}`);
assert.ok(s.series.every((p) => /^\d{2}:\d{2}$/.test(p.t) && p.bpm > 30 && p.bpm < 220));
assert.ok(s.zones.some((z) => z.type === 'MODERATE'));
assert.ok(s.peaksModerate && Array.isArray(s.peaksModerate.windows));
assert.ok(s.peaksVigorous && Array.isArray(s.peaksVigorous.windows));
assert.ok(s.peaksVigorous.windows.length >= 1, 'sample day has a vigorous run bout');
const block = intraday.formatCoachBlock(s, { label: 'INTRADAY HR TODAY (2026-09-12)' });
assert.ok(block.includes('-min avg bpm series') && block.includes('zone minutes'));
assert.ok(block.includes('elevated windows MODERATE') && block.includes('elevated windows VIGOROUS'));
assert.ok(block.includes('activity-timing'));
assert.ok(!block.includes('hourly avg bpm'), 'hourly list replaced by denser series');
assert.strictEqual(intraday.summarizeForCoach({ avg: [] }), null);
assert.strictEqual(intraday.summarizeForCoach(null), null);

assert.strictEqual(intraday.pickSeriesBucket(750), 10);
assert.strictEqual(intraday.pickSeriesBucket(400), 5);

const a = analytics.build(store.active(), store.settings());
const ctx = coach.buildContext(a, 'heart rate today');
assert.ok(/INTRADAY HR/.test(ctx), 'context includes intraday block');
assert.ok(/-min avg bpm series/.test(ctx), 'context has dense series');
assert.ok(/elevated windows/.test(ctx), 'context has peak windows');
assert.ok(/activity-timing/.test(ctx), 'context hints activity timing');
assert.ok(!/,"avg":\[/.test(ctx), 'raw minute array not dumped');
console.log('OK: coach intraday summary + context wiring');
console.log(ctx.slice(ctx.indexOf('INTRADAY HR')));
