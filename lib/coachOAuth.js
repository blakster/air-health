'use strict';
/**
 * SuperGrok / X Premium+ subscription OAuth (RFC 8628 device-code).
 * Unofficial path used by Hermes/shunt (2026): tokens from auth.x.ai, chat via
 * https://cli-chat-proxy.grok.com/v1 (NOT api.x.ai — that returns 402 personal-team-blocked).
 * Tokens live only in data/.coach-oauth.json (0600). Never logged or sent to the browser.
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');

const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const SCOPE = 'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write';
const DEVICE_URL = 'https://auth.x.ai/oauth2/device/code';
const TOKEN_URL = 'https://auth.x.ai/oauth2/token';
const PROXY_BASE = 'https://cli-chat-proxy.grok.com/v1';
const DEFAULT_MODEL = 'grok-4.6';
const EXPIRY_BUFFER_SEC = 5 * 60;
const CLI_HEADERS = {
  'x-xai-token-auth': 'xai-grok-cli',
  'x-grok-client-identifier': 'grok-shell',
  'x-grok-client-version': '1.0.13',
};

const AUTH_FILE = () => path.join(store.DATA_DIR, '.coach-oauth.json');

// In-memory pending device flow (never persisted).
let pending = null;
// Single-flight refresh lock (refresh tokens rotate).
let refreshLock = Promise.resolve();

function ensureDir() {
  fs.mkdirSync(store.DATA_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(store.DATA_DIR, 0o700); } catch {}
}

function readAuth() {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH_FILE(), 'utf8'));
    if (j && j.tokens && j.tokens.access_token && j.tokens.refresh_token) return j;
  } catch {}
  return null;
}

function writeAuth(obj) {
  ensureDir();
  const f = AUTH_FILE();
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, f);
  try { fs.chmodSync(f, 0o600); } catch {}
}

function clearAuth() {
  try { fs.rmSync(AUTH_FILE(), { force: true }); } catch {}
  pending = null;
}

function jwtExp(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return 0;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return Number(payload.exp) || 0;
  } catch { return 0; }
}

function connected() {
  const a = readAuth();
  return !!(a && a.tokens && a.tokens.refresh_token);
}

function statusPublic() {
  const a = readAuth();
  if (!a) return { connected: false, pending: !!pending };
  return {
    connected: true,
    pending: !!pending,
    connectedAt: a.connected_at || a.last_refresh || null,
    lastRefresh: a.last_refresh || null,
  };
}

async function formPost(url, fields) {
  const body = new URLSearchParams(fields).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function startDeviceFlow() {
  const { ok, status, data } = await formPost(DEVICE_URL, { client_id: CLIENT_ID, scope: SCOPE });
  if (!ok) {
    const err = new Error(plainAuthError(status, data) || `Could not start SuperGrok login (${status}).`);
    err.code = 'DEVICE_START_FAILED';
    err.status = status;
    throw err;
  }
  if (!data.device_code || !data.user_code) {
    const err = new Error('xAI did not return a device code. Try again.');
    err.code = 'DEVICE_START_FAILED';
    throw err;
  }
  const interval = Math.max(1, Number(data.interval) || 5);
  const expiresIn = Math.max(30, Number(data.expires_in) || 900);
  pending = {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri || 'https://auth.x.ai/activate',
    verification_uri_complete: data.verification_uri_complete || null,
    interval,
    expires_at: Date.now() + expiresIn * 1000,
    next_poll_at: Date.now() + interval * 1000,
  };
  let qr = null;
  const link = pending.verification_uri_complete || `${pending.verification_uri}?user_code=${encodeURIComponent(pending.user_code)}`;
  try { qr = await require('qrcode').toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch {}
  return {
    user_code: pending.user_code,
    verification_uri: pending.verification_uri,
    verification_uri_complete: pending.verification_uri_complete || link,
    expires_at: pending.expires_at,
    interval: pending.interval,
    qr,
  };
}

function plainAuthError(status, data) {
  const msg = String(data?.error_description || data?.error || data?.message || '').toLowerCase();
  if (status === 402 || status === 403 || /personal-team-blocked|spending-limit|not.?entitled|tier/.test(msg)) {
    return 'Your SuperGrok plan may not allow this connection yet. Use an API key from console.x.ai instead.';
  }
  if (data?.error === 'access_denied' || data?.error === 'authorization_denied') return 'You denied the SuperGrok connection.';
  if (data?.error === 'expired_token') return 'That login code expired. Start Connect SuperGrok again.';
  if (data?.error === 'invalid_grant') return 'SuperGrok login expired. Connect SuperGrok again.';
  return null;
}

/** One poll of the token endpoint for the pending device flow. Safe to call from the UI on an interval. */
async function pollDeviceFlow() {
  if (!pending) {
    if (connected()) return { status: 'connected', ...statusPublic() };
    return { status: 'idle' };
  }
  if (Date.now() > pending.expires_at) {
    pending = null;
    return { status: 'expired', error: 'That login code expired. Start Connect SuperGrok again.' };
  }
  if (Date.now() < pending.next_poll_at) {
    return {
      status: 'pending',
      user_code: pending.user_code,
      verification_uri: pending.verification_uri,
      verification_uri_complete: pending.verification_uri_complete,
      expires_at: pending.expires_at,
      interval: pending.interval,
    };
  }
  const { ok, status, data } = await formPost(TOKEN_URL, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: CLIENT_ID,
    device_code: pending.device_code,
  });
  if (ok && data.access_token && data.refresh_token) {
    writeAuth({
      tokens: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        id_token: data.id_token || undefined,
      },
      connected_at: new Date().toISOString(),
      last_refresh: new Date().toISOString(),
    });
    pending = null;
    return { status: 'connected', ...statusPublic() };
  }
  const err = data?.error;
  if (err === 'authorization_pending') {
    pending.next_poll_at = Date.now() + pending.interval * 1000;
    return {
      status: 'pending',
      user_code: pending.user_code,
      verification_uri: pending.verification_uri,
      verification_uri_complete: pending.verification_uri_complete,
      expires_at: pending.expires_at,
      interval: pending.interval,
    };
  }
  if (err === 'slow_down') {
    pending.interval = Math.min(30, pending.interval + 5);
    pending.next_poll_at = Date.now() + pending.interval * 1000;
    return {
      status: 'pending',
      user_code: pending.user_code,
      verification_uri: pending.verification_uri,
      verification_uri_complete: pending.verification_uri_complete,
      expires_at: pending.expires_at,
      interval: pending.interval,
    };
  }
  pending = null;
  const message = plainAuthError(status, data) || `SuperGrok login failed (${err || status}). Try again.`;
  return { status: 'error', error: message };
}

