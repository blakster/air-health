'use strict';
/** Screenshot Coach chat with a sample markdown assistant reply. */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const base = 'http://localhost:4870';
const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
const outDir = path.join(__dirname, '..', 'screenshots', 'v2', 'fathom-skin-v2');
fs.mkdirSync(outDir, { recursive: true });

const SAMPLE = `## Sleep check

Your **resting HR** is up *slightly* this week.

- Aim for **7h+** sleep
- Keep bedtime within a 30-minute window
- Watch \`HRV\` on recovery days

\`\`\`
avg sleep: 6h 42m
resting HR: 62 → 65
\`\`\`

More tips in the [overview](https://example.com/overview).`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(base + '/login');
  await page.fill('#p', pass);
  await page.click('button');
  await page.waitForURL(base + '/');
  await page.goto(base + '/#/coach');
  await page.waitForSelector('#msgs, #coachSetup, header.page', { timeout: 10000 });
  await page.waitForTimeout(600);

  // Ensure chat is visible (hide setup if open)
  await page.evaluate(() => {
    const setup = document.getElementById('coachSetup');
    const chat = document.getElementById('coachChat');
    if (setup) setup.hidden = true;
    if (chat) chat.hidden = false;
  });

  // Inject sample conversation into sessionStorage + re-render via paint path
  await page.evaluate((sample) => {
    const msgs = [
      { role: 'user', content: 'How has my sleep been this week?' },
      { role: 'assistant', content: sample },
    ];
    sessionStorage.setItem('chat', JSON.stringify(msgs));
    // Force re-load of chat array: app keeps in-memory `chat` — navigate to trigger re-read... but chat is const from sessionStorage at load.
    // So mutate the live chat array if we can reach it, else reload.
    location.hash = '#/coach';
    location.reload();
  }, SAMPLE);

  await page.waitForSelector('#msgs .msg.assistant.md', { timeout: 15000 });
  await page.waitForTimeout(800);

  // Confirm markdown rendered (strong/list present, not raw **)
  const ok = await page.evaluate(() => {
    const el = document.querySelector('#msgs .msg.assistant.md');
    if (!el) return { ok: false, reason: 'no md bubble' };
    const hasStrong = !!el.querySelector('strong');
    const hasList = !!el.querySelector('ul li');
    const hasCode = !!el.querySelector('code');
    const hasPre = !!el.querySelector('pre');
    const hasH = !!el.querySelector('h2');
    const rawStars = (el.textContent || '').includes('**resting');
    return { ok: hasStrong && hasList && hasCode && hasPre && hasH && !rawStars, hasStrong, hasList, hasCode, hasPre, hasH, rawStars, html: el.innerHTML.slice(0, 280) };
  });
  console.log('md check', JSON.stringify(ok, null, 2));

  const f = path.join(outDir, 'coach-markdown.png');
  await page.screenshot({ path: f, fullPage: false });
  console.log('wrote', f);

  await browser.close();
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  else console.log('no page errors');
  if (!ok.ok) process.exit(2);
})().catch((e) => { console.error(e); process.exit(1); });
