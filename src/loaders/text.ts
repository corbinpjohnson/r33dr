import type { WordBox } from './types';

// ─── Token metadata ──────────────────────────────────────────────────────────

export interface TokenMeta {
  sentenceEnd: boolean;    // token ends with . ! ?
  paragraphEnd: boolean;   // token is last before a paragraph/heading break
  heading: boolean;        // token is inside a heading (EPUB only; PDF uses fontBig)
  clause: boolean;         // ends with ; : — (em-dash)
  longWord: boolean;       // length > 10
  numeric: boolean;        // numbers, ordinals, acronyms (e.g. "3rd", "NATO")
  functionWord: boolean;   // stopword — display faster in skim mode
}

// Precompute metadata for all tokens on a page so the per-tick cost during
// RSVP playback is a single array lookup instead of regex evaluation.
export function buildTokenMeta(
  tokens: string[],
  opts: { paragraphBreaks?: Set<number>; headingIndices?: Set<number> } = {},
): TokenMeta[] {
  const { paragraphBreaks = new Set(), headingIndices = new Set() } = opts;
  return tokens.map((tok, i) => {
    const t = tok.replace(/[^a-zA-Z0-9]/g, '');
    return {
      sentenceEnd: /[.!?]['"]?$/.test(tok),
      paragraphEnd: paragraphBreaks.has(i),
      heading: headingIndices.has(i),
      clause: /[;:—]$/.test(tok),
      longWord: tok.length > 10,
      numeric: /^\d/.test(tok) || /^[A-Z]{2,}$/.test(t),
      functionWord: isFunctionWord(tok),
    };
  });
}

// Find the best sentence start to rewind to from `index`.
// If `index` is already at the start of a sentence, returns the start of the
// PREVIOUS sentence (so resuming always gives the reader at least one full
// sentence of re-context). Otherwise returns the start of the current sentence.
export function sentenceStartBefore(tokens: string[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (/[.!?]['"]?$/.test(tokens[i])) {
      const start = i + 1;
      if (start < index) return start; // start of current sentence, strictly before index
      // start === index means index is the very first word of this sentence —
      // keep walking to find the sentence before it.
    }
  }
  return 0;
}

// Return the [start, end] inclusive token indices of the sentence containing
// `index`. Used by the sentence-trace overlay to highlight the full sentence.
export function sentenceRangeAt(tokens: string[], index: number): [number, number] {
  // Find start: walk back to the first word after the previous sentence end.
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (/[.!?]['"]?$/.test(tokens[i])) { start = i + 1; break; }
  }
  // Find end: walk forward to the next sentence-ending word.
  let end = tokens.length - 1;
  for (let i = index; i < tokens.length; i++) {
    if (/[.!?]['"]?$/.test(tokens[i])) { end = i; break; }
  }
  return [start, end];
}

// ─── De-hyphenation ──────────────────────────────────────────────────────────

export interface TextAndBoxes {
  tokens: string[];
  boxes: (WordBox | undefined)[];
}

// Merge "soft-" end-of-line hyphens with the following token.  A hyphen is
// considered soft (a formatting artifact) when the token ends with "-" AND the
// next token starts with a lowercase letter — this leaves intentional compound
// words like "state-of-the-art" untouched.
//
// The box for the merged token keeps the first word's box (the one with the
// visual position); the second box is discarded.
export function dehyphenate(
  tokens: string[],
  boxes: (WordBox | undefined)[] = [],
): TextAndBoxes {
  const outTokens: string[] = [];
  const outBoxes: (WordBox | undefined)[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    const next = tokens[i + 1];
    if (
      tok.endsWith('-') &&
      next !== undefined &&
      /^[a-z]/.test(next)
    ) {
      outTokens.push(tok.slice(0, -1) + next); // strip the trailing hyphen
      outBoxes.push(boxes[i]);
      i += 2;
    } else {
      outTokens.push(tok);
      outBoxes.push(boxes[i]);
      i++;
    }
  }
  return { tokens: outTokens, boxes: outBoxes };
}

// ─── Alignment repair ────────────────────────────────────────────────────────

// Ensure tokens and boxes arrays are the same length.  A mismatch can occur
// when OCR returns a different word count than the run-splitter.  Rather than
// silently returning undefined (which disables all highlights), we truncate the
// longer side / pad the shorter one — highlighting degrades gracefully rather
// than vanishing entirely.
export function validateAlignment(
  tokens: string[],
  boxes: WordBox[],
  label: string,
  addLog: (msg: string) => void,
): WordBox[] | undefined {
  if (boxes.length === 0) return undefined;           // intentionally no boxes
  if (boxes.length === tokens.length) return boxes;   // perfect — happy path

  addLog(
    `[highlight] ${label}: ${tokens.length} tokens vs ${boxes.length} boxes — repairing alignment.`,
  );

  if (boxes.length > tokens.length) {
    return boxes.slice(0, tokens.length);             // trim excess boxes
  }
  // boxes.length < tokens.length: pad with last box
  const last = boxes[boxes.length - 1];
  const padded = [...boxes];
  while (padded.length < tokens.length) padded.push(last);
  return padded;
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

// Split a flat token array into display chunks of `size`, never crossing a
// sentence boundary (sentenceEnd on any member token ends the chunk) or an
// image marker.
export function chunkTokens(
  tokens: string[],
  meta: TokenMeta[],
  size: number,
): number[][] {
  if (size <= 1) return tokens.map((_, i) => [i]);
  const chunks: number[][] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    // Image markers are always their own single-token chunk.
    if (tok.startsWith('__IMG__:')) {
      chunks.push([i]);
      i++;
      continue;
    }
    const chunk: number[] = [];
    while (chunk.length < size && i < tokens.length) {
      const t = tokens[i];
      if (t.startsWith('__IMG__:')) break;
      chunk.push(i);
      const m = meta[i];
      i++;
      if (m?.sentenceEnd || m?.paragraphEnd) break; // hard boundary
    }
    chunks.push(chunk);
  }
  return chunks;
}

// Auto chunk size derived from WPM.
export function autoChunkSize(wpm: number): number {
  if (wpm < 400) return 1;
  if (wpm <= 700) return 2;
  return 3;
}

// ─── Stopwords ───────────────────────────────────────────────────────────────

// ~120 common English function words displayed at 0.55× duration in skim mode.
export const FUNCTION_WORDS = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'nor', 'for', 'yet', 'so',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'then', 'once',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'shall', 'should', 'may', 'might', 'must', 'can', 'could',
  'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'than', 'too', 'very', 'just', 'as', 'if', 'because', 'while',
  'when', 'where', 'how', 'all', 'any', 'both', 'same', 'own',
  'only', 'also', 'however', 'therefore', 'thus', 'hence',
  'there', 'here',
]);

export function isFunctionWord(token: string): boolean {
  return FUNCTION_WORDS.has(token.toLowerCase().replace(/[^a-z]/g, ''));
}
