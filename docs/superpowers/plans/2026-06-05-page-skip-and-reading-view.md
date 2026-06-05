# Page Skip + Redesigned Reading View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual page skip (←/→ + buttons) and a combined reading view where the page stays faded behind the floating focus word with the current word highlighted red in-page (EPUB + PDF + OCR), and the preview grows with the window.

**Architecture:** A new pure module (`highlight.ts`) owns the index/coordinate math and is unit-tested with Vitest+jsdom. Loaders (`pdf.ts`, `ocr.ts`) capture per-word boxes for PDFs into an extended `PageData`. A new `PagePreview` component renders HTML-or-image with the active word highlighted and handles faded mode; `RSVPReader` adds page-skip controls/keys, the combined view, and responsive sizing.

**Tech Stack:** React 19 + TypeScript, Vite 8, Tailwind v4, pdfjs-dist, tesseract.js, Electron 42. New: Vitest (+ jsdom) for unit tests.

Spec: `docs/superpowers/specs/2026-06-05-page-skip-and-reading-view-design.md`

---

### Task 1: Initialize git + Vitest test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Initialize git so the plan's commit discipline works**

Run:
```bash
git init && printf "node_modules\ndist\ndist-electron\n" > .gitignore
git add -A && git commit -m "chore: baseline before page-skip + reading-view work"
```
Expected: a repo with one commit. (Skip this task entirely if the user declined git; then omit all later `git commit` steps.)

- [ ] **Step 2: Add Vitest + jsdom dev deps**

Run:
```bash
npm install -D vitest@^3 jsdom@^25
```
Expected: both appear under `devDependencies`.

- [ ] **Step 3: Add the test script**

Modify `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Verify the runner starts (no tests yet = exit 0)**

Run: `npm test`
Expected: Vitest runs, reports "No test files found" or 0 tests, exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest + jsdom test setup"
```

---

### Task 2: Extend PageData with per-word box fields

**Files:**
- Modify: `src/loaders/types.ts`

- [ ] **Step 1: Add the box types**

Add to `src/loaders/types.ts` (after `PageData`):

```ts
// A word's pixel rectangle within the rendered preview image (PDF only).
export interface WordBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
```

And extend `PageData` with three optional fields:

```ts
export interface PageData {
  label: string;
  tokens: string[];
  html?: string;
  previewImage?: string;
  // PDF only: one box per token (aligned 1:1 with `tokens`), in the natural
  // pixel space of `previewImage`. Used to draw the red in-page highlight.
  wordBoxes?: WordBox[];
  imageWidth?: number;
  imageHeight?: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors (fields are optional; existing code still compiles).

- [ ] **Step 3: Commit**

```bash
git add src/loaders/types.ts
git commit -m "feat(types): add WordBox + per-word box fields to PageData"
```

---

### Task 3: Pure highlight helpers (TDD)

Two pure functions used by both formats. Unit-tested.

**Files:**
- Create: `src/loaders/highlight.ts`
- Test: `src/loaders/highlight.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/loaders/highlight.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { textWordOrdinal, splitRunIntoBoxes } from './highlight';
import { IMG_PREFIX } from './types';

describe('textWordOrdinal', () => {
  it('returns the token index when there are no image markers', () => {
    expect(textWordOrdinal(['a', 'b', 'c'], 2)).toBe(2);
  });

  it('subtracts image markers that precede the index', () => {
    const tokens = ['a', `${IMG_PREFIX}x`, 'b', 'c'];
    // token 2 ('b') is the 1st text word after one image marker
    expect(textWordOrdinal(tokens, 2)).toBe(1);
    expect(textWordOrdinal(tokens, 3)).toBe(2);
  });

  it('returns -1 when the token itself is an image marker', () => {
    const tokens = ['a', `${IMG_PREFIX}x`, 'b'];
    expect(textWordOrdinal(tokens, 1)).toBe(-1);
  });
});

