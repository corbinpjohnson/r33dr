// Generates a minimal valid 2-page text PDF for verifying r33dr's PDF path.
const fs = require('fs');
const path = require('path');

function buildPdf() {
  const objects = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>`;
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`;
  const stream1 = `BT /F1 20 Tf 72 720 Td (Chapter One of the PDF) Tj 0 -30 Td (It was a bright cold day in April.) Tj ET`;
  objects[4] = `<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream`;
  objects[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  objects[6] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>`;
  const stream2 = `BT /F1 20 Tf 72 720 Td (Chapter Two of the PDF) Tj 0 -30 Td (The second page has distinct words to confirm transitions.) Tj ET`;
  objects[7] = `<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`;

  let pdf = `%PDF-1.4\n`;
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    if (!objects[i]) continue;
    offsets[i] = Buffer.byteLength(pdf, 'binary');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'binary');
  const count = objects.length; // includes index 0
  pdf += `xref\n0 ${count}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    const off = offsets[i] || 0;
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

const out = path.join(__dirname, 'sample.pdf');
fs.writeFileSync(out, buildPdf());
console.log('Wrote', out, fs.statSync(out).size, 'bytes');
