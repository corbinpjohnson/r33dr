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
