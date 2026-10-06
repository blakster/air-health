'use strict';
/** Screenshots: Coach SuperGrok setup disconnected + connected (mocked oauth file). */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const oauth = require('../lib/coachOAuth');

const base = 'http://localhost:4870';
const pass = fs.readFileSync(path.join(__dirname, '..', 'data', '.passcode'), 'utf8').trim();
const outDir = path.join(__dirname, '..', 'screenshots', 'v2', 'fathom-skin-v2');
fs.mkdirSync(outDir, { recursive: true });

function fakeJwt(expSec) {
  const b = Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url');
  return `hdr.${b}.sig`;
}

(async () => {
  // Ensure disconnected for first shot
  oauth.disconnect();
  const secrets = require('../lib/coachSecrets');
  // Don't wipe env keys if any - clear file secrets only for clean setup
  try { fs.rmSync(secrets.SECRETS_FILE(), { force: true }); } catch {}

  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];

  async function shot(name, hook) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.goto(base + '/login');
    await page.fill('#p', pass);
    await page.click('button');
    await page.waitForURL(base + '/');
    if (hook) await hook(page);
    await page.goto(base + '/#/coach');
    await page.reload();
    await page.waitForSelector('header.page');
    await page.waitForTimeout(900);
    // If connection panel might be hidden when configured, open it
    const conn = await page.$('#coachConnBtn');
    if (conn) {
      const setupHidden = await page.$eval('#coachSetup', (el) => el.hidden).catch(() => true);
      if (setupHidden) { await conn.click(); await page.waitForTimeout(400); }
    }
    await page.waitForSelector('.conn-grid, .setup', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const f = path.join(outDir, name);
    await page.screenshot({ path: f, fullPage: false });
    console.log('wrote', f);
    await ctx.close();
  }

  await shot('coach-supergrok-disconnected.png');

  // Mock connected OAuth (no real tokens usable, but UI shows Connected)
  oauth.writeAuth({
    tokens: {
      access_token: fakeJwt(Math.floor(Date.now() / 1000) + 7200),
      refresh_token: 'mock-refresh-for-screenshot-only',
    },
    connected_at: new Date().toISOString(),
    last_refresh: new Date().toISOString(),
  });

  await shot('coach-supergrok-connected.png');

  // Clean mock tokens after screenshots so we don't leave a fake login
  oauth.disconnect();

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
})().catch((e) => { console.error(e); process.exit(1); });
