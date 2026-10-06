/* Air Health — single-page dashboard (vanilla JS + Chart.js). v2 visual design. */
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
let D = null; // dashboard payload
let charts = [];
let range = +(localStorage.getItem('range') || 30);
let firstPaint = true;   // the one orchestrated entrance happens only on first load
let animMode = 'page';   // 'page' | 'range' — how long chart draw-in runs
const chat = JSON.parse(sessionStorage.getItem('chat') || '[]');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const C = () => ({ sleep: css('--sleep'), sleepLight: css('--sleep-light'), rem: css('--rem'), wake: css('--wake'), heart: css('--heart'), hrv: css('--hrv'), steps: css('--steps'), recov: css('--recov'), goal: css('--goal'), ink: css('--paper'), ground: css('--ink'), ink2: css('--ink-2'), ink3: css('--ink-3'), rule: css('--rule'), sheet: css('--sheet'), tipBg: css('--tip-bg'), tipInk: css('--tip-ink'), pos: css('--pos'), neg: css('--neg') });
const alpha = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const NF = {}; const nf = (d) => (NF[d] ||= new Intl.NumberFormat('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : nf(d).format(v));
const compact = (v) => (Math.abs(v) >= 1000 ? `${nf(1).format(v / 1000)}k` : nf(0).format(v));
const hm = (m) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);
const hmSpaced = (m) => (m == null ? '—' : `${Math.floor(m / 60)}\u202fh ${String(Math.round(m % 60)).padStart(2, '0')}\u202fm`);
const clock = (v) => { if (v == null) return '—'; const t = Math.round(v + 720) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dd = (d) => new Date(d + 'T00:00:00Z');
const dShort = (d) => { const x = dd(d); return `${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; };
const dLong = (d) => { const x = dd(d); return `${DOW[x.getUTCDay()]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; };
const dFull = (d) => { const x = dd(d); return `${DOWL[x.getUTCDay()]} ${x.getUTCDate()} ${MONL[x.getUTCMonth()]}`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Safe markdown for coach replies (escape via marked + DOMPurify; never trust model HTML).
(function initMd() {
  try {
    if (typeof marked !== 'undefined') {
      if (marked.setOptions) marked.setOptions({ gfm: true, breaks: true });
      else if (marked.use) marked.use({ gfm: true, breaks: true });
    }
    if (typeof DOMPurify !== 'undefined' && !DOMPurify.__airHealthHook) {
      DOMPurify.__airHealthHook = true;
      DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        if (node.tagName !== 'A') return;
        const href = node.getAttribute('href') || '';
        if (!/^(https?:|mailto:)/i.test(href)) node.removeAttribute('href');
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      });
    }
  } catch (_) { /* libs optional at parse time */ }
})();
const mdHtml = (s) => {
  const text = String(s ?? '');
  try {
    let html;
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      html = marked.parse(text, { async: false });
    } else {
      html = esc(text).replace(/\n/g, '<br>');
    }
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'hr', 'span'],
        ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class'],
        ALLOW_DATA_ATTR: false,
      });
    }
    return esc(text).replace(/\n/g, '<br>');
  } catch (_) {
    return esc(text).replace(/\n/g, '<br>');
  }
};

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
  return r;
}
async function load() { D = await (await api('/api/dashboard')).json(); }

// ---------------- charts ----------------
// Vertical hover guide: a hairline at the active x position.
const guide = { id: 'guide', afterDatasetsDraw(ch) {
  const a = ch.tooltip && ch.tooltip.getActiveElements && ch.tooltip.getActiveElements();
  if (!a || !a.length || ch.config.type === 'doughnut') return;
  const x = a[0].element.x; const { top, bottom } = ch.chartArea; const g = ch.ctx;
  g.save(); g.strokeStyle = alpha(C().ink, 0.22); g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, top); g.lineTo(Math.round(x) + 0.5, bottom); g.stroke(); g.restore();
} };
let chartDefaultsSet = false;
function setChartDefaults() {
  const c = C(); const d = Chart.defaults;
  d.font.family = '"Schibsted Grotesk","Avenir Next",system-ui,sans-serif'; d.font.size = 11.5; d.color = c.ink3; d.borderColor = alpha(c.ink, 0.07);
  d.elements.line.borderWidth = 2; d.elements.line.borderCapStyle = 'round'; d.elements.line.borderJoinStyle = 'round';
  d.elements.point.radius = 0; d.elements.point.hoverRadius = 4; d.elements.point.hoverBorderWidth = 2; d.elements.point.hoverBorderColor = c.sheet;
  d.elements.bar.borderRadius = 3; d.elements.bar.borderSkipped = 'start';
  d.datasets.bar.categoryPercentage = 0.78; d.datasets.bar.barPercentage = 0.92;
  const t = d.plugins.tooltip;
  Object.assign(t, { backgroundColor: c.tipBg, titleColor: c.tipInk, bodyColor: c.tipInk, padding: { x: 11, y: 9 }, cornerRadius: 8, caretSize: 0, caretPadding: 10,
    titleFont: { weight: '600', size: 12 }, bodyFont: { size: 12 }, titleMarginBottom: 6, bodySpacing: 4, boxWidth: 8, boxHeight: 8, boxPadding: 5, usePointStyle: true, multiKeyBackground: 'transparent' });
  t.animation = { duration: 120 };
  d.plugins.legend.display = false;
  chartDefaultsSet = true;
}
const xScale = (extra = {}) => ({ grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0, autoSkipPadding: 14, padding: 6 }, ...extra });
const yScale = (extra = {}) => { const { ticks, grid, ...rest } = extra; return { border: { display: false }, grid: { color: alpha(C().ink, 0.07), drawTicks: false, ...(grid || {}) }, ticks: { padding: 8, maxTicksLimit: 5, ...(ticks || {}) }, ...rest }; };
function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }
// Reference lines (goal, usual range) don't count as data: a panel with only those shows a quiet empty state.
const AUX = new Set(['Goal', 'Usual high', 'Usual low']);
const hasValue = (v) => (Array.isArray(v) ? v.some(hasValue) : v && typeof v === 'object' ? hasValue(v.y) : v != null && Number.isFinite(+v) && v !== '');
function hasChartData(cfg) {
  const ds = (cfg.data && cfg.data.datasets) || [];
  return ds.some((d) => !AUX.has(d.label) && !d._aux && (d.data || []).some((v) => hasValue(v) && (cfg.type !== 'doughnut' || +v > 0)));
}
function pointCount(cfg) { const ds = ((cfg.data && cfg.data.datasets) || []).filter((d) => !AUX.has(d.label) && !d._aux); return Math.max(0, ...ds.map((d) => (d.data || []).filter(hasValue).length)); }
function emptyChart(el, text) {
  const box = el.closest('.chart, .ring') || el.parentElement;
  box.classList.add('is-empty');
  const card = box.closest('.card');
  if (card) card.querySelectorAll('.legend').forEach((l) => { l.hidden = true; if (l.parentElement !== card && !l.parentElement.matches('h3')) l.parentElement.hidden = true; });
  box.innerHTML = `<p class="nodata">${esc(text || 'No data yet')}</p>`;
}
function chart(id, cfg) {
  const el = document.getElementById(id); if (!el) return;
  if (!hasChartData(cfg)) { emptyChart(el, cfg._empty); return; }
  if (cfg.type === 'line' && pointCount(cfg) < 2) { emptyChart(el, 'One reading so far. The trend appears after a few more days.'); return; }
  if (!chartDefaultsSet) setChartDefaults();
  const o = cfg.options || {};
  const duration = reduceMotion() ? 0 : animMode === 'range' ? 180 : 320;
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, animation: { duration, easing: 'easeOutQuart' }, layout: { padding: { top: 4 } } }, o,
    { plugins: Object.assign({ legend: { display: false } }, o.plugins || {}) });
  cfg.options.plugins.tooltip = Object.assign({ callbacks: {} }, cfg.options.plugins.tooltip || {});
  const solid = (it) => { const ds = it.dataset; if (ds._tip) return ds._tip; if (ds.type === 'line' || cfg.type === 'line') return ds.borderColor; return Array.isArray(ds.backgroundColor) ? ds.backgroundColor[it.dataIndex] : ds.backgroundColor; };
  cfg.options.plugins.tooltip.callbacks = Object.assign({ labelColor: (it) => ({ borderColor: 'transparent', backgroundColor: solid(it), borderWidth: 0, borderRadius: 4 }), title: (items) => (items[0] && items[0].dataIndex != null && cfg._dates ? dLong(cfg._dates[items[0].dataIndex]) : items[0]?.label) }, cfg.options.plugins.tooltip.callbacks);
  cfg.plugins = [...(cfg._noGuide ? [] : [guide]), ...(cfg.plugins || [])];
  charts.push(new Chart(el, cfg));
}
const rows = () => (range ? D.rows.slice(-range) : D.rows);
const labels = (rs) => rs.map((r) => dShort(r.date));
const dates = (rs) => rs.map((r) => r.date);
const legend = (items) => `<span class="legend">${items.map(([kind, color, text]) => `<span><i class="${kind}" style="${kind === 'dash' ? `color:${color}` : `background:${color}`}"></i>${text}</span>`).join('')}</span>`;

