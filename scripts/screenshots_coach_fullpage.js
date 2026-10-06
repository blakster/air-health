'use strict';
/** Screenshot Coach full-bleed (no nested chat box) layout. */
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  await page.goto(base + '/login');
  await page.fill('#p', pass);
  await page.click('button');
  await page.waitForURL(base + '/');
  await page.waitForSelector('header.top');
  await page.evaluate((sample) => {
    sessionStorage.setItem('chat', JSON.stringify([
      { role: 'user', content: 'How has my sleep been this week?' },
      { role: 'assistant', content: sample },
    ]));
  }, SAMPLE);
  await page.goto(base + '/?t=' + Date.now() + '#/coach', { waitUntil: 'networkidle' });
  await page.waitForSelector('#msgs .msg.assistant.md strong', { timeout: 15000 });
  await page.evaluate(() => {
    const setup = document.getElementById('coachSetup');
    if (setup) setup.hidden = true;
    const chat = document.getElementById('coachChat');
    if (chat) chat.hidden = false;
  });
  await page.waitForTimeout(500);

  const layout = await page.evaluate(() => {
    const chat = document.getElementById('coachChat');
    const cs = getComputedStyle(chat);
    const main = document.querySelector('main');
    return {
      hasCoachPage: !!document.querySelector('.coach-page'),
      chatBorder: cs.borderTopWidth,
      chatRadius: cs.borderRadius,
      chatHasCard: chat.classList.contains('card'),
      mainW: Math.round(main.getBoundingClientRect().width),
      chatW: Math.round(chat.getBoundingClientRect().width),
      mdOk: !!(document.querySelector('#msgs .msg.assistant.md strong') && document.querySelector('#msgs .msg.assistant.md ul li')),
    };
  });
  console.log('layout', JSON.stringify(layout));

  const f = path.join(outDir, 'coach-fullpage.png');
  await page.screenshot({ path: f, fullPage: false });
  console.log('wrote', f);
  await browser.close();

  const bad = [];
  if (!layout.hasCoachPage) bad.push('missing .coach-page');
  if (layout.chatHasCard) bad.push('chat still has .card');
  if (parseFloat(layout.chatBorder) > 0) bad.push('chat still bordered');
  if (parseFloat(layout.chatRadius) > 0) bad.push('chat still rounded');
  if (Math.abs(layout.chatW - layout.mainW) > 2) bad.push('chat not full main width');
  if (!layout.mdOk) bad.push('markdown not rendering');
  if (bad.length) { console.error('FAIL:', bad.join('; ')); process.exit(2); }
  console.log('layout checks ok');
})().catch((e) => { console.error(e); process.exit(1); });
