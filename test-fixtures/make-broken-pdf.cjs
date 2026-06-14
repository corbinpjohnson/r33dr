// Generates a truncated (corrupt) PDF for testing graceful error handling.
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'broken.pdf');
// Valid PDF header so magic-byte check passes, but truncated body so pdfjs fails.
fs.writeFileSync(out, Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Ca'));
console.log('Wrote', out, fs.statSync(out).size, 'bytes');
