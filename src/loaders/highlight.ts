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
