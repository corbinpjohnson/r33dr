import type { LoadLogger } from './types';

// tesseract.js is large; load it (and its worker/wasm/lang data) only when a
// page actually needs OCR. All assets are bundled locally under /tesseract so
// OCR works fully offline.
type TesseractWorker = {
  recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

// Resolve a bundled asset path against the document base so it works both under
// http:// (dev server) and file:// (packaged Electron app).
const asset = (rel: string) => new URL(rel, document.baseURI).href;

async function getWorker(addLog: LoadLogger): Promise<TesseractWorker> {
  if (!workerPromise) {
    addLog('Loading OCR engine (bundled, offline)...');
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return (await createWorker('eng', 1, {
        workerPath: asset('tesseract/worker.min.js'),
        corePath: asset('tesseract'),
        langPath: asset('tesseract/lang'),
        gzip: true,
      })) as unknown as TesseractWorker;
    })();
  }
  return workerPromise;
}

export async function ocrCanvas(
  canvas: HTMLCanvasElement,
  addLog: LoadLogger,
): Promise<string[]> {
  const worker = await getWorker(addLog);
  const { data } = await worker.recognize(canvas);
  return data.text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 0);
}
