'use strict';
/** Capture README screenshots: Today, Heart, Coach (sample data, current fathom-skin UI). */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE || 'http://127.0.0.1:4870';
const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const SAMPLE_COACH = `## Sleep check

Your **resting HR** is steady on the sample set.

- Aim for **7h 30m** sleep
- Keep bedtime within a 30-minute window
- Watch HRV on easier days

\`\`\`
avg sleep: 7h 12m
resting HR: 60
\`\`\`

Ask about recovery, steps, or heart-rate patterns anytime.`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];

  // Desktop captures
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      timezoneId: 'Asia/Kolkata',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('desktop: ' + e.message));

    await page.goto(base + '/login');
    await page.fill('#p', pass);
    await page.click('button');
    await page.waitForURL(/\/$/);

    await page.evaluate(async () => {
      await fetch('/api/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: 'sample' }),
      });
    });

    // Ensure sample banner visible / charts painted
    await page.goto(base + '/#/today');
    await page.waitForSelector('header.page h1');
    await page.waitForTimeout(1200);
    // Sample banner should be present
    const sample = await page.locator('.banner, .srcline').count();
    console.log('sample markers', sample);

    await page.screenshot({ path: path.join(outDir, 'desktop-today.png'), fullPage: true });
    console.log('wrote desktop-today.png');

    await page.goto(base + '/#/heart');
    await page.waitForSelector('header.page h1');
    // Heart is trend charts only (intraday + zones live on Today)
    await page.waitForFunction(() => {
      const banner = document.querySelector('.banner');
      const canvases = [...document.querySelectorAll('canvas')].filter((c) => c.width > 0);
      return banner && canvases.length >= 2 && !document.querySelector('#ihTitle');
    }, { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, 'desktop-heart.png'), fullPage: true });
    console.log('wrote desktop-heart.png');

    // Coach with injected sample conversation (full-bleed layout)
    await page.evaluate((sample) => {
      sessionStorage.setItem('chat', JSON.stringify([
        { role: 'user', content: 'How has my sleep been this week?' },
        { role: 'assistant', content: sample },
      ]));
    }, SAMPLE_COACH);
    await page.goto(base + '/?t=' + Date.now() + '#/coach', { waitUntil: 'networkidle' });
    await page.waitForSelector('header.page h1');
    await page.waitForTimeout(800);
    // Prefer chat view if setup is showing
    await page.evaluate(() => {
      const setup = document.getElementById('coachSetup');
      const chat = document.getElementById('coachChat');
      if (setup && chat && sessionStorage.getItem('chat')) {
        setup.hidden = true;
        chat.hidden = false;
      }
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, 'desktop-coach.png'), fullPage: false });
    console.log('wrote desktop-coach.png');

    await ctx.close();
  }

  // Mobile Today (for README mobile slot)
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      timezoneId: 'Asia/Kolkata',
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(base + '/login');
    await page.fill('#p', pass);
    await page.click('button');
    await page.waitForURL(/\/$/);
    await page.goto(base + '/#/today');
    await page.waitForSelector('header.page h1');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, 'mobile-today.png'), fullPage: false });
    console.log('wrote mobile-today.png');
    await ctx.close();
  }

  await browser.close();
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  else console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
