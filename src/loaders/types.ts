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
}

export type LoadLogger = (msg: string) => void;

export const IMG_PREFIX = '__IMG__:';
