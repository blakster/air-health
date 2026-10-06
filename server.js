'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Load .env (simple KEY=VALUE) without printing anything.
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();

const express = require('express');
const multer = require('multer');
const intraday = require('./lib/intraday');
const store = require('./lib/store');
const analytics = require('./lib/analytics');
const coach = require('./lib/coach');
const sources = require('./lib/sources');

const PORT = +process.env.PORT || 4870;
const HOST = process.env.HOST || '0.0.0.0';

// ---- passcode auth (single user) ----
const passFile = path.join(store.DATA_DIR, '.passcode');
const secretFile = path.join(store.DATA_DIR, '.session-secret');
fs.mkdirSync(store.DATA_DIR, { recursive: true });
let PASSCODE = process.env.APP_PASSCODE;
if (!PASSCODE) {
  if (!fs.existsSync(passFile)) fs.writeFileSync(passFile, String(crypto.randomInt(100000, 999999)) + crypto.randomBytes(2).toString('hex') + '\n', { mode: 0o600 });
  PASSCODE = fs.readFileSync(passFile, 'utf8').trim();
}
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function makeToken() { const exp = Date.now() + 30 * 864e5; return `${exp}.${sign(String(exp))}`; }
function validToken(t) { if (!t) return false; const [exp, sig] = t.split('.'); if (!exp || !sig || +exp < Date.now()) return false; const good = sign(exp); return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((x) => x[0])); }
const attempts = new Map();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set('X-Frame-Options', 'SAMEORIGIN'); res.set('Referrer-Policy', 'no-referrer'); next(); });

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.post('/api/login', (req, res) => {
  const ip = req.socket.remoteAddress || 'x';
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const given = String(req.body?.passcode || '').trim();
  const ok = given.length === PASSCODE.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(PASSCODE));
  if (!ok) { a.n++; attempts.set(ip, a); return res.status(401).json({ error: 'Wrong passcode' }); }
  attempts.delete(ip);
  res.set('Set-Cookie', `fa_session=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.set('Set-Cookie', 'fa_session=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true }); });

app.get('/vendor/chart.umd.min.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js')));
app.get(['/login', '/login.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'styles.css')));
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), { maxAge: '30d', immutable: true }));

app.use(require('./lib/sources/healthConnect').publicRouter()); // phone sync: pairing claim + token-auth ingest (no session)
// Everything below requires a session.
app.use((req, res, next) => {
  if (validToken(cookies(req).fa_session)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'auth' });
  return res.redirect('/login');
});
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.use(require('./lib/sources/healthConnect').privateRouter()); // phone sync: pairing, status, APK download

app.get('/api/dashboard', (req, res) => {
  const a = analytics.build(store.active(), store.settings());
  res.json({ ...a, status: store.status(), coach: coach.status(), sources: sources.list() });
});
app.get('/api/status', (req, res) => res.json({ status: store.status(), coach: coach.status(), sources: sources.list(), settings: store.settings() }));
app.post('/api/settings', (req, res) => res.json(store.updateSettings(req.body || {})));
app.post('/api/source', (req, res) => { store.setActive(req.body?.active); res.json(store.status()); });
app.post('/api/clear-real', (req, res) => { store.clearReal(); intraday.clear(store.DATA_DIR); res.json(store.status()); });

// Intraday heart rate, one file per day, loaded on demand (behind the session check above).
function intradayDays() {
  const st = store.status();
  if (st.active === 'real') return { sample: false, dates: intraday.list(store.DATA_DIR) };
  const rows = Object.values(store.active().days || {}).filter((r) => r.resting_hr != null).map((r) => r.date).sort();
  return { sample: true, dates: rows.slice(-7) };
}
app.get('/api/intraday', (req, res) => res.json(intradayDays()));
app.get('/api/intraday/:date', (req, res) => {
  const { sample, dates } = intradayDays(); const d = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !dates.includes(d)) return res.status(404).json({ error: 'no intraday data for that day' });
  if (sample) { const row = store.active().days[d] || {}; return res.json(intraday.sampleDay(d, row.resting_hr || 60)); }
  res.set('Cache-Control', 'private, max-age=60'); res.json(intraday.get(store.DATA_DIR, d));
});

/**
 * Keep the latest successfully imported raw export in data/takeout-raw/ (dir 0700, files 0600) so it can be
 * re-parsed later without asking for a new upload. The previous copy is replaced only after the new one is staged.
 */
const RAW_DIR = path.join(store.DATA_DIR, 'takeout-raw');
function retainRaw(list) {
  const stage = `${RAW_DIR}.new-${process.pid}-${Date.now()}`;
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  try {
    for (const f of list) {
      const rel = String(f.relPath || path.basename(f.path)).replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').join('/') || path.basename(f.path);
      const dst = path.join(stage, rel);
      if (!dst.startsWith(stage + path.sep)) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
      fs.copyFileSync(f.path, dst);
      fs.chmodSync(dst, 0o600);
    }
    fs.writeFileSync(path.join(stage, '.retained.json'), JSON.stringify({ at: new Date().toISOString(), files: list.length }), { mode: 0o600 });
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
    fs.renameSync(stage, RAW_DIR);
    fs.chmodSync(RAW_DIR, 0o700);
  } catch (e) { fs.rmSync(stage, { recursive: true, force: true }); throw e; }
}

const upDir = path.join(os.tmpdir(), 'fitbit-air-uploads');
fs.mkdirSync(upDir, { recursive: true });
const upload = multer({ dest: upDir, limits: { fileSize: 4 * 1024 ** 3, files: 20000 } });
app.post('/api/upload', upload.array('files'), async (req, res) => {
  const files = req.files || [];
  let rel = req.body?.paths; if (typeof rel === 'string') rel = [rel];
  try {
    if (!files.length) return res.status(400).json({ error: 'No files received' });
    const list = files.map((f, i) => ({ path: f.path, relPath: (rel && rel[i]) || f.originalname }));
    const parsed = await sources.sources['takeout-upload'].importFiles(list, { intradayUtc: process.env.INTRADAY_UTC !== 'false' });
    const n = Object.keys(parsed.days).length;
    if (parsed.manifest) { try { fs.writeFileSync(path.join(store.DATA_DIR, 'last-import-manifest.json'), JSON.stringify({ at: new Date().toISOString(), report: { ...parsed.report, skipped: undefined }, files: parsed.manifest }, null, 1), { mode: 0o600 }); } catch {} delete parsed.manifest; }
    if (n && parsed.intraday) { try { parsed.report.intradaySaved = intraday.save(store.DATA_DIR, parsed.intraday); } catch (e) { console.warn('intraday save failed:', e.message); } }
    delete parsed.intraday;
    if (n) { try { retainRaw(list); } catch (e) { console.warn('could not keep raw export:', e.message); } }
    if (n) store.mergeReal(parsed, { source: 'takeout-upload', files: files.length, days: n, range: parsed.report.dateRange, byType: parsed.report.byType });
    res.json({ ok: n > 0, report: parsed.report, status: store.status() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    // multer temp copies only; the retained copy lives in data/takeout-raw/
    for (const f of files) fs.rm(f.path, { force: true }, () => {});
  }
});


const coachOAuth = require('./lib/coachOAuth');
const coachSecrets = require('./lib/coachSecrets');

app.get('/api/coach/auth', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ coach: coach.status() });
});
app.post('/api/coach/auth/start', async (req, res) => {
  try {
    const started = await coachOAuth.startDeviceFlow();
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...started, coach: coach.status() });
  } catch (e) {
    res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message, coach: coach.status() });
  }
});
app.get('/api/coach/auth/poll', async (req, res) => {
  try {
    const result = await coachOAuth.pollDeviceFlow();
    res.set('Cache-Control', 'no-store');
    res.json({ ...result, coach: coach.status() });
  } catch (e) {
    res.status(502).json({ status: 'error', error: e.message, coach: coach.status() });
  }
});
app.post('/api/coach/auth/disconnect', (req, res) => {
  coachOAuth.disconnect();
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, coach: coach.status() });
});
app.post('/api/coach/auth/cancel', (req, res) => {
  coachOAuth.cancelPending();
  res.json({ ok: true, coach: coach.status() });
});
app.post('/api/coach/secrets', (req, res) => {
  try {
    const st = coachSecrets.save(req.body || {});
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, apikey: st, coach: coach.status() });
  } catch (e) {
    res.status(e.code === 'BAD_PROVIDER' || e.code === 'BAD_KEY' ? 400 : 500).json({ error: e.message, coach: coach.status() });
  }
});
app.post('/api/coach/prefer', (req, res) => {
  const prefer = req.body?.prefer;
  if (prefer !== 'oauth' && prefer !== 'apikey') return res.status(400).json({ error: 'prefer must be oauth or apikey' });
  coachSecrets.setPrefer(prefer);
  res.json({ ok: true, coach: coach.status() });
});
app.post('/api/coach/secrets/clear', (req, res) => {
  coachSecrets.clearKeys();
  res.json({ ok: true, coach: coach.status() });
});

app.post('/api/coach', async (req, res) => {
  const a = analytics.build(store.active(), store.settings());
  try { res.json(await coach.ask(a, req.body?.messages || [])); }
  catch (e) {
    const code = e.code === 'NOT_CONFIGURED' ? 503 : (e.code === 'TIER_GATE' ? 403 : 502);
    res.status(code).json({ error: e.message, coach: coach.status() });
  }
});
app.get('/api/coach/context', (req, res) => { const a = analytics.build(store.active(), store.settings()); res.type('text/plain').send(coach.buildContext(a, req.query.q || '')); });

app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, HOST, () => console.log(`Fitbit Air dashboard on http://${HOST}:${PORT} (coach: ${coach.status().configured ? 'configured' : 'not configured'})`));
