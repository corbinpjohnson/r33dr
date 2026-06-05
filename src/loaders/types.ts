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
}

export type LoadLogger = (msg: string) => void;

export const IMG_PREFIX = '__IMG__:';
