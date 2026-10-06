'use strict';
/**
 * Coach API keys stored server-side only in data/.coach-secrets.json (mode 0600).
 * Also honours process.env / .env. Never returns raw keys to the browser.
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');

const KEY_ENVS = ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'];
const EXTRA = ['COACH_PROVIDER', 'COACH_MODEL', 'OPENAI_BASE_URL', 'prefer'];
const SECRETS_FILE = () => path.join(store.DATA_DIR, '.coach-secrets.json');

function ensureDir() {
  fs.mkdirSync(store.DATA_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(store.DATA_DIR, 0o700); } catch {}
}

function readFile() {
  try {
    const j = JSON.parse(fs.readFileSync(SECRETS_FILE(), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}

function writeFile(obj) {
  ensureDir();
  const f = SECRETS_FILE();
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 0), { mode: 0o600 });
  fs.renameSync(tmp, f);
  try { fs.chmodSync(f, 0o600); } catch {}
}

/** Apply secrets file into process.env (file wins over empty env; does not overwrite existing non-empty env unless force). */
function applyToEnv({ force = false } = {}) {
  const s = readFile();
  for (const k of [...KEY_ENVS, 'COACH_PROVIDER', 'COACH_MODEL', 'OPENAI_BASE_URL']) {
    if (s[k] == null || s[k] === '') continue;
    if (force || process.env[k] == null || process.env[k] === '') process.env[k] = String(s[k]);
  }
  return s;
}

function mask(key) {
  const v = String(key || '');
  if (v.length < 8) return v ? '••••' : null;
  return `${'•'.repeat(Math.min(12, v.length - 4))}${v.slice(-4)}`;
}

function publicStatus() {
  const s = readFile();
  const fromFile = KEY_ENVS.find((k) => s[k]);
  const fromEnv = KEY_ENVS.find((k) => process.env[k]);
  const envName = fromFile || fromEnv || null;
  const raw = envName ? (s[envName] || process.env[envName]) : null;
  const provider = (s.COACH_PROVIDER || process.env.COACH_PROVIDER || '').toLowerCase() || null;
  return {
    configured: !!envName,
    env: envName,
    provider: provider || (envName ? envName.replace(/_API_KEY$/, '').toLowerCase().replace('openai', 'openai').replace('xai', 'xai').replace('anthropic', 'anthropic').replace('gemini', 'gemini') : null),
    masked: raw ? mask(raw) : null,
    model: s.COACH_MODEL || process.env.COACH_MODEL || null,
    prefer: s.prefer === 'apikey' ? 'apikey' : (s.prefer === 'oauth' ? 'oauth' : null),
    source: fromFile ? 'file' : (fromEnv ? 'env' : null),
  };
}

/**
 * Save one API key (and optional provider/model/prefer). Clears other keys in the file so only one is active.
 * Body: { provider: 'xai'|'openai'|'anthropic'|'gemini', key: string, model?: string, prefer?: 'oauth'|'apikey' }
 */
function save({ provider, key, model, prefer, openaiBaseUrl } = {}) {
  const map = { xai: 'XAI_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' };
  const id = String(provider || 'xai').toLowerCase();
  const envName = map[id];
  if (!envName) {
    const err = new Error('Unknown provider. Use xai, openai, anthropic, or gemini.');
    err.code = 'BAD_PROVIDER';
    throw err;
  }
  const k = String(key || '').trim();
  if (k.length < 8) {
    const err = new Error('That API key looks too short.');
    err.code = 'BAD_KEY';
    throw err;
  }
  const next = { ...readFile() };
  for (const e of KEY_ENVS) delete next[e];
  next[envName] = k;
  next.COACH_PROVIDER = id;
  if (model != null && String(model).trim()) next.COACH_MODEL = String(model).trim();
  else delete next.COACH_MODEL;
  if (openaiBaseUrl != null && String(openaiBaseUrl).trim()) next.OPENAI_BASE_URL = String(openaiBaseUrl).trim().replace(/\/$/, '');
  if (prefer === 'oauth' || prefer === 'apikey') next.prefer = prefer;
  else next.prefer = 'apikey';
  writeFile(next);
  // Hot-apply into this process so restart is not required.
  for (const e of KEY_ENVS) {
    if (e === envName) process.env[e] = k;
    else if (readFile()[e] == null) { /* leave other env vars from .env alone */ }
  }
  process.env.COACH_PROVIDER = id;
  if (next.COACH_MODEL) process.env.COACH_MODEL = next.COACH_MODEL;
  else delete process.env.COACH_MODEL;
  if (next.OPENAI_BASE_URL) process.env.OPENAI_BASE_URL = next.OPENAI_BASE_URL;
  return publicStatus();
}

function setPrefer(prefer) {
  const next = { ...readFile() };
  if (prefer === 'oauth' || prefer === 'apikey') next.prefer = prefer;
  else delete next.prefer;
  writeFile(next);
  return publicStatus();
}

function clearKeys() {
  const next = { ...readFile() };
  for (const e of KEY_ENVS) delete next[e];
  delete next.COACH_PROVIDER;
  delete next.COACH_MODEL;
  writeFile(next);
  for (const e of KEY_ENVS) delete process.env[e];
  delete process.env.COACH_PROVIDER;
  delete process.env.COACH_MODEL;
  // Re-apply keys from .env if present (file secrets are gone; env file still counts).
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m || line.trim().startsWith('#')) continue;
        if ([...KEY_ENVS, 'COACH_PROVIDER', 'COACH_MODEL', 'OPENAI_BASE_URL'].includes(m[1])) {
          process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
        }
      }
    }
  } catch {}
  return publicStatus();
}

module.exports = {
  SECRETS_FILE, KEY_ENVS, applyToEnv, publicStatus, save, setPrefer, clearKeys, mask, readFile,
};
