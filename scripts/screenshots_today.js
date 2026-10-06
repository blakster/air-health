// Today tab screenshots → screenshots/v2/fathom-skin-v2/today-*.png
const { chromium } = require('playwright-core');
const fs = require('fs'); const path = require('path');
(async () => {
  const base = 'http://localhost:4870';
  const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
  const outDir = path.join(__dirname, '..', 'screenshots', 'v2', 'fathom-skin-v2');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const plan = [
    [{ width: 1440, height: 1000 }, 'desktop'],
    [{ width: 390, height: 844 }, 'mobile'],
  ];
  for (const [vp, tag] of plan) {
    const ctx = await browser.newContext({
      viewport: vp, deviceScaleFactor: 2, colorScheme: 'dark',
      timezoneId: 'Asia/Kolkata', hasTouch: tag === 'mobile', isMobile: tag === 'mobile',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    await page.goto(base + '/login');
    await page.fill('#p', pass); await page.click('button'); await page.waitForURL(base + '/');
    await page.goto(`${base}/#/today`); await page.reload();
    await page.waitForSelector('header.page.dayhead, header.page');
    // Wait for HR chart or empty state
    await page.waitForTimeout(1800);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: vp.width, height: Math.max(h + 40, vp.height) });
    await page.waitForTimeout(500);
    const f = path.join(outDir, `today-${tag}.png`);
    await page.screenshot({ path: f, fullPage: false });
    console.log('wrote', f);
    // Also capture overview (diff cleanup) on desktop
    if (tag === 'desktop') {
      await page.goto(`${base}/#/overview`); await page.reload();
      await page.waitForSelector('header.page'); await page.waitForTimeout(1200);
      const h2 = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: vp.width, height: Math.max(h2 + 40, vp.height) });
      await page.waitForTimeout(400);
      const fo = path.join(outDir, 'desktop-overview.png');
      await page.screenshot({ path: fo, fullPage: false });
      console.log('wrote', fo);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
})().catch((e) => { console.error(e); process.exit(1); });
