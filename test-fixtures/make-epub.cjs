// Generates a minimal valid EPUB for manual verification of VibeReader.
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');

async function main() {
  const zip = new JSZip();

  // mimetype must be first and uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  // 1x1 red PNG
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  zip.file('OEBPS/img/red.png', pngBase64, { base64: true });

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:test-vibe-reader-0001</dc:identifier>
    <dc:title>VibeReader Test Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img1" href="img/red.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`);

  zip.file('OEBPS/ch1.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter One</title></head>
<body>
  <h1>Chapter One</h1>
  <p>It was a bright cold day in April and the clocks were striking thirteen.</p>
  <p>Here comes an illustration in the middle of the flow.</p>
  <img src="img/red.png" alt="A red square"/>
  <p>And the reading continues after the picture with several more words.</p>
</body>
</html>`);

  zip.file('OEBPS/ch2.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter Two</title></head>
<body>
  <h1>Chapter Two</h1>
  <p>The second chapter has its own distinct words so we can confirm page transitions work correctly.</p>
</body>
</html>`);

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/epub+zip',
  });
  const out = path.join(__dirname, 'sample.epub');
  fs.writeFileSync(out, buf);
  console.log('Wrote', out, buf.length, 'bytes');
}

main().catch((e) => { console.error(e); process.exit(1); });
