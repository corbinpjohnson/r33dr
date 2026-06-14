import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageData, LoadLogger, LoadOptions, WordBox } from './types';
import { isAbortError } from './types';
import { splitRunIntoBoxes } from './highlight';
import type { OcrResult } from './ocr';

// pdf.js runs its parser in a Web Worker; Vite resolves the worker asset URL.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const RENDER_SCALE = 1.5;

type OcrFn = (
  canvas: HTMLCanvasElement,
  addLog: LoadLogger,
  signal?: AbortSignal,
) => Promise<OcrResult>;

// Render a pdf.js page to a canvas and return the canvas plus an object URL for
// the rasterized PNG (object URLs are far cheaper to hold per-page than data
// URLs; the caller owns revocation via LoadOptions.registerUrl).
async function renderPage(
  page: pdfjsLib.PDFPageProxy,
): Promise<{ canvas: HTMLCanvasElement; url: string }> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context for PDF render.');
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas rasterization failed.'))),
      'image/png',
    ),
  );
  return { canvas, url: URL.createObjectURL(blob) };
}

async function parsePage(
  pdf: pdfjsLib.PDFDocumentProxy,
  i: number,
  addLog: LoadLogger,
  ocr: OcrFn | undefined,
  opts: LoadOptions,
): Promise<PageData> {
  const page = await pdf.getPage(i);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const textContent = await page.getTextContent();

  let tokens: string[] = [];
  let boxes: WordBox[] = [];
  for (const item of textContent.items) {
    if (!('str' in item) || item.str.trim().length === 0) continue;
    // item.transform = [a,b,c,d,e,f]; (e,f) is the baseline origin in PDF
    // space. Map to viewport (canvas) pixels.
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const widthPx = item.width * RENDER_SCALE;
    const x = tx[4];
    const yTop = tx[5] - fontHeight; // tx[5] is baseline; box top is above it
    const runBoxes = splitRunIntoBoxes(item.str, x, yTop, widthPx, fontHeight);
    const words = item.str.split(/\s+/).filter((w) => w.length > 0);
    tokens.push(...words);
    boxes.push(...runBoxes);
  }

  const { canvas, url } = await renderPage(page);
  opts.registerUrl?.(url);

  if (tokens.length === 0 && ocr) {
    addLog(`Page ${i} has no text layer; running OCR...`);
    const result: OcrResult = await ocr(canvas, addLog, opts.signal);
    tokens = result.tokens;
    boxes = result.boxes;
    if (tokens.length === 0) {
      addLog(`Page ${i}: No text found even after OCR (likely an image/diagram).`);
    }
  }

  return {
    label: `Page ${i}`,
    tokens,
    previewImage: url,
    wordBoxes: boxes.length === tokens.length ? boxes : undefined,
    imageWidth: canvas.width,
    imageHeight: canvas.height,
  };
}

export async function loadPdf(
  file: ArrayBuffer,
  addLog: LoadLogger,
  ocr?: OcrFn,
  opts: LoadOptions = {},
): Promise<PageData[]> {
  const { signal, onMeta, onPage } = opts;
  // pdf.js transfers the buffer to its worker (detaching it), so hand it a copy
  // and leave the caller's ArrayBuffer intact for re-runs (e.g. StrictMode).
  const data = new Uint8Array(file.slice(0));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  try {
    signal?.throwIfAborted();
    addLog(`PDF: ${pdf.numPages} pages`);
    onMeta?.(pdf.numPages);

    const pages: PageData[] = [];
    let parsedOk = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      signal?.throwIfAborted();
      addLog(`Scanning Page ${i}/${pdf.numPages}...`);
      let pageData: PageData;
      try {
        pageData = await parsePage(pdf, i, addLog, ocr, opts);
        parsedOk++;
      } catch (err) {
        if (isAbortError(err)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        addLog(`Page ${i} failed to load: ${message}`);
        pageData = { label: `Page ${i}`, tokens: [], loadError: message };
      }
      pages.push(pageData);
      onPage?.(pageData, i - 1);
    }

    if (parsedOk === 0) {
      throw new Error('Every page in this PDF failed to load.');
    }
    return pages;
  } finally {
    // Frees the worker-side document; the rasterized previews are independent
    // blobs, so they survive this.
    pdf.destroy();
  }
}