// ---------------- shared bits ----------------
function banner() {
  if (!D || !D.isSample) return '';
  return `<div class="banner" role="note"><p><b>You’re looking at sample data.</b> These numbers are generated for the demo. Upload your Google Health export to see your own.</p><a class="btn ghost" href="#/data">Upload export</a></div>`;
}
function srcPill() {
  const html = D.isSample ? '<div class="srcline"><i></i><span>Sample data</span></div>'
    : `<div class="srcline real"><i></i><span>Your data<small>${dShort(D.range[0])} – ${dShort(D.range[1])}</small></span></div>`;
  $('#srcpill').innerHTML = html; const t = $('#srcpillTop'); if (t) t.innerHTML = html;
}
function rangeSeg() {
  const opts = [[14, '14d'], [30, '30d'], [60, '60d'], [90, '90d'], [0, 'All']];
  return `<div class="seg" id="rangeSeg" role="group" aria-label="Date range"><span class="seg-thumb" aria-hidden="true"></span>${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === range}" class="${v === range ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function placeThumb(seg, fromX) {
  const th = seg.querySelector('.seg-thumb'); const on = seg.querySelector('button.on'); if (!th || !on) return;
  th.style.width = on.offsetWidth + 'px'; const x = on.offsetLeft - 3; th.style.transform = `translateX(${x}px)`;
  if (fromX != null && fromX !== x && !reduceMotion()) th.animate([{ transform: `translateX(${fromX}px)` }, { transform: `translateX(${x}px)` }], { duration: 200, easing: 'cubic-bezier(.23,1,.32,1)' });
}
function bindRange() {
  const s = $('#rangeSeg'); if (!s) return; placeThumb(s);
  s.onclick = (e) => {
    const b = e.target.closest('button'); if (!b || +b.dataset.v === range) return;
    const th = s.querySelector('.seg-thumb'); const fromX = th ? new DOMMatrix(getComputedStyle(th).transform).m41 : null;
    range = +b.dataset.v; localStorage.setItem('range', range); animMode = 'range'; render({ keepScroll: true });
    const ns = $('#rangeSeg'); if (ns) placeThumb(ns, fromX);
  };
}
// Quiet week-over-week delta (Fathom-calm). goodUp colours only; arrow carries direction.
function delta(cur, prev, unit = '', goodUp = true, d = 0) {
  if (cur == null || prev == null) return '';
  const diff = cur - prev; const flat = Math.abs(diff) < 1e-9 || fmt(Math.abs(diff), d) === '0';
  if (flat) return '<span class="d-flat">Steady</span><span class="d-vs"> week</span>';
  const up = diff > 0; const good = up === goodUp;
  return `<span class="${up ? 'd-up' : 'd-down'} ${good ? 'good' : 'bad'}">${up ? '↑' : '↓'} ${fmt(Math.abs(diff), d)}${unit}</span><span class="d-vs"> week</span>`;
}
function spark(values, color, { goal } = {}) {
  const v = values.map((x) => (x == null ? null : +x)); const nums = v.filter((x) => x != null);
  if (nums.length < 2) return '';
  let lo = Math.min(...nums), hi = Math.max(...nums); if (goal != null) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
  const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
  const W = 100, H = 28; const X = (i) => (i / (v.length - 1)) * W; const Y = (x) => H - ((x - lo) / (hi - lo)) * H;
  let dPath = ''; let pen = false; v.forEach((x, i) => { if (x == null) { pen = false; return; } dPath += `${pen ? 'L' : 'M'}${X(i).toFixed(2)} ${Y(x).toFixed(2)} `; pen = true; });
  const li = v.length - 1 - [...v].reverse().findIndex((x) => x != null);
  const g = goal != null ? `<line x1="0" x2="${W}" y1="${Y(goal).toFixed(2)}" y2="${Y(goal).toFixed(2)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" style="color:${C().ink3}">${g}<path d="${dPath}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="M${X(li).toFixed(2)} ${Y(v[li]).toFixed(2)}h0" stroke="${color}" stroke-width="5.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function readout(label, color, val, unit, sub, sparkline = '') {
  return `<div class="ro"><div class="label"><i style="background:${color}"></i>${label}</div><div class="val">${val}${unit ? `<small>${unit}</small>` : ''}</div><div class="sub">${sub || ''}</div>${sparkline}</div>`;
}
const last = (k) => [...D.rows].reverse().find((r) => r[k] != null);
const tail = (k, n = 14) => D.rows.slice(-n).map((r) => r[k]);
function greet() { const h = +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }
const metricColor = (m) => ({ resting_hr: C().heart, hrv: C().hrv, sleep_minutes: C().sleep, steps: C().steps, recovery: C().recov, readiness: C().recov }[m] || C().ink3);
function flagList(list, emptyText) {
  if (!list.length) return `<p class="calm">${emptyText}</p>`;
  return `<ul class="flags">${list.map((f) => `<li><span class="d">${dShort(f.date)}</span><span class="ft">${esc(f.text)}</span></li>`).join('')}</ul>`;
}

// ---------------- pages ----------------
function lede(ls, rec, s) {
  const parts = [];
  if (ls) parts.push(`You slept <span class="n" style="color:var(--sleep)">${hmSpaced(ls.sleep_minutes)}</span>${ls.wake_clock != null ? ` and woke at <span class="n">${clock(ls.wake_clock)}</span>` : ''}.`);
  if (rec) parts.push(`${rec.recovery_src === 'readiness' ? 'Readiness' : 'Estimated recovery'} is <span class="n" style="color:var(--recov)">${rec.recovery}</span>${rec.readiness_state ? `, ${esc(rec.readiness_state)}` : ''}.`);
  const rhr = s.resting_hr; const hrv = s.hrv;
  if (rhr.latest != null && rhr.avg30 != null && rhr.count < 7) {
    parts.push(`<span class="q">Resting heart rate is <span class="n" style="color:var(--heart)">${fmt(rhr.latest, 0)}</span> bpm. Your usual range needs about a week of nights with the band on.</span>`);
  } else if (rhr.latest != null && rhr.avg30 != null) {
    const dv = rhr.latest - rhr.avg30;
    parts.push(`<span class="q">Resting heart rate is ${Math.abs(dv) < 1 ? 'right at' : dv > 0 ? `${fmt(Math.abs(dv), 0)} above` : `${fmt(Math.abs(dv), 0)} below`} your usual${hrv.latest != null ? `, HRV ${hrv.avg30 != null && Math.abs(hrv.latest - hrv.avg30) >= 3 ? (hrv.latest > hrv.avg30 ? 'a little higher than normal' : 'a little lower than normal') : 'steady'}` : ''}.</span>`);
  }
  if (!ls) parts.unshift('No sleep recorded last night. Wear the band to bed to see sleep and recovery here.');
  return parts.join(' ');
}
// ---------------- Today (day-scoped, Fathom-like) ----------------
function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDayISO(iso, n) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function rowOn(date) { return D.rows.find((r) => r.date === date) || null; }
/** Calendar today in IST when present in the series; otherwise the latest day with data. */
function resolveToday() {
  const t = todayIST();
  if (rowOn(t) || (D.range && t >= D.range[0] && t <= D.range[1])) return { date: t, row: rowOn(t) || { date: t }, isCalendar: true };
  const last = D.rows[D.rows.length - 1];
  return { date: last ? last.date : t, row: last || { date: t }, isCalendar: false };
}
/** Sleep ending this morning: prefer today's sleep row, else yesterday if recent. */
function sleepForToday(date) {
  const today = rowOn(date);
  if (today && today.sleep_minutes != null) return today;
  const y = rowOn(addDayISO(date, -1));
  if (!y || y.sleep_minutes == null) return null;
  const age = (Date.parse(date) - Date.parse(y.date)) / 864e5;
  return age <= 1.5 ? y : null;
}
function chip(label, value, detail) {
  return `<li title="${esc(detail || '')}"><span>${esc(label)}</span><strong>${value}</strong></li>`;
}
function markbar(pct) {
  const w = Math.max(0, Math.min(100, pct || 0));
  return `<div class="markbar" aria-hidden="true"><span style="width:${w.toFixed(1)}%"></span></div>`;
}
function mixBar(parts) {
  const total = parts.reduce((s, p) => s + (p.value || 0), 0);
  if (!total) return `<figure class="mix empty-mix"><div></div><figcaption>No activity minutes yet today.</figcaption></figure>`;
  const segs = parts.filter((p) => p.value > 0).map((p) => `<i class="${p.tone}" style="width:${((p.value / total) * 100).toFixed(2)}%" title="${esc(p.label)} ${fmt(p.value)} min"></i>`).join('');
  const cap = parts.filter((p) => p.value > 0).map((p) => `<span><b class="${p.tone}"></b>${esc(p.label)} ${fmt(p.value)}m</span>`).join('');
  return `<figure class="mix"><div>${segs}</div><figcaption>${cap}</figcaption></figure>`;
}
function pageToday() {
  const c = C();
  const { date, row, isCalendar } = resolveToday();
  const goal = D.settings.stepGoal || 10000;
  const sleep = sleepForToday(date);
  const steps = row.steps != null ? row.steps : null;
  const chips = [];
  const missing = [];
  const push = (label, ok, value, detail) => { if (ok) chips.push(chip(label, value, detail)); else missing.push(label); };

  push('Sleep last night', sleep && sleep.sleep_minutes != null, sleep ? hm(sleep.sleep_minutes) : '—',
    sleep && sleep.sleep_score != null ? `Sleep score ${sleep.sleep_score}` : (sleep && sleep.date !== date ? `Logged ${dShort(sleep.date)}` : 'Asleep last night'));
  const rec = (row.recovery != null ? row : null) || (sleep && sleep.recovery != null ? sleep : null);
  const recLabel = rec && rec.recovery_src === 'readiness' ? 'Readiness' : 'Recovery';
  push(recLabel, rec && rec.recovery != null, rec ? String(rec.recovery) : '—',
    rec && rec.readiness_state ? rec.readiness_state : (rec && rec.recovery_src === 'readiness' ? 'Daily readiness' : 'From HRV, resting HR and sleep'));
  push('Steps', steps != null, fmt(steps), steps != null ? `${Math.round((steps / goal) * 100)}% of ${fmt(goal)}` : 'No steps yet');
  push('Distance', row.distance_km != null, `${fmt(row.distance_km, 2)} km`, 'Today');
  push('Calories', row.calories != null, fmt(row.calories), 'kcal');
  push('Active minutes', row.active_minutes != null, fmt(row.active_minutes), 'Fairly + very active');
  push('Zone minutes', row.azm != null, fmt(row.azm), 'Active zone minutes');
  push('Resting heart rate', row.resting_hr != null, `${fmt(row.resting_hr, 1)} bpm`, 'From the band');
  const hrv = row.hrv != null ? row : (sleep && sleep.hrv != null ? sleep : null);
  push('HRV', hrv && hrv.hrv != null, `${fmt(hrv && hrv.hrv, 1)} ms`, 'RMSSD during sleep');
  const spo2 = row.spo2_avg != null ? row : (sleep && sleep.spo2_avg != null ? sleep : null);
  push('Blood oxygen', spo2 && spo2.spo2_avg != null, `${fmt(spo2 && spo2.spo2_avg, 1)}%`, 'Overnight average');
  const br = row.breathing_rate != null ? row : (sleep && sleep.breathing_rate != null ? sleep : null);
  push('Breathing rate', br && br.breathing_rate != null, `${fmt(br && br.breathing_rate, 1)} /min`, 'During sleep');
  push('Skin temperature', row.skin_temp_c != null, `${fmt(row.skin_temp_c, 1)}°C`, 'Wrist / skin, not core');
  push('VO₂ max', row.vo2_max != null, fmt(row.vo2_max, 1), 'Demographic estimate');
  if (row.light_minutes != null) push('Lightly active', true, `${fmt(row.light_minutes)} min`, 'Today');
  if (row.fairly_active_minutes != null) push('Fairly active', true, `${fmt(row.fairly_active_minutes)} min`, 'Today');
  if (row.very_active_minutes != null) push('Very active', true, `${fmt(row.very_active_minutes)} min`, 'Today');
  if (row.sedentary_minutes != null) push('Sedentary', true, `${fmt(row.sedentary_minutes)} min`, 'Today');

  const haveAny = chips.length > 0 || (steps != null);
  const ledeBits = [];
  if (steps != null) ledeBits.push(`<span class="n" style="color:var(--steps)">${fmt(steps)}</span> steps so far`);
  if (sleep && sleep.sleep_minutes != null) ledeBits.push(`slept <span class="n" style="color:var(--sleep)">${hmSpaced(sleep.sleep_minutes)}</span> last night`);
  if (rec && rec.recovery != null) ledeBits.push(`${recLabel.toLowerCase()} <span class="n" style="color:var(--recov)">${rec.recovery}</span>`);
  const ledeText = ledeBits.length
    ? ledeBits.join('. ') + '.'
    : (isCalendar
      ? 'Little on the band for today yet. Wear it and sync — slots stay ready below.'
      : `Showing the latest day in your data (${dFull(date)}). Sync the band for calendar today.`);

  view.innerHTML = `${banner()}
  <header class="page dayhead"><div>
    <p class="dateline">${isCalendar ? 'Today · Asia/Kolkata' : 'Latest day · Asia/Kolkata'}</p>
    <h1>${dFull(date)}</h1>
    <p class="lede today-lede">${ledeText}</p>
  </div></header>
  ${intradayCard({ locked: true })}
  <section class="today-activity" aria-label="Steps and activity">
    <div class="goal-row">
      <div class="goal-meta"><span class="goal-label">Step mark</span><strong>${steps != null ? fmt(steps) : '—'}</strong><span class="goal-of">of ${fmt(goal)}</span></div>
      ${markbar(steps != null ? (steps / goal) * 100 : 0)}
    </div>
    ${mixBar([
      { label: 'Light', value: row.light_minutes || 0, tone: 'light' },
      { label: 'Fair', value: row.fairly_active_minutes || 0, tone: 'fair' },
      { label: 'Very', value: row.very_active_minutes || 0, tone: 'very' },
      { label: 'Still', value: row.sedentary_minutes || 0, tone: 'still' },
    ])}
  </section>
  <section class="today-board" aria-label="Today’s readings">
    <h2 class="section-label">Readings</h2>
    ${chips.length ? `<ul class="signal-chips">${chips.join('')}</ul>` : `<p class="calm">No readings for this day yet.</p>`}
    <p class="missing">${missing.length ? missing.join(' · ') : (haveAny ? 'Every signal available for this day has a row.' : 'Wear the band today to fill sleep, heart and activity.')}</p>
  </section>`;
  initIntraday({ locked: true, date });
}

function pageOverview() {
  const s = D.summary; const lsAny = last('sleep_minutes'); const rec = last('recovery');
  // "Last night" only if the newest sleep is from the last day or two; an old manual log must not read as last night.
  const recent = (r) => r && (Date.parse(D.range[1]) - Date.parse(r.date)) / 864e5 <= 1;
  const ls = recent(lsAny) ? lsAny : null;
  const recLabel = rec ? (rec.recovery_src === 'readiness' ? 'Daily Readiness' : 'Recovery (estimate)') : 'Recovery';
  const c = C();
  view.innerHTML = `${banner()}
  <header class="page"><div><p class="dateline">Latest data ${dFull(D.range[1])}</p><h1>Good ${greet()}, Vansh</h1></div>${rangeSeg()}</header>
  <section class="report-sheet" aria-label="Last night">
    <p class="lede">${lede(ls, rec, s)}</p>
    <div class="readouts">
      ${readout('Sleep last night', c.sleep, ls ? hm(ls.sleep_minutes) : '—', '', ls && ls.sleep_score != null ? `Sleep score <b>${ls.sleep_score}</b>` : ls ? delta(s.sleep_minutes.avg7, s.sleep_minutes.prev7, ' min', true) : lsAny ? `Last sleep logged ${dShort(lsAny.date)}` : 'Wear the band to bed to track sleep', spark(tail('sleep_minutes'), c.sleep))}
      ${readout(recLabel, c.recov, rec ? rec.recovery : '—', 'of 100', rec && rec.readiness_state ? `State <b>${esc(rec.readiness_state)}</b>` : rec ? 'From HRV, resting HR and sleep' : '', spark(tail('recovery'), c.recov))}
      ${readout('Steps, 7-day average', c.steps, fmt(s.steps.avg7), '', delta(s.steps.avg7, s.steps.prev7, '', true), spark(tail('steps'), c.steps, { goal: D.settings.stepGoal }))}
      ${readout('Resting heart rate', c.heart, fmt(s.resting_hr.latest, 1), 'bpm', delta(s.resting_hr.avg7, s.resting_hr.prev7, ' bpm', false, 1), spark(tail('resting_hr'), c.heart))}
      ${readout('Heart-rate variability', c.hrv, fmt(s.hrv.latest, 1), 'ms', delta(s.hrv.avg7, s.hrv.prev7, ' ms', true, 1), spark(tail('hrv'), c.hrv))}
    </div>
  </section>
  <div class="grid split">
    <div class="card"><h3>Recovery and sleep ${legend([['ln', c.recov, recLabel], ['', alpha(c.sleep, 0.35), 'Hours asleep']])}</h3><div class="chart"><canvas id="c1"></canvas></div></div>
    <div class="card"><h3>Worth a look</h3>
      <p class="note worth-lead">Against your own 30-day baseline</p>
      ${flagList(D.recentFlags.slice(-6).reverse(), 'Nothing standing out in the last 14 days.')}
      <p class="note">Observations from your recent history — not medical advice.</p></div>
    <div class="card"><h3>Steps ${legend([['', c.steps, `Goal met (${fmt(D.settings.stepGoal)})`], ['', alpha(c.steps, 0.35), 'Under goal'], ['ln', c.ink, '7-day average']])}</h3><div class="chart"><canvas id="c2"></canvas></div></div>
    <div class="card"><h3>Resting heart rate and HRV <small>7-day averages</small></h3><div class="chart"><canvas id="c3"></canvas></div><div style="margin-top:10px">${legend([['ln', c.heart, 'Resting HR (bpm, left)'], ['ln', c.hrv, 'HRV (ms, right)']])}</div></div>
  </div>`;
  const rs = rows();
  chart('c1', { _dates: dates(rs), type: 'bar', data: { labels: labels(rs), datasets: [
    { type: 'line', label: recLabel, data: rs.map((r) => r.recovery), borderColor: c.recov, backgroundColor: c.recov, tension: 0.35, yAxisID: 'y', borderWidth: 2.25, order: 0 },
    { label: 'Asleep', data: rs.map((r) => (r.sleep_minutes != null ? +(r.sleep_minutes / 60).toFixed(2) : null)), _tip: c.sleepLight, backgroundColor: alpha(c.sleep, 0.28), hoverBackgroundColor: alpha(c.sleep, 0.5), yAxisID: 'y1', order: 1 }] },
    options: { plugins: { tooltip: { callbacks: { label: (x) => (x.dataset.yAxisID === 'y1' ? ` Asleep ${hm(x.raw * 60)}` : ` ${x.dataset.label} ${x.raw ?? '—'}`) } } },
      scales: { y: yScale({ min: 0, max: 100, ticks: { stepSize: 25 } }), y1: yScale({ position: 'right', min: 0, max: 12, grid: { display: false }, ticks: { stepSize: 3, callback: (v) => `${v}h` } }), x: xScale() } } });
  stepsChart('c2', rs);
  chart('c3', { _empty: s.resting_hr.count ? 'Needs a few more days of band data' : 'No data yet', _dates: dates(rs), type: 'line', data: { labels: labels(rs), datasets: [
    { label: 'Resting HR', data: rs.map((r) => r.resting_hr_avg7), borderColor: c.heart, backgroundColor: c.heart, tension: 0.35, yAxisID: 'y', borderWidth: 2.25 },
    { label: 'HRV', data: rs.map((r) => r.hrv_avg7), borderColor: c.hrv, backgroundColor: c.hrv, tension: 0.35, yAxisID: 'y1', borderWidth: 2.25 }] },
    options: { plugins: { tooltip: { callbacks: { label: (x) => ` ${x.dataset.label} ${fmt(x.raw, 1)} ${x.datasetIndex ? 'ms' : 'bpm'}` } } },
      scales: { y: yScale({ grace: '8%', ticks: { callback: (v) => fmt(v, 0) } }), y1: yScale({ position: 'right', grace: '8%', grid: { display: false }, ticks: { callback: (v) => fmt(v, 0) } }), x: xScale() } } });
}
function stepsChart(id, rs) {
  const c = C(); const goal = D.settings.stepGoal;
  chart(id, { _dates: dates(rs), type: 'bar', data: { labels: labels(rs), datasets: [
    { type: 'line', label: '7-day avg', data: rs.map((r) => r.steps_avg7), borderColor: c.ink, backgroundColor: c.ink, borderWidth: 1.75, tension: 0.35, order: 0 },
    { type: 'line', label: 'Goal', data: rs.map(() => goal), borderColor: alpha(c.goal, 0.45), borderDash: [3, 4], borderWidth: 1.25, pointHoverRadius: 0, order: 1 },
    { label: 'Steps', _tip: c.steps, data: rs.map((r) => r.steps), backgroundColor: rs.map((r) => (r.steps >= goal ? c.steps : alpha(c.steps, 0.32))), hoverBackgroundColor: rs.map((r) => (r.steps >= goal ? c.steps : alpha(c.steps, 0.55))), order: 2 }] },
    options: { plugins: { tooltip: { filter: (x) => x.dataset.label !== 'Goal', callbacks: { label: (x) => ` ${x.dataset.label} ${fmt(x.raw)}` } } },
      scales: { x: xScale(), y: yScale({ beginAtZero: true, ticks: { callback: (v) => compact(v) } }) } } });
}

function pageSleep() {
  const rs = rows(); const s = D.summary; const cons = D.consistency; const st = D.stages; const hasStages = D.available.sleep_deep;
  const tot = (st.sleep_deep || 0) + (st.sleep_light || 0) + (st.sleep_rem || 0) || 1;
  const rec = last('recovery'); const c = C();
  const nights = D.rows.slice(-14).filter((r) => r.sleep_minutes != null).reverse(); const lastNight = last('sleep_minutes');
  const recName = rec && rec.recovery_src === 'readiness' ? 'Daily Readiness' : 'Recovery (estimate)';
  view.innerHTML = `${banner()}
  <header class="page"><div><h1>Sleep and recovery</h1><p>Duration, stages, timing and readiness</p></div>${rangeSeg()}</header>
  <section class="report-sheet"><div class="readouts r4" style="border-top:0;padding-top:0">
    ${readout('Average sleep, 7 days', c.sleep, hm(s.sleep_minutes.avg7), '', delta(s.sleep_minutes.avg7, s.sleep_minutes.prev7, ' min', true), spark(tail('sleep_minutes', 30), c.sleep))}
    ${readout('Sleep score, 7 days', c.sleepLight, fmt(s.sleep_score.avg7), D.available.sleep_score ? 'of 100' : '', D.available.sleep_score ? delta(s.sleep_score.avg7, s.sleep_score.prev7, '', true) : 'Not in this data', D.available.sleep_score ? spark(tail('sleep_score', 30), c.sleepLight) : '')}
    ${readout('Bed and wake, 14-day average', c.ink3, cons ? `${cons.avgBedtime}<small>to</small> ${cons.avgWaketime}` : '—', '', cons ? `Regularity <b>${cons.score}</b> of 100, bedtime ±${cons.sdBedMin} min` : '')}
    ${readout(rec && rec.recovery_src === 'readiness' ? 'Readiness today' : 'Recovery (estimate)', c.recov, rec ? rec.recovery : '—', 'of 100', rec ? (rec.readiness_state ? `State <b>${esc(rec.readiness_state)}</b>` : 'HRV, resting HR and sleep against baseline') : '', spark(tail('recovery', 30), c.recov))}
  </div></section>
  <div class="grid g2">
    <div class="card full"><h3>${hasStages ? 'Sleep stages per night' : 'Sleep duration'} ${hasStages ? legend([['', c.sleep, 'Deep'], ['', c.sleepLight, 'Light'], ['', c.rem, 'REM'], ['', c.wake, 'Awake'], ['dash', c.goal, 'Goal']]) : ''}</h3><div class="chart lg"><canvas id="s1"></canvas></div></div>
    <div class="card"><h3>Bed and wake times <small>Each bar is time in bed</small></h3><div class="chart"><canvas id="s2"></canvas></div><p class="note">Keeping bedtime within about 30 minutes night to night tends to help sleep quality.</p></div>
    <div class="card"><h3>${recName} <small>${D.available.readiness ? 'From Google Health' : 'Computed here, not a Fitbit score'}</small></h3><div class="chart"><canvas id="s3"></canvas></div><div style="margin-top:10px">${legend([['', c.recov, '70 and up'], ['', alpha(c.recov, 0.55), '45–69'], ['', alpha(c.recov, 0.25), 'Under 45']])}</div></div>
    <div class="card"><h3>Stage mix <small>Average of the last 14 nights</small></h3>${hasStages ? `<div class="ring"><canvas id="s4"></canvas><dl>
      <dt><i style="background:${c.sleep}"></i>Deep</dt><dd>${hm(st.sleep_deep)}</dd><dd class="p">${Math.round(st.sleep_deep / tot * 100)}%</dd>
      <dt><i style="background:${c.sleepLight}"></i>Light</dt><dd>${hm(st.sleep_light)}</dd><dd class="p">${Math.round(st.sleep_light / tot * 100)}%</dd>
      <dt><i style="background:${c.rem}"></i>REM</dt><dd>${hm(st.sleep_rem)}</dd><dd class="p">${Math.round(st.sleep_rem / tot * 100)}%</dd>
      <dt><i style="background:${c.wake}"></i>Awake</dt><dd>${hm(st.sleep_wake)}</dd><dd class="p"></dd></dl></div>
      <p class="note">Typical adult ranges are roughly 10–25% deep and 15–25% REM. Night-to-night variation is normal.</p>` : '<p class="calm">No stage data in this dataset.</p>'}</div>
    <div class="card"><h3>Sleep score ${D.available.sleep_score ? legend([['ln', c.sleep, 'Nightly'], ['ln', c.ink, '7-day average']]) : ''}</h3>${D.available.sleep_score ? '<div class="chart sm"><canvas id="s5"></canvas></div>' : '<p class="calm">Sleep score is not in this data.</p>'}</div>
    <div class="card full"><h3>Recent nights</h3>${nights.length ? `<div class="tablewrap"><table><thead><tr><th>Night ending</th><th class="num">Bed</th><th class="num">Wake</th><th class="num">Asleep</th><th class="num">Deep</th><th class="num">REM</th><th class="num">Awake</th><th class="num">Score</th><th class="num">Readiness</th></tr></thead><tbody>
      ${nights.map((r) => `<tr><td>${dLong(r.date)}</td><td class="num">${clock(r.bed_clock)}</td><td class="num">${clock(r.wake_clock)}</td><td class="num">${hm(r.sleep_minutes)}</td><td class="num">${r.sleep_deep != null ? r.sleep_deep + ' min' : '—'}</td><td class="num">${r.sleep_rem != null ? r.sleep_rem + ' min' : '—'}</td><td class="num">${r.sleep_wake != null ? r.sleep_wake + ' min' : '—'}</td><td class="num">${r.sleep_score ?? '—'}</td><td class="num">${r.readiness ?? '—'}</td></tr>`).join('')}</tbody></table></div>` : `<p class="calm">No nights tracked in the last two weeks.${lastNight ? ` The last sleep on record ends ${dLong(lastNight.date)}.` : ''} Wear the band to bed to fill this in.</p>`}</div>
  </div>`;
  const h = (k) => rs.map((r) => (r[k] != null ? +(r[k] / 60).toFixed(2) : null));
  chart('s1', { _dates: dates(rs), type: 'bar', data: { labels: labels(rs), datasets: hasStages ? [
    { label: 'Deep', data: h('sleep_deep'), backgroundColor: c.sleep, stack: 's', borderRadius: 0 }, { label: 'Light', data: h('sleep_light'), backgroundColor: c.sleepLight, stack: 's', borderRadius: 0 },
    { label: 'REM', data: h('sleep_rem'), backgroundColor: c.rem, stack: 's', borderRadius: 0 }, { label: 'Awake', data: h('sleep_wake'), backgroundColor: c.wake, stack: 's', borderRadius: { topLeft: 3, topRight: 3 } },
    { type: 'line', label: 'Goal', data: rs.map(() => D.settings.sleepGoalMinutes / 60), borderColor: alpha(c.goal, 0.5), borderDash: [3, 4], borderWidth: 1.25, pointHoverRadius: 0 }]
    : [{ label: 'Asleep', data: h('sleep_minutes'), backgroundColor: c.sleep }] },
    options: { plugins: { tooltip: { filter: (x) => x.dataset.label !== 'Goal', callbacks: { label: (x) => ` ${x.dataset.label} ${hm(x.raw * 60)}` } } }, scales: { x: xScale({ stacked: true, ticks: { maxTicksLimit: 10, maxRotation: 0, autoSkipPadding: 14, padding: 6 } }), y: yScale({ stacked: true, ticks: { stepSize: 2, callback: (v) => `${v}h` } }) } } });
  const bc = rs.map((r) => r.bed_clock).filter((v) => v != null), wc = rs.map((r) => r.wake_clock).filter((v) => v != null);
  const yMin = bc.length ? Math.floor((Math.min(...bc) - 30) / 60) * 60 : 600, yMax = wc.length ? Math.ceil((Math.max(...wc) + 30) / 60) * 60 : 1200;
  chart('s2', { _dates: dates(rs), type: 'bar', data: { labels: labels(rs), datasets: [{ label: 'In bed', data: rs.map((r) => (r.bed_clock != null && r.wake_clock != null ? [r.bed_clock, r.wake_clock] : null)), backgroundColor: alpha(c.sleep, 0.75), hoverBackgroundColor: c.sleep, borderRadius: 3, borderSkipped: false }] },
    options: { plugins: { tooltip: { callbacks: { label: (x) => ` ${clock(x.raw[0])} to ${clock(x.raw[1])}` } } }, scales: { x: xScale(), y: yScale({ reverse: true, min: yMin, max: yMax, ticks: { stepSize: 120, callback: (v) => clock(v) } }) } } });
  chart('s3', { _dates: dates(rs), type: 'bar', data: { labels: labels(rs), datasets: [{ label: recName, data: rs.map((r) => r.recovery), backgroundColor: rs.map((r) => (r.recovery >= 70 ? c.recov : r.recovery >= 45 ? alpha(c.recov, 0.55) : alpha(c.recov, 0.25))) }] },
    options: { plugins: { tooltip: { callbacks: { label: (x) => ` ${x.dataset.label} ${x.raw ?? '—'}` } } }, scales: { y: yScale({ min: 0, max: 100, ticks: { stepSize: 25 } }), x: xScale() } } });
  if (hasStages) chart('s4', { type: 'doughnut', data: { labels: ['Deep', 'Light', 'REM', 'Awake'], datasets: [{ data: [st.sleep_deep, st.sleep_light, st.sleep_rem, st.sleep_wake], backgroundColor: [c.sleep, c.sleepLight, c.rem, c.wake], borderWidth: 2, borderColor: c.ground, hoverOffset: 0, borderRadius: 2 }] },
    options: { cutout: '70%', responsive: false, interaction: {}, plugins: { tooltip: { callbacks: { title: () => '', label: (x) => ` ${x.label} ${hm(x.raw)}` } } } } });
  if (D.available.sleep_score) chart('s5', { _dates: dates(rs), type: 'line', data: { labels: labels(rs), datasets: [{ label: 'Score', data: rs.map((r) => r.sleep_score), borderColor: c.sleep, backgroundColor: alpha(c.sleep, 0.08), fill: 'start', tension: 0.35, borderWidth: 1.75 }, { label: '7-day avg', data: rs.map((r) => r.sleep_score_avg7), borderColor: c.ink, backgroundColor: c.ink, borderWidth: 1.5, tension: 0.35 }] },
    options: { plugins: { tooltip: { callbacks: { label: (x) => ` ${x.dataset.label} ${fmt(x.raw, 0)}` } } }, scales: { y: yScale({ suggestedMin: 50, max: 100 }), x: xScale() } } });
}

function pageActivity() {
  const rs = rows(); const s = D.summary; const k = D.streaks; const c = C();
  view.innerHTML = `${banner()}
  <header class="page"><div><h1>Steps and activity</h1><p>Daily movement, active minutes and streaks</p></div>${rangeSeg()}</header>
  <section class="report-sheet"><div class="readouts r4" style="border-top:0;padding-top:0">
    ${readout('Steps, 7-day average', c.steps, fmt(s.steps.avg7), '', delta(s.steps.avg7, s.steps.prev7, '', true), spark(tail('steps', 30), c.steps, { goal: D.settings.stepGoal }))}
    ${readout('Active minutes, 7-day average', c.steps, fmt(s.active_minutes.avg7), 'min', delta(s.active_minutes.avg7, s.active_minutes.prev7, ' min', true), spark(tail('active_minutes', 30), c.steps))}
    ${readout('Goal streak', c.ink3, k.current, k.current === 1 ? 'day' : 'days', `Longest <b>${k.longest}</b>. Goal met ${k.hitLast30} of the last ${k.daysLast30} days`)}
    ${readout('Calories, 7-day average', c.ink3, fmt(s.calories.avg7), D.available.calories ? 'kcal' : '', D.available.calories ? delta(s.calories.avg7, s.calories.prev7, '', true) : 'Not in this data', D.available.calories ? spark(tail('calories', 30), c.ink3) : '')}
  </div></section>
  <div class="grid g2">
    <div class="card full"><h3>Daily steps ${legend([['', c.steps, `Goal met (${fmt(D.settings.stepGoal)})`], ['', alpha(c.steps, 0.35), 'Under goal'], ['ln', c.ink, '7-day average'], ['dash', c.goal, 'Goal']])}</h3><div class="chart lg"><canvas id="a1"></canvas></div></div>
    <div class="card"><h3>Active minutes ${legend([['', c.steps, 'Very active'], ['', alpha(c.steps, 0.4), 'Fairly active']])}</h3><div class="chart"><canvas id="a2"></canvas></div><p class="note">WHO guideline: 150–300 minutes of moderate activity a week, about 22–43 a day.</p></div>
    <div class="card"><h3>Weekly averages <small>Steps per day</small></h3><div class="chart"><canvas id="a3"></canvas></div></div>
    <div class="card"><h3>Calories burned</h3>${D.available.calories ? '<div class="chart sm"><canvas id="a4"></canvas></div>' : '<p class="calm">Calories are not in this data.</p>'}</div>
    <div class="card"><h3>Week by week</h3><div class="tablewrap"><table><thead><tr><th>Week of</th><th class="num">Steps a day</th><th class="num">Active min a day</th><th class="num">Sleep</th></tr></thead><tbody>
      ${D.weekly.slice(-8).reverse().map((w) => `<tr><td>${dShort(w.week)}</td><td class="num">${fmt(w.steps)}</td><td class="num">${fmt(w.active_minutes)}</td><td class="num">${hm(w.sleep_minutes)}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;
  stepsChart('a1', rs);
  chart('a2', { _dates: dates(rs), type: 'bar', data: { labels: labels(rs), datasets: [
    { label: 'Very active', data: rs.map((r) => r.very_active_minutes ?? r.active_minutes), backgroundColor: c.steps, stack: 'a', borderRadius: 0 },
    { label: 'Fairly active', data: rs.map((r) => r.fairly_active_minutes), _tip: alpha(c.steps, 0.6), backgroundColor: alpha(c.steps, 0.4), stack: 'a', borderRadius: { topLeft: 3, topRight: 3 } }] },
    options: { plugins: { tooltip: { callbacks: { label: (x) => ` ${x.dataset.label} ${fmt(x.raw)} min` } } }, scales: { x: xScale({ stacked: true }), y: yScale({ stacked: true, beginAtZero: true }) } } });
  const wk = D.weekly.slice(range ? -Math.ceil(range / 7) - 1 : 0);
  chart('a3', { type: 'bar', data: { labels: wk.map((w) => dShort(w.week)), datasets: [{ label: 'Average steps', data: wk.map((w) => w.steps), backgroundColor: alpha(c.steps, 0.8), hoverBackgroundColor: c.steps, borderRadius: 5 }] },
    options: { plugins: { tooltip: { callbacks: { title: (i) => `Week of ${i[0].label}`, label: (x) => ` ${fmt(x.raw)} steps a day` } } }, scales: { x: xScale(), y: yScale({ beginAtZero: true, ticks: { callback: (v) => compact(v) } }) } } });
  if (D.available.calories) chart('a4', { _dates: dates(rs), type: 'line', data: { labels: labels(rs), datasets: [{ label: 'Calories', data: rs.map((r) => r.calories), borderColor: c.ink2, backgroundColor: alpha(c.ink, 0.05), fill: 'start', tension: 0.35, borderWidth: 1.75 }] },
    options: { plugins: { tooltip: { callbacks: { label: (x) => ` ${fmt(x.raw)} kcal` } } }, scales: { x: xScale(), y: yScale({ ticks: { callback: (v) => compact(v) } }) } } });
}

function pageHeart() {
  const rs = rows(); const s = D.summary; const c = C();
  const hrFlags = D.flags.filter((f) => f.metric === 'resting_hr' || f.metric === 'hrv');
  view.innerHTML = `${banner()}
  <header class="page"><div><h1>Heart rate and HRV</h1><p>Resting heart rate, heart-rate variability and your personal baseline</p></div>${rangeSeg()}</header>
  <section class="report-sheet"><div class="readouts r4" style="border-top:0;padding-top:0">
    ${readout('Resting heart rate, latest', c.heart, fmt(s.resting_hr.latest, 1), 'bpm', `7-day <b>${fmt(s.resting_hr.avg7, 1)}</b>, 30-day <b>${fmt(s.resting_hr.avg30, 1)}</b>`, spark(tail('resting_hr', 30), c.heart))}
    ${readout('HRV, latest', c.hrv, fmt(s.hrv.latest, 1), 'ms', `7-day <b>${fmt(s.hrv.avg7, 1)}</b>, 30-day <b>${fmt(s.hrv.avg30, 1)}</b>`, spark(tail('hrv', 30), c.hrv))}
    ${readout('SpO₂, 7-day average', c.recov, fmt(s.spo2_avg.avg7, 1), D.available.spo2_avg ? '%' : '', D.available.spo2_avg ? 'Overnight average' : 'Not in this data', D.available.spo2_avg ? spark(tail('spo2_avg', 30), c.recov) : '')}
    ${readout('Breathing rate, 7 days', c.ink3, fmt(s.breathing_rate.avg7, 1), D.available.breathing_rate ? 'per min' : '', D.available.breathing_rate ? 'During sleep' : 'Not in this data', D.available.breathing_rate ? spark(tail('breathing_rate', 30), c.ink3) : '')}
  </div></section>
  <div class="grid g2">
    <div class="card"><h3>Resting heart rate ${legend([['ln', c.heart, '7-day average'], ['', alpha(c.heart, 0.15), 'Usual range']])}</h3><div class="chart"><canvas id="h1"></canvas></div><p class="note">Lower than usual often tracks with good recovery and fitness. Higher than usual commonly follows poor sleep, alcohol, stress, heat, hard training or getting sick.</p></div>
    <div class="card"><h3>HRV (RMSSD) ${legend([['ln', c.hrv, '7-day average'], ['', alpha(c.hrv, 0.15), 'Usual range']])}</h3><div class="chart"><canvas id="h2"></canvas></div><p class="note">HRV is very personal. Compare it only with your own baseline and watch the 7-day trend rather than single nights.</p></div>
    <div class="card"><h3>Notable deviations</h3>
      <p class="note worth-lead">${hrFlags.length ? `${hrFlags.length} against your baseline` : 'Quiet so far'}</p>
      ${flagList(hrFlags.slice(-8).reverse(), 'No notable deviations from your baseline.')}
      <p class="note">Compared with your previous 30 days. Observations only — not a diagnosis.</p></div>
    <div class="card"><h3>${D.available.spo2_avg ? 'SpO₂ and breathing rate' : 'All-day heart rate'} ${D.available.spo2_avg ? legend([['ln', c.recov, 'SpO₂ %'], ['ln', c.ink3, 'Breaths per min']]) : legend([['ln', c.heart, 'Daily average'], ['', alpha(c.heart, 0.25), 'Low to high']])}</h3><div class="chart sm"><canvas id="h3"></canvas></div></div>
  </div>`;
  const band = (k, color) => [
    { label: 'Usual high', data: rs.map((r) => (r[k + '_base'] != null ? r[k + '_base'] + (r[k + '_sd'] || 0) : null)), borderWidth: 0, pointHoverRadius: 0, backgroundColor: alpha(color, 0.1), fill: '+1', tension: 0.35 },
    { label: 'Usual low', data: rs.map((r) => (r[k + '_base'] != null ? r[k + '_base'] - (r[k + '_sd'] || 0) : null)), borderWidth: 0, pointHoverRadius: 0, tension: 0.35 }];
  const flagged = (k) => new Set(D.flags.filter((f) => f.metric === k).map((f) => f.date));
  const line = (id, k, color, unit) => { const fl = flagged(k); chart(id, { _dates: dates(rs), type: 'line', data: { labels: labels(rs), datasets: [
    ...band(k, color),
    { label: 'Daily', data: rs.map((r) => r[k]), borderColor: alpha(color, 0.35), backgroundColor: color, borderWidth: 1, tension: 0.25,
      pointRadius: rs.map((r) => (fl.has(r.date) ? 4.5 : 1.75)), pointBackgroundColor: rs.map((r) => (fl.has(r.date) ? c.sheet : alpha(color, 0.6))), pointBorderColor: rs.map((r) => (fl.has(r.date) ? color : 'transparent')), pointBorderWidth: rs.map((r) => (fl.has(r.date) ? 2 : 0)) },
    { label: '7-day avg', data: rs.map((r) => r[k + '_avg7']), borderColor: color, backgroundColor: color, borderWidth: 2.5, tension: 0.35 }] },
    options: { plugins: { tooltip: { filter: (x) => x.datasetIndex >= 2, callbacks: { label: (x) => ` ${x.dataset.label} ${fmt(x.raw, 1)} ${unit}`, afterBody: (items) => (items[0] && fl.has(rs[items[0].dataIndex].date) ? 'Flagged: outside your usual range' : '') } } },
      scales: { x: xScale(), y: yScale({ grace: '6%', ticks: { callback: (v) => fmt(v, 0) } }) } } }); };
  line('h1', 'resting_hr', c.heart, 'bpm'); line('h2', 'hrv', c.hrv, 'ms');
  if (D.available.spo2_avg) chart('h3', { _dates: dates(rs), type: 'line', data: { labels: labels(rs), datasets: [{ label: 'SpO₂', data: rs.map((r) => r.spo2_avg), borderColor: c.recov, backgroundColor: c.recov, tension: 0.3, yAxisID: 'y' }, { label: 'Breathing', data: rs.map((r) => r.breathing_rate), borderColor: c.ink3, backgroundColor: c.ink3, tension: 0.3, yAxisID: 'y1', borderWidth: 1.5 }] },
    options: { plugins: { tooltip: { callbacks: { label: (x) => ` ${x.dataset.label} ${fmt(x.raw, 1)}${x.datasetIndex ? ' per min' : '%'}` } } }, scales: { y: yScale({ suggestedMin: 92, suggestedMax: 100 }), y1: yScale({ position: 'right', grid: { display: false } }), x: xScale() } } });
  else chart('h3', { _dates: dates(rs), type: 'bar', data: { labels: labels(rs), datasets: [
    { type: 'line', label: 'Average', data: rs.map((r) => r.hr_avg), borderColor: c.heart, backgroundColor: c.heart, tension: 0.3, borderWidth: 2, pointRadius: 3, order: 0 },
    { label: 'Range', data: rs.map((r) => (r.hr_min != null && r.hr_max != null ? [r.hr_min, r.hr_max] : null)), _tip: c.heart, backgroundColor: alpha(c.heart, 0.18), hoverBackgroundColor: alpha(c.heart, 0.3), borderRadius: 3, borderSkipped: false, order: 1 }] },
    options: { plugins: { tooltip: { callbacks: { label: (x) => (Array.isArray(x.raw) ? ` Range ${fmt(x.raw[0], 0)}–${fmt(x.raw[1], 0)} bpm` : ` Average ${fmt(x.raw, 0)} bpm`) } } }, scales: { x: xScale(), y: yScale({ grace: '6%', ticks: { callback: (v) => fmt(v, 0) } }) } } });
}

// ---------------- intraday heart rate (Fathom-like quiet trace) ----------------
const IH = { dates: null, date: null, cache: new Map(), chart: null, sample: false, last: null };
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const ZONE_NAME = { LIGHT: 'Light', MODERATE: 'Moderate', VIGOROUS: 'Vigorous', PEAK: 'Peak' };
function intradayCard({ locked = false } = {}) {
  return `<section class="card ih" id="ih" aria-labelledby="ihTitle" aria-busy="true">
    <div class="ih-head"><h3 id="ihTitle">Heart rate through the day <small id="ihSub">Loading…</small></h3>
      <div class="daypick" id="ihPick" hidden><button class="dp-btn" id="ihPrev" aria-label="Previous day with heart-rate data">${chev(-1)}</button><span class="dp-date" id="ihDate" aria-live="polite"></span><button class="dp-btn" id="ihNext" aria-label="Next day with heart-rate data">${chev(1)}</button></div></div>
    <div class="ih-body"><div class="ih-trace"><div class="chart ih-chart"><canvas id="ihc" role="img" aria-label="Heart rate across the selected day"></canvas></div>
      <p class="ih-readout" id="ihReadout" aria-live="polite"><strong>—</strong><span>bpm</span></p></div>
      <dl class="ih-stats" id="ihStats"><div class="ih-mets">${['Lowest', 'Highest', 'Average', 'Time worn'].map((l) => `<div class="ih-stat"><dt>${l}</dt><dd>—</dd><dd class="s"></dd></div>`).join('')}</div></dl></div>
    <p class="ih-legend" id="ihLegend"></p>
  </section>`;
}
function chev(dir) { return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${dir < 0 ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
async function initIntraday(opts = {}) {
  try {
    if (!IH.dates) { const j = await (await api('/api/intraday')).json(); IH.dates = j.dates || []; IH.sample = !!j.sample; }
    if (!document.getElementById('ih')) return;
    if (!IH.dates.length) return ihEmpty('No all-day heart rate yet. Wear the band and upload a new export.');
    const pick = $('#ihPick');
    if (opts.locked) {
      if (pick) pick.hidden = true;
      if (opts.date && IH.dates.includes(opts.date)) IH.date = opts.date;
      else return ihEmpty(opts.date ? 'No heart rate for today yet. Wear the band and sync.' : 'No all-day heart rate yet.');
    } else {
      if (!IH.date || !IH.dates.includes(IH.date)) IH.date = IH.dates[IH.dates.length - 1];
      if (pick) pick.hidden = false;
      $('#ihPrev').onclick = () => ihStep(-1); $('#ihNext').onclick = () => ihStep(1);
      $('#ihPick').onkeydown = (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); ihStep(e.key === 'ArrowLeft' ? -1 : 1); } };
    }
    await ihShow(IH.date);
  } catch (e) { ihEmpty('Could not load heart rate for this day.'); }
}
function ihEmpty(text) {
  const card = document.getElementById('ih'); if (!card) return; card.setAttribute('aria-busy', 'false');
  $('#ihSub').textContent = ''; card.querySelector('.ih-body').innerHTML = `<div class="chart is-empty"><p class="nodata">${esc(text)}</p></div>`; $('#ihLegend').textContent = '';
}
async function ihStep(d) { const i = IH.dates.indexOf(IH.date) + d; if (i < 0 || i >= IH.dates.length) return; IH.date = IH.dates[i]; await ihShow(IH.date); }
async function ihDay(date) {
  if (!IH.cache.has(date)) IH.cache.set(date, api(`/api/intraday/${date}`).then((r) => (r.ok ? r.json() : null)));
  return IH.cache.get(date);
}
function ihAnalyse(day) {
  const pts = []; let lo = null, hi = null, loAt = 0, hiAt = 0, sum = 0, n = 0, above = 0, first = null, last = null;
  const zones = (day.zones || []).filter((z) => z.type !== 'LIGHT'); const inZone = Object.fromEntries(zones.map((z) => [z.type, 0]));
  for (let i = 0; i < day.avg.length; i++) {
    const v = day.avg[i]; if (v == null) continue;
    if (first == null) first = i; last = i; sum += v; n++;
    if (lo == null || day.min[i] < lo) { lo = day.min[i]; loAt = i; } if (hi == null || day.max[i] > hi) { hi = day.max[i]; hiAt = i; }
    if (v >= 100) above++;
    for (const z of zones) if (v >= z.min && v <= z.max) inZone[z.type]++;
    pts.push({ x: i + 0.5, y: v });
  }
  // densify to full day with nulls so Chart.js can break the stroke on gaps (Fathom: gap > 8 min → new path)
  const series = [];
  for (let i = 0; i < 1440; i++) series.push({ x: i + 0.5, y: day.avg[i] == null ? null : day.avg[i] });
  return { pts: series, wornPts: pts, lo, hi, loAt, hiAt, avg: n ? sum / n : null, worn: n, above, first, last, zones, inZone };
}
// Custom pointer owns scrub — Chart.js hover modes stay off for this chart (avoids fight + wobble).
function ihSetReadout(bpm, minute, hovering) {
  const el = document.getElementById('ihReadout'); if (!el) return;
  // Keep DOM shape stable so Literata bpm doesn't reflow/wobble while scrubbing.
  if (bpm == null) {
    el.innerHTML = hovering
      ? `<strong class="ih-gap">—</strong><span>no sample here</span>`
      : `<strong>—</strong><span>bpm</span>`;
    return;
  }
  el.innerHTML = `<strong>${fmt(bpm, 0)}</strong><span>bpm at ${hhmm(minute)} IST</span>`;
}
// Zone washes: barely-there warm bands on the olive raise — blend first, visibility second.
// Quiet legend under the chart names Moderate / Vigorous / Peak with thresholds.
function zoneWashPlugin(zones) {
  return { id: 'zoneWash', beforeDatasetsDraw(ch) {
    if (!zones || !zones.length) return;
    const { ctx: g, chartArea: a, scales: { y } } = ch;
    if (!a || !y) return;
    g.save();
    // Paper washes on olive raise — barely there, stronger only for Peak.
    const opac = { MODERATE: 0.022, VIGOROUS: 0.036, PEAK: 0.055 };
    zones.forEach((z) => {
      const pMax = y.getPixelForValue(Math.min(z.max, y.max));
      const pMin = y.getPixelForValue(z.min);
      const top = Math.max(a.top, Math.min(pMax, pMin));
      const bot = Math.min(a.bottom, Math.max(pMax, pMin));
      if (bot - top < 2) return;
      g.fillStyle = `rgba(243, 239, 228, ${opac[z.type] ?? 0.03})`;
      g.fillRect(a.left, top, a.right - a.left, bot - top);
    });
    g.restore();
  } };
}
// Quiet hover: paper disc on the active sample (Fathom circle), no floating tooltip chrome.
const ihHoverDot = { id: 'ihHoverDot', afterDatasetsDraw(ch) {
  const a = ch.getActiveElements && ch.getActiveElements();
  if (!a || !a.length) return;
  const el = a[0].element; if (!el || el.skip) return;
  const g = ch.ctx; g.save();
  g.fillStyle = C().ink; g.beginPath(); g.arc(el.x, el.y, 5.5, 0, Math.PI * 2); g.fill();
  g.restore();
} };
async function ihShow(date) {
  const card = document.getElementById('ih'); if (!card) return;
  const i = IH.dates.indexOf(date); $('#ihPrev').disabled = i <= 0; $('#ihNext').disabled = i >= IH.dates.length - 1;
  $('#ihDate').textContent = dFull(date);
  const day = await ihDay(date); if (!document.getElementById('ih') || IH.date !== date) return;
  if (!day) return ihEmpty('No heart rate for this day.');
  const c = C(); const A = ihAnalyse(day); const row = D.rows.find((r) => r.date === date); const rhr = row && row.resting_hr != null ? row.resting_hr : null;
  card.setAttribute('aria-busy', 'false');
  $('#ihSub').textContent = A.first != null ? `Band worn ${hhmm(A.first)}–${hhmm(A.last + 1)} IST${IH.sample ? ' · sample' : ''}` : '';
  const zoneStat = A.zones.length ? A.zones.map((z) => [`${ZONE_NAME[z.type] || z.type} <small>${z.min}+</small>`, hmShort(A.inZone[z.type])]) : [['Above 100 bpm', hmShort(A.above)]];
  const mets = [
    ['Lowest', `${fmt(A.lo)}<small>bpm</small>`, `at ${hhmm(A.loAt)}`],
    ['Highest', `${fmt(A.hi)}<small>bpm</small>`, `at ${hhmm(A.hiAt)}`],
    ['Average', `${fmt(A.avg)}<small>bpm</small>`, rhr != null ? `resting ${fmt(rhr)}` : 'while worn'],
    ['Time worn', hmShort(A.worn), `${fmt(day.samples)} readings`],
  ];
  const metHtml = mets.map(([l, v, sub]) => `<div class="ih-stat"><dt>${l}</dt><dd>${v}</dd><dd class="s">${sub}</dd></div>`).join('');
  const zoneHtml = `<div class="zrow"><dt>${A.zones.length ? 'Time in zones <small>by 1-minute average</small>' : 'Elevated heart rate'}</dt><div class="zlines">${zoneStat.map(([l, v]) => `<span>${l}</span><b>${v}</b>`).join('')}</div></div>`;
  $('#ihStats').innerHTML = `<div class="ih-mets">${metHtml}</div>${zoneHtml}`;
  const zoneLeg = A.zones.length
    ? A.zones.map((z) => {
        const o = ({ MODERATE: 0.22, VIGOROUS: 0.36, PEAK: 0.55 })[z.type] ?? 0.3;
        return `<span class="zleg"><i style="background:rgba(243,239,228,${o})"></i>${ZONE_NAME[z.type] || z.type} <small>${z.min}+</small></span>`;
      }).join('')
    : '';
  $('#ihLegend').innerHTML = `${zoneLeg}<span class="gapnote">Gaps are times the band was off.</span>`;
  // Default readout = last worn sample (Fathom: show last until pointer moves)
  IH.last = A.last != null ? { bpm: day.avg[A.last], minute: A.last } : null;
  ihSetReadout(IH.last ? IH.last.bpm : null, IH.last ? IH.last.minute : 0, false);
  const yPad = 4;
  const yMin = Math.max(40, Math.floor(((A.lo || 60) - yPad) / 5) * 5);
  const zoneTop = A.zones.length ? A.zones[A.zones.length - 1].min + 8 : 0;
  const yMax = Math.ceil((Math.max(A.hi || 120, zoneTop) + yPad) / 5) * 5;
  const cfg = { type: 'line', _noGuide: true, data: { datasets: [
    { label: 'Heart rate', data: A.pts, borderColor: c.heart, backgroundColor: c.ink, borderWidth: 2.2,
      spanGaps: false, tension: 0, pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0,
      borderCapStyle: 'round', borderJoinStyle: 'round' }] },
    options: { parsing: false, normalized: true,
      // Pointer scrub owns hover; Chart.js events off so they cannot fight setActiveElements.
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      events: [],
      animation: reduceMotion() ? false : { duration: 420, easing: 'easeOutCubic' },
      layout: { padding: { top: 14, bottom: 6, left: 4, right: 4 } },
      plugins: { tooltip: { enabled: false } },
      scales: {
        x: { type: 'linear', min: 0, max: 1440, grid: { display: false },
          border: { display: true, color: alpha(c.ink, 0.22), width: 1 },
          ticks: { stepSize: 360, maxRotation: 0, padding: 10, autoSkip: false, color: alpha(c.ink, 0.42),
            font: { size: 11, family: '"Schibsted Grotesk","Avenir Next",system-ui,sans-serif' },
            callback: (v) => (v % 360 === 0 ? (v === 1440 ? '24:00' : hhmm(v)) : '') } },
        y: { min: yMin, max: yMax, display: false, border: { display: false }, grid: { display: false }, ticks: { display: false } } } },
    plugins: [zoneWashPlugin(A.zones), ihHoverDot] };
  if (IH.chart) { charts = charts.filter((x) => x !== IH.chart); IH.chart.destroy(); IH.chart = null; }
  const cv = document.getElementById('ihc'); if (!cv) return;
  chart('ihc', cfg); IH.chart = charts[charts.length - 1];
  ihBindPointer(cv, A.pts);
  const nb = IH.dates[i - 1], na = IH.dates[i + 1]; [nb, na].forEach((d) => d && ihDay(d));
}
// Native pointer scrub (desktop + mobile) — x→minute from chartArea only, sticky & rAF-throttled.
function ihBindPointer(cv, pts) {
  const worn = [];
  pts.forEach((p, index) => { if (p && p.y != null) worn.push({ index, minute: Math.floor(p.x), bpm: p.y }); });
  // Binary search nearest worn minute (x-distance only — never Euclidean nearest-point).
  const nearestWorn = (minute) => {
    if (!worn.length) return null;
    let lo = 0, hi = worn.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (worn[mid].minute < minute) lo = mid + 1; else hi = mid;
    }
    let best = worn[lo];
    if (lo > 0 && Math.abs(worn[lo - 1].minute - minute) < Math.abs(best.minute - minute)) best = worn[lo - 1];
    return best;
  };
  let raf = 0, pendingX = null, activeIdx = -1, hovering = false;
  const apply = (clientX) => {
    const ch = IH.chart; if (!ch || !worn.length) return;
    const area = ch.chartArea; const xScale = ch.scales && ch.scales.x;
    if (!area || !xScale || area.right <= area.left) return;
    // Chart.js relative position (CSS px, DPR-safe) — not full canvas width (that skipped padding → wobble).
    const pos = Chart.helpers.getRelativePosition({ clientX, clientY: area.top + 1 }, ch);
    const clamped = Math.min(area.right, Math.max(area.left, pos.x));
    const minute = Math.min(1439, Math.max(0, Math.floor(xScale.getValueForPixel(clamped))));
    const best = nearestWorn(minute);
    if (!best) return;
    const dist = Math.abs(best.minute - minute);
    // Over a long gap: keep last sticky disc (Fathom) instead of clearing → no readout thrash.
    if (dist > 22) {
      if (!hovering) return;
      if (activeIdx !== -2) { activeIdx = -2; ihSetReadout(null, 0, true); }
      return;
    }
    if (best.index === activeIdx && hovering) {
      // Same minute — skip setActiveElements/draw (stops disc flicker).
      return;
    }
    activeIdx = best.index;
    hovering = true;
    ch.setActiveElements([{ datasetIndex: 0, index: best.index }]);
    ch.draw();
    ihSetReadout(best.bpm, best.minute, true);
  };
  const schedule = (clientX) => {
    pendingX = clientX;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const x = pendingX; pendingX = null;
      if (x != null) apply(x);
    });
  };
  const clear = () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    pendingX = null; activeIdx = -1; hovering = false;
    const ch = IH.chart; if (ch) { ch.setActiveElements([]); ch.draw(); }
    if (IH.last) ihSetReadout(IH.last.bpm, IH.last.minute, false);
  };
  cv.style.touchAction = 'none';
  cv.onpointermove = (e) => schedule(e.clientX);
  cv.onpointerdown = (e) => { try { cv.setPointerCapture(e.pointerId); } catch (_) {} apply(e.clientX); };
  // Mouse leaving resets to last sample; touch keeps the tapped minute (Fathom-like scrub).
  cv.onpointerleave = (e) => { if (e.pointerType === 'mouse') clear(); };
  cv.onpointercancel = clear;
  cv.onpointerup = (e) => {
    if (e.pointerType === 'mouse') return;
    // Touch end: leave disc + readout on the last scrubbed minute.
  };
}
const XSTEP = () => (matchMedia('(max-width: 760px)').matches ? 360 : 180);
function hmShort(min) { if (min == null) return '—'; const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; }

