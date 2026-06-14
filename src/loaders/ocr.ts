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

const DEFAULT_OCR_TIMEOUT_MS = 45_000;

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

// Tear down the OCR worker (wasm + model hold tens of MB). Called after a
// document finishes loading, and to kill a stuck recognition — recognize()
// cannot be interrupted any other way.
export async function releaseOcrWorker(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (pending) {
    try {
      await (await pending).terminate();
    } catch {
      // Worker failed to initialize or is already gone — nothing to release.
    }
  }
}

export async function ocrCanvas(
  canvas: HTMLCanvasElement,
  addLog: LoadLogger,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_OCR_TIMEOUT_MS,
): Promise<OcrResult> {
  signal?.throwIfAborted();
  const worker = await getWorker(addLog);

  let timer: number | undefined;
  let onAbort: (() => void) | undefined;
  const interrupt = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error(`OCR timed out after ${Math.round(timeoutMs / 1000)}s.`)),
      timeoutMs,
    );
    if (signal) {
      onAbort = () => reject(new DOMException('OCR aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    const { data } = await Promise.race([worker.recognize(canvas), interrupt]);
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
  } catch (err) {
    // The recognition may still be running inside the worker; kill it so the
    // next page gets a fresh worker instead of queueing behind a stuck one.
    void releaseOcrWorker();
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}
