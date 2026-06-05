# VibeReader — Page Skip + Redesigned Reading View

**Date:** 2026-06-05
**Status:** Approved design (pending written-spec review)

## Goals

1. **Page skip** — let the reader jump to the previous / next page manually.
2. **Combined reading view** — during word-flashing (RSVP), keep the page
   visible but faded behind the floating focus word, with the current word
   highlighted **red in the page itself** and scrolled into view.
3. **Responsive growth** — the preview panel grows with the window (maximize =
   fills the screen). Controls keep their size and reflow below the larger panel.

Red in-page highlighting applies to **both** EPUB and PDF (including scanned/OCR
PDFs), per the chosen approach.

## Current state (relevant facts)

- `RSVPReader.tsx` holds all reader state. Reading flows through
  `ReaderState`: `LOADING → PREVIEW → RSVP` (with `IMAGE_INTERCEPT` and `ERROR`).
- A "page" is one `PageData` (`src/loaders/types.ts`): `tokens: string[]`
  (words, with `__IMG__:<url>` image markers), plus a preview that is either
  `html` (EPUB) or `previewImage` data-URL (PDF).
- Pages auto-advance: when `currentWordIndex` passes the last token, it bumps
  `currentPageIndex` and returns to `PREVIEW`. Manual nav today is only
  **within** a page (±25 words via Rewind/FastForward).
- Layout is fixed: panel `h-[500px]`, reader `max-w-5xl`, `App.tsx` wraps the
  reader in `max-w-4xl`, focus word fixed `text-7xl`. Nothing scales with the
  window.

## Feature 1 — Page skip

- Add **Prev page** / **Next page** buttons to the controls row (lucide
  `ChevronLeft` / `ChevronRight` or `SkipBack` / `SkipForward`).
- Add global keyboard: **←** = previous page, **→** = next page. (Space stays
  play/pause; existing handler extended.)
- Behavior: set `currentPageIndex` (clamped to `[0, pages.length-1]`), reset
  `currentWordIndex = 0`, clear any pending word timer, and set state to
  `PREVIEW` — identical to today's auto-advance, just triggered manually. If
  already playing, the target page's preview countdown runs then resumes.
- No wrap-around; at the ends the buttons are disabled / no-op.

## Feature 2 — Combined reading view + growth

### 2a. Per-token highlight data

To highlight "the current word" in the page, each token needs a way to locate
itself in the preview.

**EPUB (HTML preview):** no stored data needed. At render time, walk the preview
DOM's text nodes, splitting words exactly as `epub.ts` does (`/\s+/`), and wrap
the target text-word in `<span class="vr-focus">`. Map `currentWordIndex`
(which counts `__IMG__` markers) to the text-word ordinal by subtracting the
number of image markers at-or-before it.

**PDF (image preview):** add an optional field to `PageData`:

```ts
export interface WordBox { x: number; y: number; w: number; h: number } // image px
export interface PageData {
  // …existing…
  wordBoxes?: WordBox[];   // aligned 1:1 with `tokens`; PDF only
  imageWidth?: number;     // natural px size of previewImage, for overlay scaling
  imageHeight?: number;
}
```

- **Text-layer PDFs** (`pdf.ts`): from `getTextContent()` items, map each item's
  `transform`/`width`/`height` into rendered-canvas pixels via the same
  `viewport` (`RENDER_SCALE = 1.5`). When an item's `str` contains multiple
  words, split its width proportionally by character length so each token gets
  its own box. Push boxes in the same order tokens are pushed.
- **Scanned PDFs** (`ocr.ts`): switch Tesseract to return **word-level results**
  (`data.words` with `bbox {x0,y0,x1,y1}` in canvas px). Derive both tokens and
  boxes from `data.words` so they stay aligned. `ocrCanvas` returns
  `{ tokens, boxes }` instead of `string[]`; `pdf.ts` consumes both.

### 2b. Rendering the combined view

- Keep the bright `PREVIEW` countdown phase unchanged (3 s, full opacity).
- In `RSVP`, render the **same preview faded** (`opacity-20`-ish, dark overlay)
  as the background, with the floating ORP focus word centered on top (existing
  prefix / red-pivot / suffix styling retained).
- **EPUB:** the faded HTML is scrollable; the wrapped `.vr-focus` span gets a red
  background/text and is `scrollIntoView({ block: 'center' })` on each word.
- **PDF:** render `previewImage` faded; overlay one absolutely-positioned red box
  at `wordBoxes[currentWordIndex]`, scaled from `imageWidth/Height` to the
  displayed image size. Scroll the box into view (block: center) for tall pages.
- If highlight data is missing for a token (e.g., gaps), the floating word still
  shows; only the in-page box is skipped. No crash.

### 2c. Responsive growth

- Panel height: replace `h-[500px]` with viewport-relative
  (`h-[clamp(420px,70vh,1100px)]`) so it grows when maximized.
- Width: widen the reader container (reader `max-w-5xl` → `w-full`, and the
  `App.tsx` reading wrapper `max-w-4xl` → a wider cap such as `max-w-7xl`/`90vw`)
  so the preview uses the window. Controls panel keeps its current sizing and
  simply sits below the larger preview.

## Components / boundaries

- `src/loaders/types.ts` — add `WordBox`, `wordBoxes`, `imageWidth/Height`.
- `src/loaders/pdf.ts` — compute per-token boxes + image dimensions.
- `src/loaders/ocr.ts` — return `{ tokens, boxes }` (word-level recognize).
- `src/loaders/epub.ts` — unchanged (highlight is render-time DOM walking).
- `src/components/RSVPReader.tsx` — page-skip controls + keys; combined faded
  reading view; EPUB DOM-highlight helper; PDF box overlay; responsive classes.
  If the highlight logic grows, extract a small `PagePreview` subcomponent that
  takes `(page, currentWordIndex, faded)` and renders HTML-or-image with the
  active highlight — keeps `RSVPReader` focused.

## Error handling

- Clamp all page/word indices; disable skip buttons at bounds.
- Missing `wordBoxes`/highlight target → render word, skip the box, no throw.
- OCR change preserves the existing "no readable text" error path.

## Testing

- Manual (primary, via the `verify`/diagnostic harness): load an EPUB and a
  text PDF; confirm (a) ← / → and the buttons move whole pages, (b) the faded
  page shows behind the word during RSVP, (c) the red highlight tracks the
  current word and scrolls into view, (d) maximizing the window enlarges the
  preview. Screenshot each.
- A scanned/image PDF to confirm the OCR-bbox path highlights.
- Pure-logic unit candidates (if a test runner is added): the
  `currentWordIndex → text-word ordinal` mapping (image-marker offset) and the
  PDF item-width → per-word box split.

## Out of scope

- Jump-to-page-number input and skip-the-preview controls (not requested).
- Persisting reading position; theming; CSP cleanup.

## Note

This project is not a git repo, so the design doc is written but not committed.
Offer to `git init` if version history is wanted.