function pageCoach() {
  const cs = D.coach || {};
  const sugg = ['How has my sleep been this week?', 'Why might my resting HR have gone up recently?', 'Am I recovered enough for a hard workout today?', 'How can I make my bedtime more consistent?', 'Compare my steps this week with last week'];
  const pathLabel = cs.path === 'oauth' ? 'SuperGrok' : (cs.path === 'apikey' ? (cs.provider || 'API key') : null);
  view.innerHTML = `<div class="coach-page">${banner()}
  <header class="page"><div><h1>Coach</h1><p>Ask about your sleep, activity and heart data. General wellness guidance, not medical advice.</p></div>
  <div class="row">${cs.configured && pathLabel ? `<span class="pill real"><i></i>${esc(pathLabel)}</span>` : ''}<button type="button" class="btn ghost" id="ctxBtn" aria-expanded="false" aria-controls="ctx">What the coach sees</button><button type="button" class="btn ghost" id="coachConnBtn">${cs.configured ? 'Connection' : 'Set up'}</button>${cs.configured ? '<button type="button" class="btn ghost" id="clearChat">New chat</button>' : ''}</div></header>
  <pre class="report" id="ctx" hidden style="margin:0 0 16px"></pre>
  <div id="coachSetup" class="coach-setup" ${cs.configured ? 'hidden' : ''}></div>
  <div class="chat" id="coachChat"${cs.configured ? '' : ' hidden'}>
    <div class="msgs" id="msgs" aria-live="polite"></div>
    ${cs.configured ? `<div class="chips" id="chips">${sugg.map((q) => `<button type="button" class="chip">${esc(q)}</button>`).join('')}</div>` : ''}
    <form class="composer" id="composer"${cs.configured ? '' : ' hidden'}><label for="q" class="sr" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Message</label><textarea id="q" rows="1" placeholder="${cs.configured ? 'Ask about your data…' : 'Coach is off'}" ${cs.configured ? '' : 'disabled'}></textarea><button class="btn" ${cs.configured ? '' : 'disabled'}>Send</button></form>
  </div></div>`;

  const box = $('#msgs');
  const setupEl = $('#coachSetup');
  let pollTimer = null;
  let leftTimer = null;

  const paintChat = () => {
    if (!box) return;
    if (!cs.configured && !chat.length) { box.innerHTML = ''; return; }
    const welcome = chat.length ? '' : `<div class="msg assistant md">${mdHtml(`Hi Vansh. I can see ${D.isSample ? '**sample** data, not yours yet,' : 'your data'} from ${dShort(D.range[0])} to ${dShort(D.range[1])}. Ask me about trends, recovery or habits.`)}</div>`;
    box.innerHTML = welcome + chat.map((m) => {
      if (m.role === 'assistant') return `<div class="msg assistant md">${mdHtml(m.content)}</div>`;
      return `<div class="msg ${m.role}">${esc(m.content)}</div>`;
    }).join('');
    sessionStorage.setItem('chat', JSON.stringify(chat.filter((m) => m.role !== 'sys'))); requestAnimationFrame(() => { const c = document.getElementById('composer'); if (c) c.scrollIntoView({ block: 'end' }); else window.scrollTo(0, document.documentElement.scrollHeight); });
  };

  function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; if (leftTimer) clearInterval(leftTimer); leftTimer = null; }

  async function refreshCoach() {
    const j = await (await api('/api/coach/auth')).json();
    D.coach = j.coach; Object.assign(cs, j.coach);
    return j.coach;
  }

  function renderSetup() {
    const oa = cs.oauth || {};
    const ak = cs.apikey || {};
    const oauthCard = oa.connected
      ? `<div class="conn-card is-on">
          <div class="conn-head"><h3>SuperGrok</h3><span class="pill real"><i></i>Connected</span></div>
          <p>Using your SuperGrok / X Premium+ subscription through the Grok CLI path. Tokens stay on this server.</p>
          <div class="row">
            ${cs.path === 'oauth' ? '<span class="calm">Active path</span>' : '<button type="button" class="btn ghost" id="preferOAuth">Use SuperGrok</button>'}
            <button type="button" class="btn danger" id="oauthDisconnect">Disconnect</button>
          </div>
        </div>`
      : `<div class="conn-card" id="oauthCard">
          <div class="conn-head"><h3>Connect SuperGrok</h3><span class="pill">Subscription</span></div>
          <p>Sign in with your SuperGrok or X Premium+ account. No API key needed — usage comes from your subscription.</p>
          <div class="row"><button type="button" class="btn" id="oauthStart">Connect SuperGrok</button></div>
          <div id="oauthFlow"></div>
          <p class="note">If your plan blocks this connection, use an API key from console.x.ai instead.</p>
        </div>`;

    const keyForm = ak.configured
      ? `<div class="conn-card ${cs.path === 'apikey' ? 'is-on' : ''}">
          <div class="conn-head"><h3>API key</h3><span class="pill real"><i></i>Saved</span></div>
          <p>${esc((ak.provider || 'key').toUpperCase())} key on this server: <code>${esc(ak.masked || '••••')}</code>${ak.source === 'env' ? ' (from .env)' : ''}.</p>
          <div class="row">
            ${cs.path === 'apikey' ? '<span class="calm">Active path</span>' : '<button type="button" class="btn ghost" id="preferKey">Use API key</button>'}
            <button type="button" class="btn ghost" id="keyChange">Change key</button>
            <button type="button" class="btn danger" id="keyClear">Remove key</button>
          </div>
          <form id="keyForm" class="key-form" hidden>
            <label>Provider<select name="provider"><option value="xai">xAI (Grok)</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></label>
            <label>API key<input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste key — stored only on this server" required minlength="8"></label>
            <div class="row"><button class="btn" type="submit">Save key</button><button class="btn ghost" type="button" id="keyCancel">Cancel</button></div>
          </form>
        </div>`
      : `<div class="conn-card">
          <div class="conn-head"><h3>Use an API key</h3><span class="pill">Pay per token</span></div>
          <p>Add a key from console.x.ai (or OpenAI, Anthropic, Gemini). It is saved on this server only and never shown again in full.</p>
          <form id="keyForm" class="key-form">
            <label>Provider<select name="provider"><option value="xai" selected>xAI (Grok)</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></label>
            <label>API key<input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste key — stored only on this server" required minlength="8"></label>
            <div class="row"><button class="btn" type="submit">Save key</button></div>
          </form>
        </div>`;

    setupEl.innerHTML = `<div class="setup">
      <h2>${cs.configured ? 'Coach connection' : 'Connect the coach'}</h2>
      <p>It answers from ${D.isSample ? 'the sample data' : 'your data'} (${dShort(D.range[0])} – ${dShort(D.range[1])}). Pick one path — or keep both and switch which is active.</p>
      <div class="conn-grid">${oauthCard}${keyForm}</div>
      ${cs.configured ? '<div class="row" style="margin-top:14px"><button type="button" class="btn ghost" id="setupDone">Back to chat</button></div>' : `<p class="asks">Once it’s on, you can ask things like:</p><div class="chips">${sugg.slice(0, 3).map((q) => `<button type="button" class="chip" disabled>${esc(q)}</button>`).join('')}</div>`}
      <p id="setupMsg" class="note" role="status"></p>
    </div>`;
    bindSetup();
  }

  function showSetupMsg(text, bad) {
    const el = $('#setupMsg'); if (!el) return;
    el.textContent = text || '';
    el.style.color = bad ? 'var(--neg)' : 'var(--text-3)';
  }

  function showOAuthFlow(j) {
    const flow = $('#oauthFlow'); if (!flow) return;
    stopPoll();
    const link = j.verification_uri_complete || j.verification_uri;
    flow.innerHTML = `<div class="pairbox coach-pair">${j.qr ? `<div class="qr" aria-label="SuperGrok login QR">${j.qr}</div>` : ''}<div>
      <div class="note" style="margin:0">Open this link and enter the code</div>
      <div class="paircode">${esc(j.user_code)}</div>
      <p class="note" style="margin:6px 0"><a href="${esc(link)}" target="_blank" rel="noopener">${esc(j.verification_uri || link)}</a></p>
      <div class="note" id="oauthLeft" style="margin:0"></div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn ghost" id="oauthCancel">Cancel</button></div>
    </div></div>`;
    const tick = () => {
      const left = Math.max(0, Math.round((j.expires_at - Date.now()) / 1000));
      const t = $('#oauthLeft'); if (t) t.textContent = left ? `Code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · waiting for approval…` : 'Expired. Connect again.';
      if (!left) stopPoll();
    };
    tick(); leftTimer = setInterval(tick, 1000);
    const cancel = $('#oauthCancel'); if (cancel) cancel.onclick = async () => { stopPoll(); await api('/api/coach/auth/cancel', { method: 'POST', body: '{}' }); await refreshCoach(); renderSetup(); };
    pollTimer = setInterval(async () => {
      try {
        const r = await api('/api/coach/auth/poll');
        const p = await r.json();
        if (p.status === 'connected') {
          stopPoll();
          Object.assign(cs, p.coach || {});
          D.coach = cs;
          showSetupMsg('SuperGrok connected.');
          await afterConfigured();
          return;
        }
        if (p.status === 'expired' || p.status === 'error') {
          stopPoll();
          showSetupMsg(p.error || 'Login failed.', true);
          await refreshCoach(); renderSetup();
        }
      } catch (e) { /* keep polling */ }
    }, Math.max(2000, (j.interval || 5) * 1000));
  }

  async function afterConfigured() {
    stopPoll();
    await refreshCoach();
    // Rebuild page so chat + chips appear
    render();
  }

  function bindSetup() {
    const start = $('#oauthStart');
    if (start) start.onclick = async () => {
      start.disabled = true; showSetupMsg('Starting SuperGrok login…');
      try {
        const r = await api('/api/coach/auth/start', { method: 'POST', body: '{}' });
        const j = await r.json();
        if (!r.ok) { showSetupMsg(j.error || 'Could not start login.', true); start.disabled = false; return; }
        showSetupMsg('');
        showOAuthFlow(j);
      } catch (e) { showSetupMsg('Unable to reach the server.', true); start.disabled = false; }
    };
    const disc = $('#oauthDisconnect');
    if (disc) disc.onclick = async () => {
      if (!confirm('Disconnect SuperGrok? The coach will use an API key if one is saved, or turn off.')) return;
      await api('/api/coach/auth/disconnect', { method: 'POST', body: '{}' });
      await afterConfigured();
    };
    const po = $('#preferOAuth'); if (po) po.onclick = async () => { await api('/api/coach/prefer', { method: 'POST', body: JSON.stringify({ prefer: 'oauth' }) }); await afterConfigured(); };
    const pk = $('#preferKey'); if (pk) pk.onclick = async () => { await api('/api/coach/prefer', { method: 'POST', body: JSON.stringify({ prefer: 'apikey' }) }); await afterConfigured(); };
    const kc = $('#keyChange'); if (kc) kc.onclick = () => { const f = $('#keyForm'); if (f) f.hidden = false; };
    const kcan = $('#keyCancel'); if (kcan) kcan.onclick = () => { const f = $('#keyForm'); if (f) f.hidden = true; };
    const kclear = $('#keyClear');
    if (kclear) kclear.onclick = async () => {
      if (!confirm('Remove the saved API key from this server?')) return;
      await api('/api/coach/secrets/clear', { method: 'POST', body: '{}' });
      await afterConfigured();
    };
    const kf = $('#keyForm');
    if (kf) kf.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(kf);
      const body = { provider: fd.get('provider'), key: fd.get('key'), prefer: 'apikey' };
      const btn = kf.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      showSetupMsg('Saving key…');
      try {
        const r = await api('/api/coach/secrets', { method: 'POST', body: JSON.stringify(body) });
        const j = await r.json();
        if (!r.ok) { showSetupMsg(j.error || 'Could not save key.', true); if (btn) btn.disabled = false; return; }
        kf.reset();
        showSetupMsg('API key saved.');
        await afterConfigured();
      } catch (err) { showSetupMsg('Unable to reach the server.', true); if (btn) btn.disabled = false; }
    };
    const done = $('#setupDone'); if (done) done.onclick = () => { setupEl.hidden = true; const chatEl = $('#coachChat'); if (chatEl) chatEl.hidden = false; };
  }

  renderSetup();
  if (!cs.configured) setupEl.hidden = false;
  paintChat();

  const connBtn = $('#coachConnBtn');
  if (connBtn) connBtn.onclick = () => {
    const open = setupEl.hidden;
    setupEl.hidden = !open;
    if (open) { renderSetup(); const chatEl = $('#coachChat'); if (chatEl && !cs.configured) chatEl.hidden = true; }
    else if (cs.configured) { const chatEl = $('#coachChat'); if (chatEl) chatEl.hidden = false; }
  };

  const q = $('#q');
  if (q) {
    const grow = () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight + 2, 160) + 'px'; };
    q.addEventListener('input', grow);
    const send = async (text) => {
      if (!text.trim() || !cs.configured) return;
      chat.push({ role: 'user', content: text.trim() }); paintChat(); q.value = ''; grow();
      const thinking = document.createElement('div'); thinking.className = 'msg assistant thinking'; thinking.setAttribute('aria-label', 'Thinking'); thinking.innerHTML = 'Thinking<span>.</span><span>.</span><span>.</span>'; box.appendChild(thinking); requestAnimationFrame(() => { const c = document.getElementById('composer'); if (c) c.scrollIntoView({ block: 'end' }); else window.scrollTo(0, document.documentElement.scrollHeight); });
      try {
        const r = await api('/api/coach', { method: 'POST', body: JSON.stringify({ messages: chat.filter((m) => m.role !== 'sys') }) });
        const j = await r.json();
        chat.push(r.ok ? { role: 'assistant', content: j.answer || '(empty reply)' } : { role: 'sys', content: j.error || 'The coach returned an error. Try again.' });
      } catch (e) { chat.push({ role: 'sys', content: 'Unable to reach the server. Check your connection and try again.' }); }
      paintChat();
    };
    const composer = $('#composer'); if (composer) composer.onsubmit = (e) => { e.preventDefault(); send(q.value); };
    q.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q.value); } };
    const chips = $('#chips'); if (chips) chips.onclick = (e) => { const b = e.target.closest('.chip'); if (b) send(b.textContent); };
  }
  const cc = $('#clearChat'); if (cc) cc.onclick = () => { chat.length = 0; paintChat(); };
  $('#ctxBtn').onclick = async (e) => { const btn = e.currentTarget; const el = $('#ctx'); const open = el.hidden; if (open && !el.textContent) el.textContent = await (await api('/api/coach/context')).text(); el.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
}

