// A word's pixel rectangle within the rendered preview image (PDF only).
export interface WordBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// A unit of readable content (an EPUB spine item, or a PDF page).
export interface PageData {
  // Human-facing label / source identifier for the page.
  label: string;
  // Words in reading order. Image markers use the "__IMG__:<url>" prefix.
  tokens: string[];
  // EPUB preview: sanitized chapter HTML (image srcs rewritten to blob URLs).
  html?: string;
  // PDF preview: a rendered page image as a data URL.
  previewImage?: string;
  // PDF only: one box per token (aligned 1:1 with `tokens`), in the natural
  // pixel space of `previewImage`. Used to draw the red in-page highlight.
  wordBoxes?: WordBox[];
  imageWidth?: number;
  imageHeight?: number;
  // Set when this single page failed to parse; the rest of the document is
  // still readable. The document only hard-fails if every page failed.
  loadError?: string;
}

export type LoadLogger = (msg: string) => void;

// Streaming/cancellation hooks shared by the PDF and EPUB loaders.
export interface LoadOptions {
  // Abort parsing (e.g. a new file was chosen mid-load, or unmount).
  signal?: AbortSignal;
  // Called once the total page count is known, before any page is emitted.
  onMeta?: (totalPages: number) => void;
  // Called for each page as it finishes parsing, in document order.
  onPage?: (page: PageData, index: number) => void;
  // Called for every object URL a loader creates, so the caller can revoke
  // them all when the document is discarded.
  registerUrl?: (url: string) => void;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export const IMG_PREFIX = '__IMG__:';
