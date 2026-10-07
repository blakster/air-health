'use strict';
/** Today scrub interaction shots — sleep hypnogram + steps (light & dark). */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE || 'http://127.0.0.1:4870';
const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
const outDir = path.join(__dirname, '..', 'screenshots', 'v2');
fs.mkdirSync(outDir, { recursive: true });

async function login(page) {
  await page.goto(base + '/login');
  await page.fill('#p', pass);
  await page.click('button');
  await page.waitForURL(/\/$/);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('air-theme', t);
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = t;
    if (typeof applyTheme === 'function') applyTheme(t);
  }, theme);
}

async function hoverMid(page, sel) {
  const box = await page.locator(sel).boundingBox();
  if (!box) throw new Error('no box for ' + sel);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55);
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const errors = [];
  const vp = { width: 1440, height: 1100 };

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 2,
      colorScheme: theme,
      timezoneId: 'Asia/Kolkata',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${theme} console: ${m.text()}`); });

    await login(page);
    await setTheme(page, theme);
    await page.goto(`${base}/#/today`);
    await page.reload({ waitUntil: 'networkidle' });
    await setTheme(page, theme);
    await page.waitForSelector('.today-sleep, header.page.dayhead');
    await page.waitForTimeout(1600);

    // Full Today page
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h + 40, vp.height), 3200) });
    await page.waitForTimeout(400);
    const full = path.join(outDir, `today-scrub-${theme}.png`);
    await page.screenshot({ path: full, fullPage: false });
    console.log('wrote', full);

    // Sleep hypnogram scrub
    const sleepHost = page.locator('[data-scrub="sleep-hypno"], [data-scrub="sleep-band"]').first();
    if (await sleepHost.count()) {
      await sleepHost.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await hoverMid(page, '[data-scrub="sleep-hypno"], [data-scrub="sleep-band"]');
      const readout = await page.locator('#sleepScrub').innerText();
      console.log(theme, 'sleep readout:', JSON.stringify(readout));
      const sleepShot = path.join(outDir, `today-sleep-scrub-${theme}.png`);
      // crop-ish: section
      const sec = page.locator('.today-sleep');
      await sec.screenshot({ path: sleepShot });
      console.log('wrote', sleepShot);
    } else {
      console.log(theme, 'no sleep scrub host');
    }

    // Steps scrub
    const stepsHost = page.locator('[data-scrub="steps-day"]').first();
    if (await stepsHost.count()) {
      await stepsHost.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await hoverMid(page, '[data-scrub="steps-day"]');
      const readout = await page.locator('#stepsScrub').innerText();
      console.log(theme, 'steps readout:', JSON.stringify(readout));
      const stepsShot = path.join(outDir, `today-steps-scrub-${theme}.png`);
      await page.locator('.today-steps').screenshot({ path: stepsShot });
      console.log('wrote', stepsShot);
    } else {
      console.log(theme, 'no steps scrub host');
    }

    // Heart already scrubbed — capture readout area while hovering
    const ih = page.locator('#ihc');
    if (await ih.count()) {
      await ih.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await hoverMid(page, '#ihc');
      const hr = await page.locator('#ihReadout').innerText().catch(() => '');
      console.log(theme, 'heart readout:', JSON.stringify(hr));
      const heartShot = path.join(outDir, `today-heart-scrub-${theme}.png`);
      await page.locator('#ih').screenshot({ path: heartShot });
      console.log('wrote', heartShot);
    }

    await ctx.close();
  }

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
})().catch((e) => { console.error(e); process.exit(1); });
