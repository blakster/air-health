'use strict';
// File-upload source: Google Takeout (Fitbit / Google Health) zip(s), loose JSON/CSV files, or a whole folder.
const fs = require('fs');
const yauzl = require('yauzl');
const { Accumulator, handleFile: parseFile, RELEVANT, shouldRead } = require('../parser');

// Structure-only manifest of each import (file names, headers/keys, row counts, date span; no values),
// so a misread export can be diagnosed after the upload's temp files are gone.
function shapeOf(name, buf) {
  try {
    if (/\.csv$/i.test(name)) {
      const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
      const firstCol = lines.slice(1).map((l) => l.split(',')[0]).filter(Boolean);
      return { headers: (lines[0] || '').slice(0, 400), rows: Math.max(0, lines.length - 1), first: (firstCol[0] || '').slice(0, 25), last: (firstCol[firstCol.length - 1] || '').slice(0, 25) };
    }
    const j = JSON.parse(buf.toString('utf8'));
    if (Array.isArray(j)) { const o = j.find((x) => x && typeof x === 'object') || {}; return { array: j.length, keys: Object.keys(o).slice(0, 30), valueKeys: o.value && typeof o.value === 'object' ? Object.keys(o.value).slice(0, 20) : undefined, first: String(j[0]?.dateTime || j[0]?.startTime || '').slice(0, 25), last: String(j[j.length - 1]?.dateTime || j[j.length - 1]?.startTime || '').slice(0, 25) }; }
    return { keys: Object.keys(j || {}).slice(0, 30) };
  } catch (e) { return { error: e.message.slice(0, 80) }; }
}
let manifest = null;
function handleFile(acc, name, buf) {
  const before = { ...acc.report.byType }; const skippedBefore = acc.report.skipped.length;
  parseFile(acc, name, buf);
  if (!manifest) return;
  const kind = Object.keys(acc.report.byType).find((k) => acc.report.byType[k] !== before[k]) || (acc.report.skipped.length > skippedBefore ? 'skipped' : 'unknown');
  if (manifest.length < 5000) manifest.push({ file: name.replace(/^.*?Takeout\//, 'Takeout/'), bytes: buf.length, kind, ...shapeOf(name, buf) });
}

const MAX_ENTRY = 300 * 1024 * 1024; // skip absurdly large single entries

function readZip(acc, zipPath, prefix = '') {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const name = prefix + entry.fileName;
        if (/\/$/.test(entry.fileName) || !shouldRead(name) || entry.uncompressedSize > MAX_ENTRY) {
          if (!/\/$/.test(entry.fileName)) { acc.report.filesSeen++; acc.report.skipped.push(name); }
          return zip.readEntry();
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2) { acc.report.warnings.push(`${name}: ${e2.message}`); return zip.readEntry(); }
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('error', (e3) => { acc.report.warnings.push(`${name}: ${e3.message}`); zip.readEntry(); });
          stream.on('end', () => { handleFile(acc, name, Buffer.concat(chunks)); setImmediate(() => zip.readEntry()); });
        });
      });
      zip.readEntry();
    });
  });
}

/** files: [{ relPath, path }] (multer temp files). */
async function importFiles(files, opts = {}) {
  const acc = new Accumulator(opts);
  manifest = opts.manifest === false ? null : [];
  for (const f of files) {
    const rel = (f.relPath || f.originalname || 'file').replace(/\\/g, '/');
    if (/\.zip$/i.test(rel)) {
      try { await readZip(acc, f.path, rel.replace(/\.zip$/i, '') + '/'); } catch (e) { acc.report.warnings.push(`${rel}: not a readable zip (${e.message})`); }
    } else if (RELEVANT.test(rel)) {
      handleFile(acc, rel, fs.readFileSync(f.path));
    } else { acc.report.filesSeen++; acc.report.skipped.push(rel); }
  }
  const out = acc.finish();
  if (manifest) { out.manifest = manifest; manifest = null; }
  out.report.skippedCount = out.report.skipped.length;
  out.report.skipped = out.report.skipped.slice(0, 25);
  return out;
}

module.exports = {
  id: 'takeout-upload', label: 'Google Health / Fitbit export upload', kind: 'file',
  status: () => ({ available: true, configured: true, note: 'Upload the Takeout .zip (or the extracted folder / individual JSON+CSV files).' }),
  importFiles,
};
