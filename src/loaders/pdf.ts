import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageData, LoadLogger } from './types';

// pdf.js runs its parser in a Web Worker; Vite resolves the worker asset URL.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const RENDER_SCALE = 1.5;

function tokenize(text: string): string[] {
  return text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 0);
}

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
  ocrCanvas?: (canvas: HTMLCanvasElement, addLog: LoadLogger) => Promise<string[]>,
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
    const textContent = await page.getTextContent();
    const rawText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    let tokens = tokenize(rawText);

    const { canvas, dataUrl } = await renderPage(page);

    if (tokens.length === 0 && ocrCanvas) {
      addLog(`Page ${i} has no text layer; running OCR...`);
      tokens = await ocrCanvas(canvas, addLog);
    }

    if (tokens.length > 0) {
      pages.push({ label: `Page ${i}`, tokens, previewImage: dataUrl });
    }
  }

  if (pages.length === 0) {
    throw new Error('No readable text found in this PDF (even after OCR).');
  }
  return pages;
}