function pageData() {
  const st = D.status;
  view.innerHTML = `${banner()}
  <header class="page"><div><h1>Data</h1><p>Upload your Google Health export, choose what’s shown and set your goals</p></div></header>
  <div class="grid g2">
    <div class="card"><h3>Showing now ${D.isSample ? '<span class="pill sample"><i></i>Sample data</span>' : '<span class="pill real"><i></i>Your data</span>'}</h3>
      <p style="margin:0 0 14px">${st.real.days ? `Your uploaded data covers <b>${st.real.days}</b> days (${dShort(st.real.range[0])} – ${dShort(st.real.range[1])}) and ${st.real.sleepSessions} sleep ${st.real.sleepSessions === 1 ? 'session' : 'sessions'}.` : 'No export uploaded yet, so the dashboards show generated <b>sample data</b>.'}</p>
      ${st.real.days ? `<div class="row"><button type="button" class="btn ghost" id="toggleSrc">${D.isSample ? 'Show my data' : 'Show sample data'}</button><button type="button" class="btn danger" id="clearReal">Delete uploaded data</button></div>` : ''}
      <h4>Sources</h4><div class="sources">${D.sources.map((s) => `<div class="s"><span><b>${esc(s.label)}</b><small>${esc(s.note)}</small></span>${s.available ? '<span class="pill real"><i></i>Ready</span>' : '<span class="pill">Planned</span>'}</div>`).join('')}</div>
    </div>
    <div class="card"><h3>Upload export</h3>
      <div class="drop" id="drop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg><p><b>Drop your Takeout .zip here</b><br>or the extracted <code>Takeout</code> folder, or individual JSON and CSV files</p>
        <div class="row" style="justify-content:center"><label class="btn" style="color:var(--on-accent)">Choose files<input type="file" id="fileIn" multiple accept=".zip,.json,.csv" hidden></label><label class="btn ghost">Choose folder<input type="file" id="dirIn" webkitdirectory multiple hidden></label></div></div>
      <div id="upStatus" class="note" role="status"></div><pre class="report" id="upReport" style="display:none"></pre>
      <p class="note">Files are parsed on this server. Results go to <code>data/store.json</code>, and the latest raw export is kept privately in <code>data/takeout-raw/</code> so it can be re-read. Uploading again merges new days in.</p>
    </div>
    <div class="card"><h3>How to get your export</h3>
      <h4 style="margin-top:0">Google Takeout (full history, recommended)</h4>
      <ol class="steps"><li>Open <a href="https://takeout.google.com/" target="_blank" rel="noopener">takeout.google.com</a> with the Google account you use in the Google Health app.</li>
      <li>Select <b>Deselect all</b>, then tick <b>Google Health</b> (it may still be called <b>Fitbit</b>).</li>
      <li>Select <b>Next step</b>, choose export once, <b>.zip</b>, 2 GB, then <b>Create export</b>.</li><li>When the email arrives (minutes to a day), download the zip and drop it here. For multi-part exports, drop all the zips together.</li></ol>
      <h4>Quick option (recent data)</h4>
      <ol class="steps"><li>In the Google Health app or your Google Account, open <b>Data & privacy</b>, then Google Health data, then export. The legacy fitbit.com <b>Data Export</b> (CSV or JSON) also works.</li></ol>
      <p class="note">Recognised: Google Health Takeout (Physical Activity and Health Fitness Data folders: steps, distance, calories, active and zone minutes, heart rate, resting heart rate, wrist temperature, weight, sleep and stages), Global Export Data JSON (reconciled steps, distance, calories, activity minutes, VO2 max), and the legacy Fitbit HRV, SpO2, breathing rate, readiness, stress and sleep score files. Phone, Health Connect and band copies of the same minutes are not double counted.</p>
    </div>
    <div class="card"><h3>Goals</h3>
      <form id="setForm" class="row" style="align-items:flex-end"><label>Daily step goal<br><input name="stepGoal" type="number" inputmode="numeric" min="1000" step="500" value="${D.settings.stepGoal}" style="width:150px;margin-top:6px"></label>
      <label>Sleep goal (hours)<br><input name="sleepH" type="number" inputmode="decimal" min="4" max="12" step="0.25" value="${D.settings.sleepGoalMinutes / 60}" style="width:130px;margin-top:6px"></label>
      <button class="btn">Save goals</button></form>
      <h4>Recent imports</h4>${st.real.imports.length ? `<div class="tablewrap"><table><tbody>${st.real.imports.slice().reverse().map((i) => `<tr><td>${new Date(i.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</td><td class="num">${i.source === 'health-connect' ? `Phone sync, ${i.days} days` : `${i.days} days, ${i.files} file${i.files === 1 ? '' : 's'}`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="calm">None yet.</p>'}
    </div>
  </div>`;
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async (e) => { const files = await filesFromDrop(e.dataTransfer); uploadFiles(files); });
  $('#fileIn').onchange = (e) => uploadFiles([...e.target.files].map((f) => ({ file: f, path: f.name })));
  $('#dirIn').onchange = (e) => uploadFiles([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
  const t = $('#toggleSrc'); if (t) t.onclick = async () => { await api('/api/source', { method: 'POST', body: JSON.stringify({ active: D.isSample ? 'real' : 'sample' }) }); await load(); render(); };
  const cr = $('#clearReal'); if (cr) cr.onclick = async () => { if (!confirm('Delete all uploaded data from this app? Your Google data is not affected.')) return; await api('/api/clear-real', { method: 'POST' }); await load(); render(); };
  $('#setForm').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); await api('/api/settings', { method: 'POST', body: JSON.stringify({ stepGoal: +f.get('stepGoal'), sleepGoalMinutes: Math.round(+f.get('sleepH') * 60) }) }); await load(); render(); };
  if (window.hcCard) window.hcCard(view.querySelector('.grid.g2')); // Phone sync (Health Connect) card, public/hc.js
}
async function filesFromDrop(dt) {
  const out = []; const items = [...(dt.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files].map((f) => ({ file: f, path: f.name }));
  const walk = (entry, p) => new Promise((res) => {
    if (entry.isFile) entry.file((f) => { out.push({ file: f, path: p + f.name }); res(); }, res);
    else { const rd = entry.createReader(); const all = []; const next = () => rd.readEntries(async (ents) => { if (!ents.length) { for (const e of all) await walk(e, p + entry.name + '/'); res(); } else { all.push(...ents); next(); } }, res); next(); }
  });
  for (const it of items) await walk(it, '');
  return out;
}
async function uploadFiles(list) {
  list = list.filter((x) => /\.(zip|json|csv)$/i.test(x.path));
  const s = $('#upStatus'); const rep = $('#upReport');
  if (!list.length) { s.textContent = 'No .zip, .json or .csv files found. Choose the Takeout zip or the files inside it.'; return; }
  const total = list.reduce((t, x) => t + x.file.size, 0);
  s.textContent = `Uploading ${list.length} file${list.length === 1 ? '' : 's'}, ${(total / 1048576).toFixed(1)} MB…`;
  const fd = new FormData(); for (const x of list) { fd.append('paths', x.path); fd.append('files', x.file, x.file.name); }
  const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) s.textContent = `Uploading… ${Math.round(e.loaded / e.total * 100)}%` + (e.loaded === e.total ? '. Parsing, large exports can take a minute…' : ''); };
  xhr.onload = async () => {
    let j = {}; try { j = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status === 401) return (location.href = '/login');
    if (xhr.status !== 200) { s.innerHTML = `<span style="color:var(--neg)">Upload failed: ${esc(j.error || xhr.status)}</span>`; return; }
    const r = j.report;
    s.innerHTML = j.ok ? `<span style="color:var(--pos)">Imported ${r.daysWithData} days (${r.dateRange[0]} to ${r.dateRange[1]}) and ${r.sleepSessions} sleep ${r.sleepSessions === 1 ? 'session' : 'sessions'}.</span> The dashboards now show your data.` : '<span style="color:var(--neg)">No recognisable health data in those files.</span> Check that you exported Google Health or Fitbit data.';
    rep.style.display = 'block'; rep.textContent = JSON.stringify({ recognisedFiles: r.byType, filesSeen: r.filesSeen, filesParsed: r.filesParsed, skipped: r.skippedCount, sampleSkipped: r.skipped.slice(0, 8), warnings: r.warnings.slice(0, 8) }, null, 2);
    if (j.ok) { await load(); srcPill(); }
  };
  xhr.onerror = () => { s.innerHTML = '<span style="color:var(--neg)">Network error during upload. Check your connection and try again.</span>'; };
  xhr.send(fd);
}

