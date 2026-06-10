import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageData, LoadLogger, WordBox } from './types';
import { splitRunIntoBoxes } from './highlight';
import type { OcrResult } from './ocr';

// pdf.js runs its parser in a Web Worker; Vite resolves the worker asset URL.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const RENDER_SCALE = 1.5;

// Render a pdf.js page to a canvas and return [canvas, dataUrl].
async function renderPage(
  page: pdfjsLib.PDFPageProxy,
): Promise<{ canvas: HTMLCanvasElement; dataUrl: string }> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context for PDF render.');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, dataUrl: canvas.toDataURL('image/png') };
}

export async function loadPdf(
  file: ArrayBuffer,
  addLog: LoadLogger,
  ocrCanvas?: (canvas: HTMLCanvasElement, addLog: LoadLogger) => Promise<OcrResult>,
): Promise<PageData[]> {
  // pdf.js transfers the buffer to its worker (detaching it), so hand it a copy
  // and leave the caller's ArrayBuffer intact for re-runs (e.g. StrictMode).
  const data = new Uint8Array(file.slice(0));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  addLog(`PDF: ${pdf.numPages} pages`);

  const pages: PageData[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    addLog(`Scanning Page ${i}/${pdf.numPages}...`);
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

    const { canvas, dataUrl } = await renderPage(page);

    if (tokens.length === 0 && ocrCanvas) {
      addLog(`Page ${i} has no text layer; running OCR...`);
      const result: OcrResult = await ocrCanvas(canvas, addLog);
      tokens = result.tokens;
      boxes = result.boxes;
      if (tokens.length === 0) {
        addLog(`Page ${i}: No text found even after OCR (likely an image/diagram).`);
      }
    }

    pages.push({
      label: `Page ${i}`,
      tokens,
      previewImage: dataUrl,
      wordBoxes: boxes.length === tokens.length ? boxes : undefined,
      imageWidth: canvas.width,
      imageHeight: canvas.height,
    });
  }

  if (pages.length === 0) {
    throw new Error('No readable text found in this PDF (even after OCR).');
  }
  return pages;
}
