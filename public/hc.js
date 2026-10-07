/* Air Health — Data page card "Phone sync (Health Connect)". Loaded before app.js; pageData() calls window.hcCard(grid). */
(function () {
  const style = document.createElement('style');
  style.textContent = `
  .hc .paircode{font-family:var(--serif);font-size:2.1rem;letter-spacing:.08em;font-variant-numeric:tabular-nums;margin:4px 0 2px}
  .hc .pairbox{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:14px;border-radius:var(--r-ctl);background:var(--sheet-2);box-shadow:inset 0 0 0 1px var(--rule);margin:12px 0}
  .hc .qr{width:148px;height:148px;background:#fff;border-radius:8px;padding:6px;flex:none}.hc .qr svg{width:100%;height:100%;display:block}
  .hc dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 4px;font-size:.875rem}.hc dt{color:var(--text-3)}.hc dd{margin:0;font-variant-numeric:tabular-nums}
  .hc .types{color:var(--text-3);font-size:.8125rem}.hc a.btn{text-decoration:none}`;
  document.head.appendChild(style);

  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ist = (t) => (t ? `${new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} IST` : '—');
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  const day = (d) => { const x = new Date(d + 'T00:00:00Z'); return `${x.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()]}`; };
  const TYPE = { Steps: 'steps', Distance: 'distance', TotalCaloriesBurned: 'calories', ActiveCaloriesBurned: 'active calories', HeartRate: 'heart rate', RestingHeartRate: 'resting HR', HeartRateVariabilityRmssd: 'HRV', SleepSession: 'sleep', OxygenSaturation: 'SpO₂', RespiratoryRate: 'breathing', SkinTemperature: 'skin temp', Vo2Max: 'VO₂ max', ExerciseSession: 'workouts', Weight: 'weight' };
  let timer = null;

  async function post(path, body) { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); if (r.status === 401) { location.href = '/login'; throw new Error('auth'); } return r.json(); }

  function body(s) {
    const apk = s.apk ? `<a class="btn ghost" href="${e(s.apk.url)}" download>Download Android app (${mb(s.apk.size)})</a>` : '<span class="calm">The Android app has not been built yet.</span>';
    if (!s.paired) return `
      <p style="margin:0 0 4px">Sync your Fitbit Air about every 15 minutes through Health Connect on your Android phone, instead of exporting.</p>
      <ol class="steps"><li>On the phone, open this dashboard (over Tailscale) and download the app. Allow your browser to install unknown apps when Android asks.</li>
      <li>In the Google Health app, tap <b>Connections › Partner apps › Sync your favorite health apps › Set up</b> and allow all, so the Air's data is shared to Health Connect.</li><li>Open <b>Air Health Sync</b>, then select <b>Pair phone</b> below and enter the code, or scan the QR code with the phone camera.</li></ol>
      <div class="row">${apk}<button type="button" class="btn" id="hcPair">Pair phone</button></div><div id="hcCode"></div>`;
    const origins = s.origins.length ? `<h4>Where the data comes from</h4><div class="sources">${s.origins.map((o) => `<div class="s"><span><b>${e(o.label)}</b><small>${e(o.pkg)}${o.devices?.length ? ` · ${e(o.devices.join(', '))}` : ''}</small><small class="types">${Object.entries(o.types).filter(([, n]) => n).map(([t, n]) => `${e(TYPE[t] || t)} ${n.toLocaleString('en-IN')}`).join(' · ') || 'no new records'}</small></span>${o.preferred ? '<span class="pill real"><i></i>Preferred</span>' : '<span class="pill">Fallback</span>'}</div>`).join('')}</div>` : '';
    return `
      <dl><dt>Phone</dt><dd>${e(s.device.name)}</dd><dt>Paired</dt><dd>${ist(s.device.pairedAt)}</dd><dt>Last sync</dt><dd>${s.lastIngestAt ? ist(s.lastIngestAt) : 'Waiting for the first sync'}</dd>
      <dt>Synced days</dt><dd>${s.days ? `${s.days} (${day(s.range[0])} – ${day(s.range[1])})` : '—'}</dd><dt>Records</dt><dd>${(s.records || 0).toLocaleString('en-IN')}</dd></dl>
      ${origins}
      <p class="note">For days the phone has synced, its numbers replace the export's, metric by metric. Steps, distance and calories come from one source per day (the Google Health app first), so phone and band are never added together.</p>
      <div class="row" style="margin-top:14px">${apk}<button type="button" class="btn" id="hcSleepResync" title="Phone re-reads SleepSession for the last 3 nights only (no full history). Needs Air Health Sync 1.1.1+.">${s.sleepResync ? `Sleep recovery requested (${s.sleepResync.days} nights)` : 'Recover last-night sleep'}</button><button type="button" class="btn ghost" id="hcResync" title="The phone sends its whole history again at its next sync">${s.resync ? 'Full resend requested' : 'Resend everything'}</button><button type="button" class="btn ghost" id="hcPair">Pair a different phone</button><button type="button" class="btn danger" id="hcUnpair">Unpair</button></div><div id="hcCode"></div>`;
  }

  function showCode(j) {
    const box = document.getElementById('hcCode'); if (!box) return;
    clearInterval(timer);
    const tick = () => {
      const left = Math.max(0, Math.round((j.expiresAt - Date.now()) / 1000));
      const t = document.getElementById('hcLeft'); if (t) t.textContent = left ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired. Make a new code.';
      if (!left) clearInterval(timer);
    };
    box.innerHTML = `<div class="pairbox">${j.qr ? `<div class="qr" aria-label="Pairing QR code">${j.qr}</div>` : ''}<div><div class="note" style="margin:0">Pairing code for Air Health Sync</div><div class="paircode">${e(j.code)}</div>
      <div class="note" style="margin:0" id="hcLeft"></div><div class="note">Server address: <code>${e(j.server)}</code>. The code works once. The phone then gets its own private key; the code is not a password for this site.</div></div></div>`;
    tick(); timer = setInterval(tick, 1000);
    // Refresh the card once the phone has paired.
    const poll = setInterval(async () => { if (!document.getElementById('hcCode')) return clearInterval(poll); const s = await (await fetch('/api/hc/info')).json(); if (!s.pairingActive) { clearInterval(poll); clearInterval(timer); render(s); } }, 3000);
  }

  let card = null;
  function render(s) {
    if (!card || !card.isConnected) return;
    card.innerHTML = `<h3>Phone sync (Health Connect) ${s.paired ? '<span class="pill real"><i></i>Paired</span>' : '<span class="pill">Not paired</span>'}</h3>${body(s)}`;
    const p = card.querySelector('#hcPair'); if (p) p.onclick = async () => { if (s.paired && !confirm('Pair a different phone? The current phone will stop syncing.')) return; p.disabled = true; try { showCode(await post('/api/hc/pair')); } finally { p.disabled = false; } };
    const sl = card.querySelector('#hcSleepResync'); if (sl) sl.onclick = async () => { sl.disabled = true; try { render(await post('/api/hc/resync', { sleep: true, days: 3 })); } finally { sl.disabled = false; } };
    const rs = card.querySelector('#hcResync'); if (rs) rs.onclick = async () => { if (!confirm('Resend the phone\'s whole Health Connect history? This is slow. Prefer "Recover last-night sleep" when only sleep is missing.')) return; render(await post('/api/hc/resync')); };
    const u = card.querySelector('#hcUnpair'); if (u) u.onclick = async () => { if (!confirm('Unpair this phone? It stops syncing. Data already synced stays on the dashboard.')) return; render(await post('/api/hc/unpair')); };
  }

  window.hcCard = async function (grid) {
    if (!grid) return;
    card = document.createElement('div'); card.className = 'card hc'; card.innerHTML = '<h3>Phone sync (Health Connect)</h3><p class="calm">Loading…</p>';
    const first = grid.firstElementChild; grid.insertBefore(card, first ? first.nextSibling : null);
    try { const r = await fetch('/api/hc/info'); if (r.status === 401) return (location.href = '/login'); render(await r.json()); }
    catch (err) { card.innerHTML = `<h3>Phone sync (Health Connect)</h3><p class="calm">Couldn't load phone sync status (${e(err.message)}).</p>`; }
  };
})();