// ---------------- router ----------------
const PAGES = { today: pageToday, overview: pageOverview, sleep: pageSleep, activity: pageActivity, heart: pageHeart, coach: pageCoach, data: pageData };
function render(opts = {}) {
  if (!D) return;
  destroyCharts();
  const r = (location.hash.replace(/^#\//, '') || 'today').split('?')[0];
  document.querySelectorAll('nav a.tab').forEach((a) => { const on = a.dataset.r === r; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  view.classList.toggle('enter', firstPaint);
  if (D.empty && r !== 'data' && r !== 'coach') view.innerHTML = `${banner()}<div class="card empty"><p>No data yet.</p><a class="btn" href="#/data">Upload your export</a></div>`;
  else (PAGES[r] || pageToday)();
  bindRange(); srcPill();
  if (!opts.keepScroll) window.scrollTo(0, 0);
  if (firstPaint) { firstPaint = false; setTimeout(() => view.classList.remove('enter'), 900); }
  animMode = 'page';
}
window.addEventListener('hashchange', () => render());
// re-theme charts when the OS switches light/dark
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { chartDefaultsSet = false; render({ keepScroll: true }); });
$('#logout').onclick = async (e) => { e.preventDefault(); await api('/api/logout', { method: 'POST' }); location.href = '/login'; };
load().then(() => render()).catch((e) => { if (e.message !== 'auth') view.innerHTML = `<div class="card empty">Unable to load the dashboard: ${esc(e.message)}. Reload to try again.</div>`; });
