import type { LoadLogger, WordBox } from './types';

// tesseract.js is large; load it (and its worker/wasm/lang data) only when a
// page actually needs OCR. All assets are bundled locally under /tesseract so
// OCR works fully offline.
type TWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };
type TesseractWorker = {
  recognize: (img: HTMLCanvasElement) => Promise<{ data: { words?: TWord[]; text: string } }>;
  terminate: () => Promise<unknown>;
};

export interface OcrResult {
  tokens: string[];
  boxes: WordBox[];
}

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
): Promise<OcrResult> {
  const worker = await getWorker(addLog);
  const { data } = await worker.recognize(canvas);
  const words = (data.words ?? []).filter((w) => w.text.trim().length > 0);
  if (words.length > 0) {
    return {
      tokens: words.map((w) => w.text),
      boxes: words.map((w) => ({
        x: w.bbox.x0,
        y: w.bbox.y0,
        w: w.bbox.x1 - w.bbox.x0,
        h: w.bbox.y1 - w.bbox.y0,
      })),
    };
  }
  // Fallback: no word boxes available — tokens only, no highlight boxes.
  const tokens = data.text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 0);
  return { tokens, boxes: [] };
}
