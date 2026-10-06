const { chromium } = require('/workspace/fitbit-air-app/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const base = 'http://localhost:4870'; const pass = fs.readFileSync('/workspace/fitbit-air-app/data/.passcode', 'utf8').trim();
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  for (const [vp, name, route, mobile] of [['overview'],['sleep'],['activity'],['heart'],['coach'],['data']].map(([r])=>[{ width: 1440, height: 1000 }, 'real-'+r, r]).concat([[{ width: 390, height: 844 }, 'real-overview-mobile', 'overview', 1],[{ width: 390, height: 844 }, 'real-heart-mobile', 'heart', 1]])) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata', isMobile: !!mobile, hasTouch: !!mobile });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(base + '/login'); await p.fill('#p', pass); await p.click('button'); await p.waitForURL(base + '/');
    await p.goto(`${base}/#/${route}`); await p.reload(); await p.waitForSelector('header.page'); await p.waitForTimeout(1500);
    const banner = await p.$('.banner'); const h = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.setViewportSize({ width: vp.width, height: h }); await p.waitForTimeout(500);
    await p.screenshot({ path: `/workspace/fitbit-air-app/screenshots/v2/${name}.png` });
    console.log(name, 'sampleBanner=', !!banner, 'empty panels=', await p.$$eval('.is-empty', (e) => e.length), 'canvases=', await p.$$eval('canvas', (e) => e.length)); await ctx.close();
  }
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors'); await b.close();
})();
