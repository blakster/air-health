'use strict';
/**
 * Mocked SuperGrok OAuth + CLI proxy + secrets tests (no live network).
 * Run: node scripts/test_coach_oauth.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-oauth-'));
process.env.DATA_DIR = tmp;
process.env.XAI_API_KEY = '';
delete process.env.XAI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.COACH_PROVIDER;
delete process.env.COACH_MODEL;

// Fresh modules against tmp DATA_DIR
delete require.cache[require.resolve('../lib/store')];
delete require.cache[require.resolve('../lib/coachOAuth')];
delete require.cache[require.resolve('../lib/coachSecrets')];
delete require.cache[require.resolve('../lib/coach')];

const oauth = require('../lib/coachOAuth');
const secrets = require('../lib/coachSecrets');
const coach = require('../lib/coach');

const calls = [];
const realFetch = global.fetch;
let fetchImpl = null;
global.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: (opts.method || 'GET').toUpperCase(), headers: opts.headers || {}, body: opts.body });
  if (fetchImpl) return fetchImpl(url, opts);
  return { ok: false, status: 500, json: async () => ({ error: 'unmocked' }) };
};

function jsonRes(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function fakeJwt(expSec) {
  return `hdr.${b64url({ exp: expSec })}.sig`;
}

async function run() {
  let n = 0;
  const ok = (name) => { n++; console.log('ok', n, name); };

  // --- secrets save + mask ---
  assert.strictEqual(coach.status().configured, false);
  const st = secrets.save({ provider: 'xai', key: 'sk-test-abcdefghijklmnopqrstuvwxyz', prefer: 'apikey' });
  assert.ok(st.masked.endsWith('wxyz') || st.masked.endsWith('xyz'), st.masked);
  assert.ok(!JSON.stringify(st).includes('sk-test-abcdefghijklmnopqrstuvwxyz'));
  assert.ok(fs.existsSync(secrets.SECRETS_FILE()));
  assert.strictEqual(fs.statSync(secrets.SECRETS_FILE()).mode & 0o777, 0o600);
  assert.strictEqual(coach.status().configured, true);
  assert.strictEqual(coach.status().path, 'apikey');
  assert.strictEqual(coach.status().provider, 'xai');
  ok('secrets save + mode 600 + mask');

  // --- device start ---
  fetchImpl = async (url) => {
    if (String(url).includes('/device/code')) {
      return jsonRes(200, {
        device_code: 'dev-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.x.ai/activate',
        verification_uri_complete: 'https://auth.x.ai/activate?user_code=ABCD-EFGH',
        expires_in: 600,
        interval: 1,
      });
    }
    return jsonRes(500, {});
  };
  const started = await oauth.startDeviceFlow();
  assert.strictEqual(started.user_code, 'ABCD-EFGH');
  assert.ok(started.verification_uri_complete.includes('ABCD-EFGH'));
  ok('device flow start');

  // --- poll pending then success ---
  let polls = 0;
  fetchImpl = async (url, opts) => {
    if (String(url).includes('/token')) {
      polls++;
      const body = String(opts.body || '');
      if (body.includes('device_code')) {
        if (polls < 2) return jsonRes(400, { error: 'authorization_pending' });
        return jsonRes(200, {
          access_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600),
          refresh_token: 'refresh-1',
          id_token: 'id-1',
        });
      }
    }
    return jsonRes(500, {});
  };
  oauth._testSetPending({
    device_code: 'dev-1', user_code: 'ABCD-EFGH',
    verification_uri: 'https://auth.x.ai/activate',
    verification_uri_complete: 'https://auth.x.ai/activate?user_code=ABCD-EFGH',
    interval: 0, expires_at: Date.now() + 60000, next_poll_at: 0,
  });
  let p = await oauth.pollDeviceFlow();
  assert.strictEqual(p.status, 'pending');
  oauth._testGetPending().next_poll_at = 0;
  p = await oauth.pollDeviceFlow();
  assert.strictEqual(p.status, 'connected');
  assert.ok(oauth.connected());
  assert.strictEqual(fs.statSync(oauth.AUTH_FILE()).mode & 0o777, 0o600);
  const raw = fs.readFileSync(oauth.AUTH_FILE(), 'utf8');
  assert.ok(raw.includes('refresh-1'));
  // status must not leak tokens
  const pub = JSON.stringify(coach.status());
  assert.ok(!pub.includes('refresh-1'));
  assert.ok(!pub.includes('access_token'));
  ok('device poll → connected, file 600, no token leak in status');

  // Prefer OAuth when both exist
  secrets.setPrefer('oauth');
  assert.strictEqual(coach.status().path, 'oauth');
  assert.strictEqual(coach.status().provider, 'supergrok');
  ok('prefer oauth when both connected');

  // --- ask via proxy (Responses API) ---
  calls.length = 0;
  fetchImpl = async (url, opts) => {
    if (String(url).includes('cli-chat-proxy.grok.com')) {
      assert.strictEqual(opts.headers['x-xai-token-auth'], 'xai-grok-cli');
      assert.strictEqual(opts.headers['x-grok-client-identifier'], 'grok-shell');
      assert.ok(String(opts.headers.authorization || '').startsWith('Bearer '));
      assert.ok(!String(url).includes('api.x.ai'));
      return jsonRes(200, {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Your sleep looks steady.' }] }],
      });
    }
    return jsonRes(500, {});
  };
  const analytics = {
    empty: false, isSample: true, range: ['2026-09-01', '2026-10-06'],
    settings: { stepGoal: 10000, sleepGoalMinutes: 450 },
    summary: {}, consistency: null, stages: { sleep_deep: 60, sleep_light: 200, sleep_rem: 80, sleep_wake: 20 },
    rows: [{ date: '2026-10-05', steps: 8000 }], weekly: [], flags: [], streaks: { current: 1, longest: 3, hitLast30: 10, daysLast30: 30 },
  };
  const ans = await coach.ask(analytics, [{ role: 'user', content: 'How is my sleep?' }]);
  assert.strictEqual(ans.provider, 'supergrok');
  assert.match(ans.answer, /sleep/i);
  assert.ok(calls.some((c) => c.url.includes('cli-chat-proxy.grok.com/v1/responses')));
  ok('ask() uses CLI proxy with Grok-CLI headers');

  // --- 402 tier gate plain language ---
  fetchImpl = async () => jsonRes(402, { error: { message: 'personal-team-blocked:spending-limit' } });
  let threw = null;
  try { await coach.ask(analytics, [{ role: 'user', content: 'hi' }]); } catch (e) { threw = e; }
  assert.ok(threw);
  assert.match(threw.message, /SuperGrok plan may not allow/i);
  ok('402 → plain tier-gate message');

  // --- refresh rotation ---
  const expSoon = fakeJwt(Math.floor(Date.now() / 1000) + 60); // within 5min buffer
  oauth.writeAuth({
    tokens: { access_token: expSoon, refresh_token: 'refresh-old' },
    connected_at: '2026-10-01T00:00:00.000Z',
    last_refresh: '2026-10-01T00:00:00.000Z',
  });
  fetchImpl = async (url, opts) => {
    if (String(url).includes('/token') && String(opts.body).includes('refresh_token')) {
      assert.ok(String(opts.body).includes('refresh-old'));
      return jsonRes(200, {
        access_token: fakeJwt(Math.floor(Date.now() / 1000) + 7200),
        refresh_token: 'refresh-new',
      });
    }
    if (String(url).includes('cli-chat-proxy')) {
      return jsonRes(200, { output_text: 'ok' });
    }
    return jsonRes(500, {});
  };
  await oauth.getValidAccessToken();
  const after = oauth.readAuth();
  assert.strictEqual(after.tokens.refresh_token, 'refresh-new');
  ok('refresh rotates and persists new refresh_token');

  // --- disconnect ---
  oauth.disconnect();
  assert.strictEqual(oauth.connected(), false);
  secrets.setPrefer('apikey');
  assert.strictEqual(coach.status().path, 'apikey');
  ok('disconnect falls back to API key');

  // --- clear keys ---
  secrets.clearKeys();
  assert.strictEqual(coach.status().configured, false);
  ok('clear keys → not configured');

  // Ensure api.x.ai never used for oauth path was already asserted
  console.log(`\n${n} tests passed`);
}

run().catch((e) => { console.error(e); process.exit(1); }).finally(() => {
  global.fetch = realFetch;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});