async function refreshTokens(auth) {
  const { ok, status, data } = await formPost(TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: auth.tokens.refresh_token,
  });
  if (!ok) {
    if (status === 400 || status === 401) clearAuth();
    const err = new Error(plainAuthError(status, data) || (status === 400 || status === 401
      ? 'SuperGrok login expired. Connect SuperGrok again.'
      : `Could not refresh SuperGrok login (${status}).`));
    err.code = status === 402 || status === 403 ? 'TIER_GATE' : 'REFRESH_FAILED';
    err.status = status;
    throw err;
  }
  if (!data.access_token || !data.refresh_token) {
    const err = new Error('SuperGrok refresh returned an incomplete token. Connect SuperGrok again.');
    err.code = 'REFRESH_FAILED';
    throw err;
  }
  const next = {
    tokens: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      id_token: data.id_token || auth.tokens.id_token,
    },
    connected_at: auth.connected_at || new Date().toISOString(),
    last_refresh: new Date().toISOString(),
  };
  writeAuth(next);
  return next;
}

async function getValidAccessToken() {
  let auth = readAuth();
  if (!auth) {
    const err = new Error('SuperGrok is not connected.');
    err.code = 'NOT_CONNECTED';
    throw err;
  }
  const exp = jwtExp(auth.tokens.access_token);
  if (exp && Date.now() / 1000 < exp - EXPIRY_BUFFER_SEC) return auth.tokens.access_token;

  const run = refreshLock.then(async () => {
    auth = readAuth();
    if (!auth) {
      const err = new Error('SuperGrok is not connected.');
      err.code = 'NOT_CONNECTED';
      throw err;
    }
    const exp2 = jwtExp(auth.tokens.access_token);
    if (exp2 && Date.now() / 1000 < exp2 - EXPIRY_BUFFER_SEC) return auth.tokens.access_token;
    const next = await refreshTokens(auth);
    return next.tokens.access_token;
  });
  refreshLock = run.catch(() => {});
  return run;
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data?.output || []) {
    if (item?.type === 'message') {
      for (const c of item.content || []) {
        if (c?.type === 'output_text' || c?.type === 'text') parts.push(c.text || '');
      }
    } else if (typeof item?.text === 'string') parts.push(item.text);
  }
  return parts.join('').trim();
}

async function askViaProxy({ model, system, history }) {
  const token = await getValidAccessToken();
  const url = `${PROXY_BASE}/responses`;
  const body = {
    model: model || DEFAULT_MODEL,
    instructions: system,
    input: history.map((m) => ({ role: m.role, content: m.content })),
    store: false,
    max_output_tokens: 900,
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...CLI_HEADERS,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const plain = plainAuthError(res.status, data?.error || data);
      const err = new Error(plain || `LLM error ${res.status}: ${data?.error?.message || data?.message || 'request failed'}`);
      err.code = plain ? 'TIER_GATE' : 'LLM_ERROR';
      err.status = res.status;
      throw err;
    }
    const answer = extractResponseText(data);
    if (!answer) throw new Error('SuperGrok returned an empty reply.');
    return { answer, provider: 'supergrok', model: body.model };
  } finally {
    clearTimeout(t);
  }
}

function disconnect() { clearAuth(); return statusPublic(); }

function cancelPending() { pending = null; }

// Test helpers (no tokens exposed)
function _testSetPending(p) { pending = p; }
function _testGetPending() { return pending; }

module.exports = {
  CLIENT_ID, SCOPE, DEVICE_URL, TOKEN_URL, PROXY_BASE, DEFAULT_MODEL, CLI_HEADERS, AUTH_FILE,
  connected, statusPublic, startDeviceFlow, pollDeviceFlow, getValidAccessToken, askViaProxy,
  disconnect, cancelPending, clearAuth, readAuth, writeAuth, jwtExp, plainAuthError, extractResponseText,
  _testSetPending, _testGetPending,
};
