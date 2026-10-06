'use strict';
/** Screenshot Coach: no nested msgs scrollbar; page scrolls. */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const base = 'http://localhost:4870';
const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
const outDir = path.join(__dirname, '..', 'screenshots', 'v2', 'fathom-skin-v2');
fs.mkdirSync(outDir, { recursive: true });

const longReply = `## Sleep check

Your **resting HR** is up *slightly* this week versus your 30-day baseline.

- Aim for **7h+** sleep most nights
- Keep bedtime within a 30-minute window
- Watch \`HRV\` on recovery days
- Steps look solid — keep the weekday streak going

\`\`\`
avg sleep: 6h 42m
resting HR: 62 → 65
\`\`\`

More detail sits in overview if you want day-by-day.`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata' });
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
      { role: 'user', content: 'And my resting heart rate?' },
      { role: 'assistant', content: sample },
      { role: 'user', content: 'Any recovery tips for tomorrow?' },
      { role: 'assistant', content: sample },
    ]));
  }, longReply);
  await page.goto(base + '/?t=' + Date.now() + '#/coach', { waitUntil: 'networkidle' });
  await page.waitForSelector('#msgs .msg.assistant.md strong', { timeout: 15000 });
  await page.evaluate(() => {
    const setup = document.getElementById('coachSetup');
    if (setup) setup.hidden = true;
    const chat = document.getElementById('coachChat');
    if (chat) chat.hidden = false;
  });
  await page.waitForTimeout(400);

  const check = await page.evaluate(() => {
    const msgs = document.getElementById('msgs');
    const chat = document.getElementById('coachChat');
    const composer = document.getElementById('composer');
    const ms = getComputedStyle(msgs);
    const cs = getComputedStyle(chat);
    const cos = getComputedStyle(composer);
    return {
      msgsOverflow: ms.overflowY,
      chatOverflow: cs.overflowY,
      msgsScrollH: msgs.scrollHeight,
      msgsClientH: msgs.clientHeight,
      msgsCanScroll: msgs.scrollHeight > msgs.clientHeight + 1,
      composerSticky: cos.position,
      composerBottom: cos.bottom,
      docScrollable: document.documentElement.scrollHeight > window.innerHeight + 20,
      msgCount: document.querySelectorAll('#msgs .msg').length,
    };
  });
  console.log('check', JSON.stringify(check, null, 2));

  const f = path.join(outDir, 'coach-noscroll-box.png');
  await page.screenshot({ path: f, fullPage: false });
  console.log('wrote', f);

  // Also scroll mid-page and reshoot to show page scroll + sticky composer
  await page.evaluate(() => window.scrollTo(0, Math.min(280, document.documentElement.scrollHeight)));
  await page.waitForTimeout(200);
  const f2 = path.join(outDir, 'coach-noscroll-scrolled.png');
  await page.screenshot({ path: f2, fullPage: false });
  console.log('wrote', f2);

  await browser.close();

  const bad = [];
  if (check.msgsOverflow !== 'visible') bad.push(`msgs overflowY=${check.msgsOverflow}`);
  if (check.chatOverflow !== 'visible') bad.push(`chat overflowY=${check.chatOverflow}`);
  if (check.msgsCanScroll) bad.push('msgs still has inner scroll range');
  if (check.composerSticky !== 'sticky') bad.push(`composer not sticky (${check.composerSticky})`);
  if (check.msgCount < 4) bad.push('expected seeded messages');
  if (bad.length) { console.error('FAIL:', bad.join('; ')); process.exit(2); }
  console.log('noscroll checks ok');
})().catch((e) => { console.error(e); process.exit(1); });
