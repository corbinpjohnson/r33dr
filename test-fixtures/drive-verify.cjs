// Temporary verification driver for page-skip + reading-view features.
const { chromium } = require('playwright');
const path = require('path');
const FIX = __dirname;
const BASE = process.env.VR_BASE ?? 'http://localhost:5174/';

async function upload(page, file) {
  await page.goto(BASE);
  await page.waitForTimeout(600);
  await page.locator('input[type=file]').setInputFiles(path.join(FIX, file));
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return t.includes('PREVIEWING PAGE') || t.includes('Sync Failed');
  }, null, { timeout: 60000 });
}

const pageLabel = (page) => page.evaluate(() => {
  const m = document.body.innerText.match(/PAGE\s+(\d+)\s*\/\s*(\d+)/);
  return m ? m[0] : null;
});

const maxWpm = (page) => page.evaluate(() => {
  const r = document.querySelector('input[type=range]');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(r, '2000'); r.dispatchEvent(new Event('input', { bubbles: true }));
});

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', e => console.log('[PAGEERROR]', e.message));

  for (const [name, file] of [['epub', 'sample.epub'], ['pdf', 'sample.pdf']]) {
    console.log(`\n=== ${name.toUpperCase()} ===`);
    await upload(page, file);

    // Prev disabled on page 1?
    const prevDisabled = await page.evaluate(() =>
      document.querySelector('button[title^="Previous page"]').disabled);

    const before = await pageLabel(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const fwd = await pageLabel(page);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);
    const back = await pageLabel(page);
    console.log(`page skip: ${before} --(->)-> ${fwd} --(<-)-> ${back} | prev-disabled-on-pg1=${prevDisabled}`);

    // Enter RSVP, capture faded page + highlight
    await maxWpm(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(3600); // past 3s preview into RSVP
    const rsvp = await page.evaluate(() => ({
      epubHighlight: !!document.querySelector('.vr-focus'),
      pdfRedBox: !!document.querySelector('span[class*="bg-red-500"]'),
      fadedPage: !!document.querySelector('[class*="opacity-25"]'),
    }));
    console.log('rsvp:', JSON.stringify(rsvp));
    await page.screenshot({ path: path.join(FIX, `verify-${name}-rsvp.png`) });
    await page.keyboard.press('Space');
  }

  // Responsive growth: panel height should scale with viewport height.
  console.log('\n=== RESPONSIVE ===');
  await upload(page, 'sample.epub');
  const measure = () => page.evaluate(() => {
    const el = document.querySelector('div.bg-slate-950.rounded-3xl');
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(300);
  const small = await measure();
  await page.setViewportSize({ width: 1600, height: 1300 });
  await page.waitForTimeout(300);
  const large = await measure();
  console.log(`panel height: 700vp=${small}px  1300vp=${large}px  (grew=${large > small})`);
  await page.screenshot({ path: path.join(FIX, 'verify-responsive-large.png') });

  await browser.close();
})().catch(e => { console.error('DRIVER ERROR', e); process.exit(1); });
