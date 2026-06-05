const { chromium } = require('playwright');
const path = require('path');
const FIX = __dirname;

async function uploadAndPreview(page, file) {
  await page.goto('http://localhost:5174/');
  await page.waitForTimeout(800);
  await page.locator('input[type=file]').setInputFiles(path.join(FIX, file));
  // Wait for PREVIEW (the "PREVIEWING PAGE" badge) or ERROR
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return t.includes('PREVIEWING PAGE') || t.includes('Sync Failed');
  }, null, { timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  page.on('pageerror', e => console.log(`[PAGEERROR] ${e.message}`));

  // ---------- EPUB ----------
  console.log('=== EPUB ===');
  await uploadAndPreview(page, 'sample.epub');
  // Is the preview image actually loaded (not broken)?
  const epubImg = await page.evaluate(() => {
    const img = document.querySelector('.bg-white img');
    return img ? { src: img.src.slice(0, 24), naturalWidth: img.naturalWidth } : null;
  });
  console.log('preview image:', JSON.stringify(epubImg));
  await page.screenshot({ path: path.join(FIX, 'v-epub-preview.png') });

  // Speed up, then play and wait for the image intercept (RESUME FLOW button)
  await page.evaluate(() => {
    const r = document.querySelector('input[type=range]');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(r, '2000'); r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('Space');
  const intercept = await page.waitForFunction(
    () => document.body.innerText.includes('RESUME FLOW'),
    null, { timeout: 15000 }
  ).then(() => true).catch(() => false);
  console.log('image intercept fired:', intercept);
  await page.screenshot({ path: path.join(FIX, 'v-epub-intercept.png') });

  // ---------- PDF ----------
  console.log('\n=== PDF ===');
  await uploadAndPreview(page, 'sample.pdf');
  const pdfImg = await page.evaluate(() => {
    const img = document.querySelector('.bg-white img');
    return img ? { src: img.src.slice(0, 24), naturalWidth: img.naturalWidth } : null;
  });
  console.log('preview image:', JSON.stringify(pdfImg));
  await page.screenshot({ path: path.join(FIX, 'v-pdf-preview.png') });

  // Play through at max speed and observe RSVP + progress climbing to 100%
  await page.evaluate(() => {
    const r = document.querySelector('input[type=range]');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(r, '2000'); r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(4500); // 3s preview + RSVP page 1
  await page.screenshot({ path: path.join(FIX, 'v-pdf-rsvp.png') });
  await page.waitForTimeout(7000); // page 2 preview + finish
  const finalProgress = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)%/);
    return m ? m[1] : null;
  });
  const pageLabel = await page.evaluate(() => {
    const m = document.body.innerText.match(/PAGE\s+(\d+)\s*\/\s*(\d+)/);
    return m ? m[0] : null;
  });
  console.log('final progress:', finalProgress + '%', '|', pageLabel);
  await page.screenshot({ path: path.join(FIX, 'v-pdf-end.png') });

  await browser.close();
})().catch(e => { console.error('DRIVER ERROR', e); process.exit(1); });
