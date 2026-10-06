'use strict';
/**
 * AI coach. Builds a compact context from the normalised data and calls an LLM.
 *
 * Paths (equal options in the UI):
 *   1. SuperGrok subscription OAuth → cli-chat-proxy.grok.com (data/.coach-oauth.json)
 *   2. API key → XAI / OpenAI / Anthropic / Gemini (data/.coach-secrets.json or .env)
 *
 * Prefer OAuth when connected unless the user picked "API key" (prefer=apikey).
 * Keys and tokens stay server-side only and are never logged or sent to the browser.
 */
const { fmtMin } = require('./analytics');
const { todayLocal } = require('./util');
const store = require('./store');
const intraday = require('./intraday');
const secrets = require('./coachSecrets');
const oauth = require('./coachOAuth');

secrets.applyToEnv();

const PROVIDERS = {
  xai: { env: 'XAI_API_KEY', model: 'grok-4-fast', url: 'https://api.x.ai/v1/chat/completions', style: 'openai' },
  openai: { env: 'OPENAI_API_KEY', model: 'gpt-4.1-mini', url: () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions', style: 'openai' },
  anthropic: { env: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-5', url: 'https://api.anthropic.com/v1/messages', style: 'anthropic' },
  gemini: { env: 'GEMINI_API_KEY', model: 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', style: 'openai' },
};

function pickApi() {
  secrets.applyToEnv();
  const forced = (process.env.COACH_PROVIDER || '').toLowerCase();
  const order = forced && PROVIDERS[forced] ? [forced] : ['xai', 'openai', 'anthropic', 'gemini'];
  for (const id of order) if (process.env[PROVIDERS[id].env]) return { id, ...PROVIDERS[id], model: process.env.COACH_MODEL || PROVIDERS[id].model };
  return null;
}

function activePath() {
  const sec = secrets.publicStatus();
  const oAuthOn = oauth.connected();
  const api = pickApi();
  if (sec.prefer === 'apikey' && api) return { path: 'apikey', api };
  if (oAuthOn && sec.prefer !== 'apikey') return { path: 'oauth', api };
  if (api) return { path: 'apikey', api };
  if (oAuthOn) return { path: 'oauth', api };
  return { path: null, api: null };
}

function status() {
  secrets.applyToEnv();
  const sec = secrets.publicStatus();
  const oa = oauth.statusPublic();
  const { path, api } = activePath();
  const configured = path != null;
  const out = {
    configured,
    path,
    provider: path === 'oauth' ? 'supergrok' : (api ? api.id : null),
    model: path === 'oauth' ? (process.env.COACH_MODEL || oauth.DEFAULT_MODEL) : (api ? api.model : null),
    oauth: oa,
    apikey: {
      configured: !!api || sec.configured,
      env: sec.env,
      provider: api ? api.id : sec.provider,
      masked: sec.masked,
      source: sec.source,
    },
    prefer: sec.prefer || (oa.connected ? 'oauth' : (api ? 'apikey' : null)),
    expects: ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'],
  };
  if (!configured) {
    out.note = 'Connect SuperGrok or add an API key on this page. Keys stay on the server.';
  }
  return out;
}

const SYSTEM = `You are a friendly personal wellness coach inside Vansh's private health dashboard. His tracker is a Google Fitbit Air (screenless band; data from the Google Health app).
Rules:
- Answer ONLY from the data provided in the context. Quote specific numbers and dates. If the data doesn't contain the answer, say so.
- Give general wellness, sleep-hygiene and training guidance only. Never diagnose, never name medical conditions as likely causes, never suggest medication.
- Describe deviations neutrally ("higher than your usual"), and mention normal causes (late meals, alcohol, travel, stress, hard training, illness) without alarm.
- If something looks persistently unusual or he mentions symptoms (chest pain, fainting, breathlessness), suggest checking with a doctor.
- Be concise: short paragraphs or bullets, practical next steps. Times are Asia/Calcutta (IST).
- When an INTRADAY HR block is present, use its series + elevated windows for activity-timing guesses (when effort likely started/peaked/ended), and cite peaks, lows, and zone minutes. Stay within that sparse series — do not invent finer minute-level detail.
- If the context says SAMPLE DATA, remind him briefly that these are demo numbers, not his own.`;

const COLS = ['date', 'steps', 'active_minutes', 'calories', 'resting_hr', 'hrv', 'spo2_avg', 'breathing_rate', 'sleep_minutes', 'sleep_deep', 'sleep_rem', 'sleep_light', 'sleep_wake', 'sleep_score', 'readiness', 'bedtime', 'waketime'];

function buildContext(a, question) {
  if (a.empty) return 'No data loaded.';
  const lines = [];
  lines.push(a.isSample ? 'DATA SOURCE: SAMPLE DATA (synthetic demo numbers, NOT Vansh\'s real data).' : 'DATA SOURCE: Vansh\'s real Google Health / Fitbit export.');
  if (!a.isSample) { const hc = require('./sources/healthConnect').coachLine(); if (hc) lines.push(hc); }
  lines.push(`Date range: ${a.range[0]} to ${a.range[1]}. Today is ${todayLocal()} (IST). Step goal ${a.settings.stepGoal}, sleep goal ${fmtMin(a.settings.sleepGoalMinutes)}.`);
  lines.push('\nSUMMARY (latest / last-7-day avg / previous-7-day avg / 30-day avg):');
  for (const [k, s] of Object.entries(a.summary)) if (s.count) lines.push(`- ${s.label}: ${s.latest} (${s.latestDate}) / ${s.avg7} / ${s.prev7} / ${s.avg30} ${s.unit}`);
  if (a.consistency) lines.push(`- Sleep timing last 14 nights: avg bedtime ${a.consistency.avgBedtime}, avg wake ${a.consistency.avgWaketime}, bedtime SD ${a.consistency.sdBedMin} min, wake SD ${a.consistency.sdWakeMin} min, regularity score ${a.consistency.score}/100.`);
  lines.push(`- Avg sleep stages last 14 nights (min): deep ${a.stages.sleep_deep}, light ${a.stages.sleep_light}, REM ${a.stages.sleep_rem}, awake ${a.stages.sleep_wake}.`);
  { // Band-only measurements (Fitbit Air): all-day HR, AZM, wrist temperature, VO2 max. Listed per day when present.
    const band = a.rows.filter((r) => r.hr_avg != null || r.azm != null || r.vo2_max != null || r.skin_temp_c != null).slice(-14);
    if (band.length) {
      lines.push(`- Band days (Fitbit Air worn; daytime HR avg/min/max bpm, Active Zone Minutes, wrist skin temp °C, VO2 max estimate):`);
      for (const r of band) lines.push(`  ${r.date}: HR ${r.hr_avg ?? '-'}/${r.hr_min ?? '-'}/${r.hr_max ?? '-'}${r.hr_samples ? ` (${r.hr_samples} samples)` : ''}, AZM ${r.azm ?? '-'}, skin ${r.skin_temp_c ?? '-'}, VO2max ${r.vo2_max ?? '-'}`);
    }
    const lastSleep = [...a.rows].reverse().find((r) => r.sleep_minutes != null);
    if (lastSleep && lastSleep.date < a.rows[a.rows.length - 1].date) lines.push(`- No sleep tracked recently; last sleep record is ${lastSleep.date}. HRV, SpO2, breathing rate, sleep score and readiness are not in the data yet (band added ${band[0] ? band[0].date : 'recently'}).`);
  }
  lines.push(`- Step streaks: current ${a.streaks.current} days, longest ${a.streaks.longest}, goal hit ${a.streaks.hitLast30}/${a.streaks.daysLast30} of last 30 days.`);
  if (a.weekly.length) { lines.push('\nWEEKLY AVERAGES (week starting Mon): week, steps, active_min, sleep_min, resting_hr, hrv'); for (const w of a.weekly.slice(-12)) lines.push(`${w.week}, ${w.steps}, ${w.active_minutes}, ${w.sleep_minutes}, ${w.resting_hr}, ${w.hrv}`); }
  if (a.flags.length) { lines.push('\nNOTABLE DEVIATIONS FROM 30-DAY BASELINE:'); for (const f of a.flags.slice(-25)) lines.push(`- ${f.date}: ${f.text}`); }
  // Raw daily rows: last 45 days, plus any dates/months mentioned in the question.
  const want = new Set(a.rows.slice(-45).map((r) => r.date));
  const q = String(question || '');
  for (const m of q.matchAll(/(\d{4}-\d{2}-\d{2})/g)) for (const r of a.rows) if (Math.abs(Date.parse(r.date) - Date.parse(m[1])) <= 3 * 864e5) want.add(r.date);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  months.forEach((mo, i) => { if (new RegExp(`\\b${mo}`, 'i').test(q)) for (const r of a.rows) if (+r.date.slice(5, 7) === i + 1) want.add(r.date); });
  const rows = a.rows.filter((r) => want.has(r.date)).slice(-120);
  lines.push(`\nDAILY ROWS (${rows.length} days; sleep is the night ending that morning; times IST):`);
  lines.push(COLS.join(','));
  for (const r of rows) lines.push(COLS.map((c) => { const v = r[c]; if (v == null) return ''; if (c === 'bedtime' || c === 'waketime') return String(v).slice(11, 16); return v; }).join(','));
  // Compact through-the-day HR: prefer a date named in the question when present, else today.
  {
    const today = todayLocal();
    const mentioned = [...q.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
    let day = null, label = null;
    const load = (date) => {
      if (a.isSample) {
        const row = a.rows.find((r) => r.date === date);
        if (!row || row.resting_hr == null) return null;
        return intraday.sampleDay(date, row.resting_hr || 60);
      }
      return intraday.get(store.DATA_DIR, date);
    };
    for (const d of mentioned) { const got = load(d); if (got) { day = got; label = `INTRADAY HR (${d}, named in question)`; break; } }
    if (!day) { const got = load(today); if (got) { day = got; label = `INTRADAY HR TODAY (${today})`; } }
    if (!day) {
      if (a.isSample) {
        const latest = [...a.rows].reverse().find((r) => r.resting_hr != null);
        if (latest) { day = load(latest.date); if (day) label = `INTRADAY HR LATEST AVAILABLE (${latest.date}, today ${today} not present)`; }
      } else {
        const dates = intraday.list(store.DATA_DIR);
        const latest = dates.length ? dates[dates.length - 1] : null;
        if (latest) { day = load(latest); label = `INTRADAY HR LATEST AVAILABLE (${latest}, today ${today} not present)`; }
      }
    }
    if (day) {
      const block = intraday.formatCoachBlock(intraday.summarizeForCoach(day), { label });
      if (block) lines.push(block);
    }
  }
  return lines.join('\n');
}

async function ask(analytics, messages) {
  const { path, api } = activePath();
  if (!path) { const e = new Error('Coach not configured'); e.code = 'NOT_CONFIGURED'; throw e; }
  const history = messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const lastQ = [...history].reverse().find((m) => m.role === 'user')?.content || '';
  const context = buildContext(analytics, lastQ);
  const system = `${SYSTEM}\n\n=== HEALTH DATA CONTEXT ===\n${context}`;

  if (path === 'oauth') {
    return oauth.askViaProxy({ model: process.env.COACH_MODEL || oauth.DEFAULT_MODEL, system, history });
  }

  const p = api;
  const key = process.env[p.env];
  const url = typeof p.url === 'function' ? p.url() : p.url;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    let res, data;
    if (p.style === 'anthropic') {
      res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: p.model, max_tokens: 900, system, messages: history }) });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`LLM error ${res.status}: ${data?.error?.message || 'request failed'}`);
      return { answer: (data.content || []).map((c) => c.text || '').join('').trim(), provider: p.id, model: p.model };
    }
    res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model: p.model, temperature: 0.4, max_tokens: 900, messages: [{ role: 'system', content: system }, ...history] }) });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`LLM error ${res.status}: ${data?.error?.message || 'request failed'}`);
    return { answer: (data.choices?.[0]?.message?.content || '').trim(), provider: p.id, model: p.model };
  } finally { clearTimeout(t); }
}

module.exports = { status, ask, buildContext, activePath, pickApi };
