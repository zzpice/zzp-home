const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = {'.html':'text/html', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json'};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const name = decodeURIComponent(url.pathname).replace(/^\/zzp-home\//, '/');
  const file = path.resolve(root, '.' + (name.endsWith('/') ? name + 'index.html' : name));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end(); return;
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await engine.launch();
    try {
      for (const [width, colorScheme] of [[1440,'light'], [390,'dark'], [768,'light'], [320,'dark']]) {
        const context = await browser.newContext({viewport:{width, height:900}, colorScheme, hasTouch:width < 500});
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const url of process.env.SITE_URL ? [process.env.SITE_URL] : [origin + '/', origin + '/zzp-home/']) {
          await page.goto(url);
          assert.equal(await page.locator('.project-card').count(), 3);
          assert.equal(await page.locator('.resource-card').count(), 4);
          assert.equal(await page.locator('link[rel="stylesheet"]').evaluate(el => !!el.sheet), true);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} ${width}px overflow`);
          assert.equal(await page.locator('a[target="_blank"]').evaluateAll(links => links.every(link => link.rel.includes('noopener'))), true);
          const labels = await page.locator('[aria-labelledby]').evaluateAll(links => links.every(link =>
            [link.getAttribute('aria-labelledby'), link.getAttribute('aria-describedby')].filter(Boolean)
              .every(ids => ids.split(' ').every(id => !!document.getElementById(id)))));
          assert.equal(labels, true);
          const hrefs = await page.locator('main a').evaluateAll(links => links.map(link => link.href));
          assert.equal(hrefs.every(href => /^https:\/\/(?:zzpice\.github\.io|github\.com)\//.test(href)), true);
          await page.keyboard.press('Tab');
          // WebKit follows the host's full-keyboard-access preference for links.
          if (name === 'WebKit') await page.locator('.skip-link').focus();
          assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('#main').evaluate(el => el === document.activeElement), true);
          await page.locator('summary').click();
          assert.equal(await page.locator('.install-guide').isVisible(), true);
          assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
        }
        assert.deepEqual(errors, []);
        await context.close();
      }
      console.log(`${name}: root/subpath, desktop/mobile/tablet, themes, keyboard, links and install guide passed`);
    } finally { await browser.close(); }
  }
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => server.close());
