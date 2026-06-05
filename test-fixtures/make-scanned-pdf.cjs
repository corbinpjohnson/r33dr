// Builds an image-only ("scanned") PDF: text rendered to a JPEG, embedded as a
// DCTDecode image XObject — so it has NO text layer and forces the OCR path.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function renderTextJpeg() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(() => {
    const W = 800, H = 300;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.font = '40px serif';
    ctx.fillText('Scanned page reads clearly', 40, 120);
    ctx.fillText('via offline OCR engine', 40, 190);
    return c.toDataURL('image/jpeg', 0.9);
  });
  await browser.close();
  const b64 = dataUrl.split(',')[1];
  return { jpeg: Buffer.from(b64, 'base64'), W: 800, H: 300 };
}

function buildScannedPdf(jpeg, W, H) {
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = (buf) => { const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'binary'); parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); push(body); push(`\nendobj\n`); };

  push('%PDF-1.4\n');
  obj(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  obj(2, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`);
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  // Image XObject with raw JPEG stream (DCTDecode).
  offsets[5] = len;
  push(`5 0 obj\n`);
  push(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push(`\nendstream\nendobj\n`);

  const xrefStart = len;
  const count = 6;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return Buffer.concat(parts);
}

(async () => {
  const { jpeg, W, H } = await renderTextJpeg();
  const pdf = buildScannedPdf(jpeg, W, H);
  const out = path.join(__dirname, 'scanned.pdf');
  fs.writeFileSync(out, pdf);
  console.log('Wrote', out, pdf.length, 'bytes (JPEG', jpeg.length, 'bytes)');
})().catch(e => { console.error(e); process.exit(1); });