describe('splitRunIntoBoxes', () => {
  it('splits a single-word run into one full-width box', () => {
    const boxes = splitRunIntoBoxes('hello', 10, 20, 50, 8);
    expect(boxes).toEqual([{ x: 10, y: 20, w: 50, h: 8 }]);
  });

  it('splits a multi-word run proportionally by character length', () => {
    // "ab cd" -> widths by chars (excluding spaces): 2 and 2 of 4 total,
    // each gets half of 100px, advancing x past the word + the space gap.
    const boxes = splitRunIntoBoxes('ab cd', 0, 0, 100, 10);
    expect(boxes.length).toBe(2);
    expect(boxes[0].x).toBe(0);
    expect(boxes[0].w).toBeCloseTo(40); // 2 chars / 5 total (incl space) * 100
    expect(boxes[1].x).toBeCloseTo(60); // after "ab" + space
    expect(boxes[1].w).toBeCloseTo(40);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `highlight.ts` / exports not found.

- [ ] **Step 3: Implement `highlight.ts`**

```ts
import { IMG_PREFIX, type WordBox } from './types';

// Map a token index (which may include __IMG__ markers) to its ordinal among
// text words only. Returns -1 if the token at `index` is itself an image marker.
export function textWordOrdinal(tokens: string[], index: number): number {
  if (index < 0 || index >= tokens.length) return -1;
  if (tokens[index].startsWith(IMG_PREFIX)) return -1;
  let ordinal = 0;
  for (let i = 0; i < index; i++) {
    if (!tokens[i].startsWith(IMG_PREFIX)) ordinal++;
  }
  return ordinal;
}

// Split a pdf.js text run (whose pixel box is x,y,w,h) into one box per word,
// distributing width proportionally by character count, including the single
// space between words so boxes don't overlap.
export function splitRunIntoBoxes(
  str: string,
  x: number,
  y: number,
  w: number,
  h: number,
): WordBox[] {
  const words = str.split(/\s+/).filter((s) => s.length > 0);
  if (words.length <= 1) return [{ x, y, w, h }];
  const spaces = words.length - 1;
  const totalUnits = words.reduce((n, word) => n + word.length, 0) + spaces;
  const unit = w / totalUnits;
  const boxes: WordBox[] = [];
  let cursor = x;
  words.forEach((word, i) => {
    const wordW = word.length * unit;
    boxes.push({ x: cursor, y, w: wordW, h });
    cursor += wordW + (i < spaces ? unit : 0); // advance past one space gap
  });
  return boxes;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/loaders/highlight.ts src/loaders/highlight.test.ts
git commit -m "feat(highlight): pure helpers for word ordinal + pdf box split"
```

---

### Task 4: EPUB word-wrapping helper (TDD, jsdom)

Pre-wrap every text word in the preview HTML as `<span data-w="K">` so the
reader can highlight any word in O(1).

**Files:**
- Modify: `src/loaders/highlight.ts`
- Test: `src/loaders/highlight.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/loaders/highlight.test.ts`:
```ts
import { wrapWords } from './highlight';

describe('wrapWords', () => {
  it('wraps each text word in a data-w span with sequential indices', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>hello brave world</p>';
    wrapWords(el);
    const spans = el.querySelectorAll('span[data-w]');
    expect(spans.length).toBe(3);
    expect(spans[0].getAttribute('data-w')).toBe('0');
    expect(spans[2].textContent).toBe('world');
  });

  it('skips SCRIPT/STYLE text and preserves images', () => {
    const el = document.createElement('div');
    el.innerHTML = '<style>x{}</style><p>hi</p><img src="a.png">';
    wrapWords(el);
    const spans = el.querySelectorAll('span[data-w]');
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('hi');
    expect(el.querySelector('img')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `wrapWords` not exported.

- [ ] **Step 3: Implement `wrapWords`**

Add to `src/loaders/highlight.ts`:
```ts
// Wrap every text word under `root` in <span data-w="K"> with sequential K,
// matching the same /\s+/ tokenization the loaders use. Mutates in place.
export function wrapWords(root: HTMLElement): void {
  const skip = new Set(['SCRIPT', 'STYLE', 'HEAD']);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && skip.has(node.parentElement.nodeName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const textNodes: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    textNodes.push(n as Text);
    n = walker.nextNode();
  }

  let index = 0;
  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    if (!text.trim()) continue;
    const frag = document.createDocumentFragment();
    // Preserve original whitespace by splitting on word boundaries.
    const parts = text.split(/(\s+)/); // words and the whitespace between them
    for (const part of parts) {
      if (part.length === 0) continue;
      if (/^\s+$/.test(part)) {
        frag.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement('span');
        span.setAttribute('data-w', String(index++));
        span.textContent = part;
        frag.appendChild(span);
      }
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS — all tests green (5 prior + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/loaders/highlight.ts src/loaders/highlight.test.ts
git commit -m "feat(highlight): wrapWords for O(1) EPUB word highlighting"
```

---

### Task 5: OCR returns word-level tokens + boxes

**Files:**
- Modify: `src/loaders/ocr.ts`

- [ ] **Step 1: Change `ocrCanvas` to return tokens + boxes**

Replace the body of `src/loaders/ocr.ts` below the imports. Update the worker
type and return shape; derive both tokens and boxes from word-level results so
they stay aligned:

```ts
import type { LoadLogger, WordBox } from './types';

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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: errors only at the `pdf.ts` call site (fixed in Task 6) — note them, proceed.

- [ ] **Step 3: Commit**

```bash
git add src/loaders/ocr.ts
git commit -m "feat(ocr): return word-level tokens + bounding boxes"
```

---

### Task 6: PDF loader captures per-word boxes + image dimensions

**Files:**
- Modify: `src/loaders/pdf.ts`

- [ ] **Step 1: Import helpers + box type**

At the top of `src/loaders/pdf.ts`, add:
```ts
import type { PageData, LoadLogger, WordBox } from './types';
import { splitRunIntoBoxes } from './highlight';
import type { OcrResult } from './ocr';
```
(Replace the existing `import type { PageData, LoadLogger } from './types';`.)

- [ ] **Step 2: Build tokens + boxes from the text layer**

Replace the per-page loop body in `loadPdf`. The key change: instead of joining
all item strings, walk items, map each item's box to canvas pixels via the
viewport transform, split multi-word items, and collect aligned tokens+boxes.

```ts
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
    }

    if (tokens.length > 0) {
      pages.push({
        label: `Page ${i}`,
        tokens,
        previewImage: dataUrl,
        wordBoxes: boxes.length === tokens.length ? boxes : undefined,
        imageWidth: canvas.width,
        imageHeight: canvas.height,
      });
    }
  }
```

- [ ] **Step 3: Update the `ocrCanvas` param type**

Change the `loadPdf` signature's `ocrCanvas` parameter type to return `OcrResult`:
```ts
  ocrCanvas?: (canvas: HTMLCanvasElement, addLog: LoadLogger) => Promise<import('./ocr').OcrResult>,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: `pdf.ts`/`ocr.ts` clean. (RSVPReader still compiles — it passes `ocrCanvas` straight through.)

- [ ] **Step 5: Unit tests still pass**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/loaders/pdf.ts
git commit -m "feat(pdf): capture per-word boxes + image size for highlighting"
```

---

### Task 7: PagePreview component (render html-or-image, faded, highlight)

A focused component that renders a page preview and highlights the current word.
Keeps `RSVPReader` from ballooning.

**Files:**
- Create: `src/components/PagePreview.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import React, { useEffect, useRef } from 'react';
import type { PageData } from '../loaders/types';
import { textWordOrdinal, wrapWords } from '../loaders/highlight';

interface PagePreviewProps {
  page: PageData;
  currentWordIndex: number;
  faded: boolean; // true during RSVP (dim background behind the floating word)
}

// Renders an EPUB (HTML) or PDF (image) page preview and draws a red highlight
// on the current word, scrolling it into view.
const PagePreview: React.FC<PagePreviewProps> = ({ page, currentWordIndex, faded }) => {
  const htmlRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // EPUB: inject HTML once per page and pre-wrap words.
  useEffect(() => {
    const el = htmlRef.current;
    if (!el || page.previewImage) return;
    el.innerHTML = page.html ?? '';
    wrapWords(el);
  }, [page]);

  // EPUB: move the .vr-focus class to the current word + scroll into view.
  useEffect(() => {
    const el = htmlRef.current;
    if (!el || page.previewImage) return;
    el.querySelector('.vr-focus')?.classList.remove('vr-focus');
    const ordinal = textWordOrdinal(page.tokens, currentWordIndex);
    if (ordinal < 0) return;
    const span = el.querySelector(`span[data-w="${ordinal}"]`);
    if (span) {
      span.classList.add('vr-focus');
      span.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }, [page, currentWordIndex]);

  const opacity = faded ? 'opacity-25' : 'opacity-100';

  // PDF: image + percentage-positioned red box overlay.
  if (page.previewImage) {
    const box = page.wordBoxes?.[currentWordIndex];
    const iw = page.imageWidth ?? 1;
    const ih = page.imageHeight ?? 1;
    return (
      <div ref={scrollRef} className={`flex-1 overflow-auto bg-white transition-opacity duration-500 ${opacity}`}>
        <div className="relative inline-block min-w-full">
          <img src={page.previewImage} alt={`Preview of ${page.label}`} className="block w-full h-auto" />
          {box && (
            <span
              className="absolute bg-red-500/30 border-2 border-red-500 rounded-sm transition-all duration-100"
              style={{
                left: `${(box.x / iw) * 100}%`,
                top: `${(box.y / ih) * 100}%`,
                width: `${(box.w / iw) * 100}%`,
                height: `${(box.h / ih) * 100}%`,
              }}
              ref={(node) => node?.scrollIntoView({ block: 'center', behavior: 'auto' })}
            />
          )}
        </div>
      </div>
    );
  }

  // EPUB
  return (
    <div
      ref={htmlRef}
      className={`flex-1 overflow-auto p-12 bg-white text-slate-900 font-serif leading-relaxed prose prose-slate max-w-none transition-opacity duration-500 ${opacity}`}
    />
  );
};

export default PagePreview;
```

- [ ] **Step 2: Add the highlight style**

In `src/index.css`, append:
```css
.vr-focus {
  background-color: rgba(239, 68, 68, 0.25);
  color: #dc2626;
  border-radius: 2px;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.6);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/PagePreview.tsx src/index.css
git commit -m "feat(preview): PagePreview with red word highlight + faded mode"
```

---

### Task 8: Wire page-skip + combined view + responsive sizing into RSVPReader

**Files:**
- Modify: `src/components/RSVPReader.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add page-skip handlers + arrow keys**

In `RSVPReader.tsx`, add a `goToPage` callback and extend the keydown effect.
After the `togglePlay` definition, add:

```tsx
  const goToPage = useCallback((target: number) => {
    if (pages.length === 0) return;
    const clamped = Math.max(0, Math.min(pages.length - 1, target));
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrentPageIndex(clamped);
    setCurrentWordIndex(0);
    setReaderState('PREVIEW');
  }, [pages.length]);
```

Replace the existing keydown effect with one that also handles arrows:
```tsx
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (readerState === 'IMAGE_INTERCEPT') {
          setCurrentWordIndex(prev => prev + 1);
          setReaderState('RSVP');
          setIsPlaying(true);
        } else {
          togglePlay();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        goToPage(currentPageIndex + 1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        goToPage(currentPageIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, readerState, goToPage, currentPageIndex]);
```

- [ ] **Step 2: Import PagePreview + page-skip icons**

Update the imports at the top of `RSVPReader.tsx`:
```tsx
import { Play, Pause, FastForward, Rewind, AlertCircle, Eye, SkipBack, SkipForward } from 'lucide-react';
import PagePreview from './PagePreview';
```

- [ ] **Step 3: Use PagePreview in the PREVIEW state and add the combined RSVP background**

Replace the PREVIEW block's inner image/html conditional (the
`currentPage.previewImage ? (...) : (...)` part) with:
```tsx
                <PagePreview page={currentPage} currentWordIndex={currentWordIndex} faded={false} />
```

Replace the entire **State 2: RSVP** block with a faded page behind the word:
```tsx
        {readerState === 'RSVP' && (
            <div className={`absolute inset-0 flex flex-col transition-all duration-500 ${isPeripheralMode ? 'bg-black' : 'bg-slate-900'}`}>
                {!isPeripheralMode && (
                    <div className="absolute inset-0 flex flex-col">
                        <PagePreview page={currentPage} currentWordIndex={currentWordIndex} faded={true} />
                    </div>
                )}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-indigo-500/10 -translate-x-1/2"></div>
                    <div className={`text-7xl font-mono font-bold flex transition-all duration-300 px-8 py-4 rounded-3xl bg-slate-950/70 backdrop-blur-sm ${isPeripheralMode ? 'scale-110' : ''}`}>
                        <span className={`text-right flex-1 min-w-[300px] transition-all duration-300 ${isPeripheralMode ? 'opacity-0 scale-95' : 'text-slate-500'}`}>{prefix}</span>
                        <span className="text-indigo-400 drop-shadow-[0_0_25px_rgba(129,140,248,0.5)]">{focus}</span>
                        <span className={`text-left flex-1 min-w-[300px] transition-all duration-300 ${isPeripheralMode ? 'opacity-0 scale-95' : 'text-slate-300'}`}>{suffix}</span>
                    </div>
                </div>
            </div>
        )}
```

- [ ] **Step 4: Add Prev/Next page buttons to the controls**

In the controls row, wrap the existing transport buttons so page-skip flanks
them. Replace the `<div className="flex items-center gap-6">` block (Rewind /
play / FastForward) with:
```tsx
            <div className="flex items-center gap-4">
                <button onClick={() => goToPage(currentPageIndex - 1)} disabled={currentPageIndex === 0} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all disabled:opacity-30 disabled:hover:bg-transparent" title="Previous page (←)"><SkipBack size={28} /></button>
                <button onClick={() => setCurrentWordIndex(Math.max(0, currentWordIndex - 25))} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all"><Rewind size={32} /></button>
                <button onClick={togglePlay} className="w-24 h-24 flex items-center justify-center bg-indigo-500 hover:bg-indigo-400 text-white rounded-[2rem] shadow-xl shadow-indigo-500/30 transition-all active:scale-95">
                    {isPlaying ? <Pause size={48} fill="currentColor" /> : <Play size={48} className="ml-1" fill="currentColor" />}
                </button>
                <button onClick={() => setCurrentWordIndex(Math.min(currentPage.tokens.length - 1, currentWordIndex + 25))} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all"><FastForward size={32} /></button>
                <button onClick={() => goToPage(currentPageIndex + 1)} disabled={currentPageIndex === pages.length - 1} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all disabled:opacity-30 disabled:hover:bg-transparent" title="Next page (→)"><SkipForward size={28} /></button>
            </div>
```

- [ ] **Step 5: Make the preview panel grow with the window**

In `RSVPReader.tsx`, change the reader's outer wrapper and panel:
- Outer `<div className="space-y-12 max-w-5xl mx-auto">` → `className="space-y-8 w-full mx-auto"`.
- Panel `<div className={...h-[500px]...}>` → replace `h-[500px]` with `h-[clamp(420px,70vh,1100px)]`.

In `src/App.tsx`, widen the reading wrapper: change the reader branch container
`<div className="w-full max-w-4xl">` to `<div className="w-full max-w-7xl">`.

- [ ] **Step 6: Typecheck + unit tests**

Run: `npx tsc -b && npm test`
Expected: clean typecheck, all unit tests pass.

- [ ] **Step 7: Build to confirm production bundle compiles**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/RSVPReader.tsx src/App.tsx
git commit -m "feat(reader): page skip, combined faded reading view, responsive preview"
```

---

### Task 9: Manual visual verification (screenshot harness)

No automated Electron render test exists; verify the visual behavior with the
diagnostic harness pattern (a temporary Electron main that loads the build,
drives it, and `capturePage`s).

**Files:**
- Create (temporary): `diag-main.cjs`
- Use fixtures from: `test-fixtures/`

- [ ] **Step 1: Repackage so the app runs the new build**

Run: `npm run dist`
Expected: `dist-electron/mac-arm64/VibeReader.app` rebuilt from the new `dist/`.

- [ ] **Step 2: Verify each behavior and screenshot**

Launch the app (or a diagnostic main that loads `dist/index.html`), then for an
**EPUB** and a **text PDF** fixture from `test-fixtures/`, confirm and capture:
1. `←` / `→` and the Prev/Next buttons move whole pages (page number changes).
2. During RSVP the page is visible but faded behind the floating word.
3. The red highlight tracks the current word and scrolls into view.
4. Maximizing the window enlarges the preview panel (not just margins).

Then load a **scanned/image PDF** fixture and confirm the OCR path highlights
the current word with a red box.

Expected: all four behaviors visible in screenshots; report any mismatch and
loop back to the relevant task using systematic-debugging.

- [ ] **Step 3: Clean up the temporary harness**

```bash
rm -f diag-main.cjs diag-shot*.png
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify page skip + reading-view visually (harness removed)"
```

---

## Self-Review

**Spec coverage:**
- Page skip (←/→ + buttons, clamp, reset to preview) → Task 8 (Steps 1, 4). ✓
- Combined faded view (page behind floating word) → Task 8 (Step 3) + Task 7. ✓
- Red in-page highlight EPUB (DOM wrap + scroll) → Tasks 4, 7. ✓
- Red in-page highlight PDF text-layer (coordinate boxes) → Tasks 3, 6, 7. ✓
- Red in-page highlight scanned PDF (OCR bboxes) → Tasks 5, 6, 7. ✓
- Responsive growth (viewport sizing, controls same) → Task 8 (Step 5). ✓
- PageData change (wordBoxes/imageWidth/Height) → Task 2. ✓
- PagePreview extraction → Task 7. ✓
- Testing (unit for pure logic + manual visual) → Tasks 3, 4, 9. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `OcrResult` defined in Task 5, consumed in Task 6; `WordBox` defined in Task 2, used in Tasks 3/5/6/7; `textWordOrdinal`/`wrapWords`/`splitRunIntoBoxes` defined in Tasks 3/4, used in Tasks 6/7; `goToPage` defined and used in Task 8. ✓

**Note:** Not originally a git repo — Task 1 initializes it so commit steps are valid. If the user declines git, skip every `git commit` step.
