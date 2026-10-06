// v2 screenshots. Usage: node scripts/screenshots_v2.js [outSubdir] [colorScheme]
const { chromium } = require('playwright-core');
const fs = require('fs'); const path = require('path');
(async () => {
  const base = 'http://localhost:4870';
  const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
  const sub = process.argv[2] || 'v2'; const scheme = process.argv[3] || 'light';
  const outDir = path.join(__dirname, '..', 'screenshots', sub); fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const plan = [[{ width: 1440, height: 1000 }, 'desktop', ['today', 'overview', 'sleep', 'activity', 'heart', 'coach', 'data']], [{ width: 390, height: 844 }, 'mobile', ['today', 'overview', 'sleep', 'heart', 'coach']]];
  for (const [vp, tag, pages] of plan) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: scheme, timezoneId: 'Asia/Kolkata', hasTouch: tag === 'mobile', isMobile: tag === 'mobile' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${tag} console ${m.type()}: ${m.text()}`); });
    page.on('requestfailed', (r) => errors.push(`${tag} reqfailed: ${r.url()}`));
    await page.goto(base + '/login');
    if (tag === 'desktop' && sub === 'v2') await page.screenshot({ path: path.join(outDir, 'desktop-login.png') });
    await page.fill('#p', pass); await page.click('button'); await page.waitForURL(base + '/');
    for (const p of pages) {
      await page.goto(`${base}/#/${p}`); await page.reload();
      await page.waitForSelector('header.page'); await page.waitForTimeout(1200);
      const f = path.join(outDir, `${tag}-${p}.png`);
      const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).join(','));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (p !== 'coach') { const h = await page.evaluate(() => document.documentElement.scrollHeight); await page.setViewportSize({ width: vp.width, height: Math.max(h, vp.height) }); await page.waitForTimeout(700); }
      await page.screenshot({ path: f });
      await page.setViewportSize(vp);
      console.log(`${f} fonts=[${fonts}] hOverflow=${overflow}`);
    }
    if (tag === 'desktop') { // hover tooltip check on overview
      await page.goto(`${base}/#/overview`); await page.reload(); await page.waitForTimeout(1200);
      const box = await (await page.$('#c1')).boundingBox(); await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5); await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, 'desktop-tooltip.png'), clip: { x: box.x - 30, y: box.y - 60, width: box.width + 60, height: box.height + 90 } });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
})();
