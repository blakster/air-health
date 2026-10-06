'use strict';
/** Capture light-theme README shots: Today + Heart on sample data. */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE || 'http://127.0.0.1:4870';
const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const DESKTOP = { width: 1440, height: 1000 };

async function login(page) {
  await page.goto(base + '/login');
  await page.fill('#p', pass);
  await page.click('button');
  await page.waitForURL(/\/$/);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const errors = [];
  let priorName = 'Vansh';

  const ctx = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
    colorScheme: 'light',
    timezoneId: 'Asia/Kolkata',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));

  await login(page);
  priorName = await page.evaluate(async () => {
    const j = await (await fetch('/api/status')).json();
    return (j.settings && j.settings.displayName) || 'Vansh';
  });

  await page.evaluate(async () => {
    localStorage.setItem('air-theme', 'light');
    await fetch('/api/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: 'sample' }) });
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Alex' }) });
  });

  for (const [hash, file, opts] of [
    ['#/today', 'desktop-today-light.png', { minCanvas: 1 }],
    ['#/heart', 'desktop-heart-light.png', { minCanvas: 2, noIntraday: true }],
  ]) {
    await page.goto(base + '/?shot=' + Date.now() + hash, { waitUntil: 'networkidle' });
    await page.waitForSelector('header.page h1');
    await page.evaluate(() => {
      localStorage.setItem('air-theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.style.colorScheme = 'light';
    });
    // force chart retheme after data-theme applied
    await page.evaluate(async () => {
      if (typeof applyTheme === 'function') applyTheme('light');
      if (typeof setThemePref === 'function') {
        /* keep light saved */
      }
    });
    await page.waitForFunction(({ minCanvas, noIntraday }) => {
      const banner = document.querySelector('.banner');
      const canvases = [...document.querySelectorAll('canvas')].filter((c) => c.width > 0);
      if (!banner || canvases.length < minCanvas) return false;
      if (noIntraday && document.querySelector('#ihTitle')) return false;
      const t = document.documentElement.getAttribute('data-theme');
      return t === 'light';
    }, opts, { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    // trigger re-render so charts pick light tokens
    await page.evaluate(() => {
      if (typeof chartDefaultsSet !== 'undefined') chartDefaultsSet = false;
      if (typeof render === 'function') render({ keepScroll: true });
    });
    await page.waitForTimeout(900);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    console.log(file, 'theme=', theme, 'bg=', bg, 'h1=', await page.locator('header.page h1').innerText());
    await page.screenshot({ path: path.join(outDir, file), fullPage: false });
    console.log('wrote', file);
  }

  await page.evaluate(async (displayName) => {
    localStorage.removeItem('air-theme');
    await fetch('/api/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: 'real' }) });
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
  }, priorName);

  await ctx.close();
  await browser.close();

  for (const name of ['desktop-today-light.png', 'desktop-heart-light.png']) {
    const buf = fs.readFileSync(path.join(outDir, name));
    console.log('size', name, buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  else console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
