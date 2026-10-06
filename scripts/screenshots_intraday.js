// Screenshots of the Heart page intraday card (desktop with a hover tooltip, and 390px mobile).
const { chromium } = require('playwright-core'); const fs = require('fs'); const path = require('path');
(async () => {
  const base = 'http://localhost:4870'; const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
  const out = path.join(__dirname, '..', 'screenshots', 'v2'); const errs = [];
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [vp, name, mobile] of [[{ width: 1440, height: 1000 }, 'real-heart-intraday', 0], [{ width: 390, height: 844 }, 'real-heart-intraday-mobile', 1]]) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, timezoneId: 'Asia/Kolkata', isMobile: !!mobile, hasTouch: !!mobile });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(base + '/login'); await p.fill('#p', pass); await p.click('button'); await p.waitForURL(base + '/');
    await p.goto(`${base}/#/heart`); await p.reload(); await p.waitForSelector('#ih[aria-busy="false"]'); await p.waitForTimeout(900);
    const info = await p.evaluate(() => ({ sub: document.querySelector('#ihSub')?.textContent, date: document.querySelector('#ihDate')?.textContent, prev: document.querySelector('#ihPrev')?.disabled, next: document.querySelector('#ihNext')?.disabled, stats: [...document.querySelectorAll('#ihStats > div')].map((d) => d.innerText.replace(/\s+/g, ' ')) }));
    const H = await p.evaluate(() => document.documentElement.scrollHeight); await p.setViewportSize({ width: vp.width, height: H }); await p.waitForTimeout(400);
    const box = await (await p.$('#ihc')).boundingBox();
    if (!mobile) { await p.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2); await p.waitForTimeout(300); }
    else { await p.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height / 2); await p.waitForTimeout(300); }
    const card = await p.$('#ih'); const cb = await card.boundingBox();
    await p.screenshot({ path: path.join(out, `${name}.png`), clip: { x: 0, y: 0, width: vp.width, height: Math.min(cb.y + cb.height + 24, H) } });
    console.log(name, JSON.stringify(info)); await ctx.close();
  }
  console.log(errs.length ? 'ERR ' + errs.join(' | ') : 'no page errors'); await b.close();
})();
