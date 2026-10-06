'use strict';
/** Capture README screenshots: identical desktop frame (1440×1000 @2x), sample data, name Alex. */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE || 'http://127.0.0.1:4870';
const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
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

async function login(page) {
  await page.goto(base + '/login');
  await page.fill('#p', pass);
  await page.click('button');
  await page.waitForURL(/\/$/);
}

async function prepSampleAlex(page) {
  await page.evaluate(async () => {
    await fetch('/api/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: 'sample' }),
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Alex' }),
    });
  });
}

async function restoreReal(page, name) {
  await page.evaluate(async (displayName) => {
    await fetch('/api/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: 'real' }),
    });
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
  }, name);
}

/** Hard navigation so /api/dashboard reloads with sample + Alex. */
async function openHash(page, hash) {
  await page.goto(base + '/?shot=' + Date.now() + hash, { waitUntil: 'networkidle' });
  await page.waitForSelector('header.page h1');
}

async function waitReady(page, { minCanvas = 1, noIntraday = false } = {}) {
  await page.waitForFunction(({ minCanvas, noIntraday }) => {
    const banner = document.querySelector('.banner');
    const canvases = [...document.querySelectorAll('canvas')].filter((c) => c.width > 0);
    if (!banner || canvases.length < minCanvas) return false;
    if (noIntraday && document.querySelector('#ihTitle')) return false;
    return true;
  }, { minCanvas, noIntraday }, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const errors = [];
  let priorName = 'Vansh';

  {
    const ctx = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      timezoneId: 'Asia/Kolkata',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('desktop: ' + e.message));

    await login(page);
    const st = await page.evaluate(async () => {
      const j = await (await fetch('/api/status')).json();
      return (j.settings && j.settings.displayName) || 'Vansh';
    });
    priorName = st;

    await prepSampleAlex(page);

    await openHash(page, '#/today');
    await waitReady(page, { minCanvas: 1 });
    console.log('today h1:', await page.locator('header.page h1').innerText());
    await page.screenshot({ path: path.join(outDir, 'desktop-today.png'), fullPage: false });
    console.log('wrote desktop-today.png');

    await openHash(page, '#/heart');
    await waitReady(page, { minCanvas: 2, noIntraday: true });
    console.log('heart h1:', await page.locator('header.page h1').innerText());
    await page.screenshot({ path: path.join(outDir, 'desktop-heart.png'), fullPage: false });
    console.log('wrote desktop-heart.png');

    await page.evaluate((sample) => {
      sessionStorage.setItem('chat', JSON.stringify([
        { role: 'user', content: 'How has my sleep been this week?' },
        { role: 'assistant', content: sample },
      ]));
    }, SAMPLE_COACH);
    await openHash(page, '#/coach');
    await page.evaluate(() => {
      const setup = document.getElementById('coachSetup');
      const chat = document.getElementById('coachChat');
      if (setup && chat && sessionStorage.getItem('chat')) {
        setup.hidden = true;
        chat.hidden = false;
      }
    });
    await page.waitForSelector('.banner', { timeout: 10000 });
    await page.waitForSelector('#coachChat:not([hidden]), .msg.assistant', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    console.log('coach h1:', await page.locator('header.page h1').innerText());
    await page.screenshot({ path: path.join(outDir, 'desktop-coach.png'), fullPage: false });
    console.log('wrote desktop-coach.png');

    await restoreReal(page, priorName);
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({
      viewport: MOBILE,
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      timezoneId: 'Asia/Kolkata',
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await login(page);
    await prepSampleAlex(page);
    await openHash(page, '#/today');
    await waitReady(page, { minCanvas: 1 });
    await page.screenshot({ path: path.join(outDir, 'mobile-today.png'), fullPage: false });
    console.log('wrote mobile-today.png');
    await restoreReal(page, priorName);
    await ctx.close();
  }

  await browser.close();

  const sizes = {};
  for (const name of ['desktop-today.png', 'desktop-heart.png', 'desktop-coach.png', 'mobile-today.png']) {
    const buf = fs.readFileSync(path.join(outDir, name));
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    sizes[name] = `${w}x${h}`;
    console.log('size', name, w, h);
  }
  const d = [sizes['desktop-today.png'], sizes['desktop-heart.png'], sizes['desktop-coach.png']];
  if (!(d[0] === d[1] && d[1] === d[2] && d[0] === '2880x2000')) {
    console.error('DESKTOP SIZE MISMATCH (want 2880x2000)', d);
    process.exit(2);
  }
  if (sizes['mobile-today.png'] !== '780x1688') {
    console.error('MOBILE SIZE MISMATCH (want 780x1688)', sizes['mobile-today.png']);
    process.exit(2);
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  else console.log('ok', { priorName, desktop: d[0], mobile: sizes['mobile-today.png'] });
})().catch((e) => { console.error(e); process.exit(1); });
