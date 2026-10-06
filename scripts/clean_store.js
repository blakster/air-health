// Re-applies the importer's day rules to the stored real dataset (drops future and placeholder days).
// Used because the original 6 Oct upload zip was not kept. Back up data/store.json first.
'use strict';
const fs = require('fs'); const path = require('path');
const { hasRealData } = require('../lib/parser'); const { todayLocal } = require('../lib/util');
const FILE = path.join(__dirname, '..', 'data', 'store.json');
const s = JSON.parse(fs.readFileSync(FILE, 'utf8')); const T = todayLocal();
const before = Object.keys(s.real.days).length; const dropped = { future: 0, empty: 0 };
for (const [d, row] of Object.entries(s.real.days)) {
  const f = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, { v }]));
  if (d > T) { dropped.future++; delete s.real.days[d]; } else if (!hasRealData(f)) { dropped.empty++; delete s.real.days[d]; }
}
s.real.sleep = s.real.sleep.filter((x) => x.date <= T);
const dates = Object.keys(s.real.days).sort();
s.real.imports.push({ source: 'cleanup', files: 0, days: dates.length, range: dates.length ? [dates[0], dates[dates.length - 1]] : null, note: `dropped ${dropped.future} future and ${dropped.empty} placeholder days`, at: new Date().toISOString() });
s.real.updatedAt = new Date().toISOString();
if (!dates.length) s.active = 'sample';
fs.writeFileSync(FILE + '.tmp', JSON.stringify(s)); fs.renameSync(FILE + '.tmp', FILE);
console.log(JSON.stringify({ before, after: dates.length, dropped, range: [dates[0], dates[dates.length - 1]], active: s.active }));
