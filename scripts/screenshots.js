// Headless screenshots of every page. Usage: node scripts/screenshots.js [baseUrl] [passcode] [prefix]
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
(async () => {
  const base = process.argv[2] || 'http://localhost:4870';
  const pass = process.argv[3] || fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
  const prefix = process.argv[4] || '';
  const outDir = path.join(__dirname, '..', 'screenshots'); fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  for (const [vp, tag] of [[{ width: 1440, height: 1000 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: tag === 'mobile' ? 2 : 1, colorScheme: 'light', timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    await page.goto(base + '/login');
    await page.fill('#p', pass); await page.click('button');
    await page.waitForURL(base + '/');
    const pages = tag === 'desktop' ? ['overview', 'sleep', 'activity', 'heart', 'coach', 'data'] : ['overview', 'sleep', 'coach'];
    for (const p of pages) {
      await page.goto(`${base}/#/${p}`); await page.reload();
      await page.waitForSelector('header.page'); await page.waitForTimeout(900);
      const nCharts = await page.$$eval('canvas', (cs) => cs.filter((c) => c.width > 0 && c.height > 0).length);
      if (process.env.ASK && p === 'coach') { await page.fill('#q', process.env.ASK); await page.press('#q', 'Enter'); await page.waitForSelector('.msg.user ~ .msg.assistant:not(.muted), .msg.sys', { timeout: 20000 }); }
      const f = path.join(outDir, `${prefix}${tag}-${p}.png`);
      await page.screenshot({ path: f, fullPage: tag === 'desktop' && p !== 'coach' });
      console.log(`${f}  charts=${nCharts}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
})();
