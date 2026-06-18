import { sentenceRangeAt } from '../loaders/text';
import { IMG_PREFIX } from '../loaders/types';

// ── Quote extraction ──────────────────────────────────────────────────────────

// Returns the text of the last 2-3 sentences ending at currentWordIndex,
// with image tokens stripped out.
export function extractQuote(tokens: string[], currentWordIndex: number): string {
  const idx = Math.min(currentWordIndex, tokens.length - 1);
  const bounds: Array<[number, number]> = [];

  let pos = idx;
  for (let i = 0; i < 3; i++) {
    const [s, e] = sentenceRangeAt(tokens, pos);
    // Avoid duplicates when sentenceRangeAt returns the same range.
    if (bounds.length === 0 || s !== bounds[bounds.length - 1][0]) {
      bounds.unshift([s, e]);
    }
    if (s <= 0) break;
    pos = s - 1;
  }

  const start = bounds[0][0];
  const end = bounds[bounds.length - 1][1];

  return tokens
    .slice(start, end + 1)
    .filter(t => !t.startsWith(IMG_PREFIX))
    .join(' ');
}

// ── Markdown file assembly ────────────────────────────────────────────────────

interface ChapterInfo { label: string; index: number; }

// One note entry: blockquote + page ref + blank line + user note + separator.
export function buildNoteEntry(quote: string, noteText: string, pageNum: number): string {
  const pageRef = `*(p. ${pageNum})*`;
  return `> ${quote} ${pageRef}\n\n${noteText.trim()}\n\n---\n`;
}

// Insert a new note entry into the existing notes file content, respecting
// chapter order. Returns the updated file content.
export function insertIntoNotes(
  existing: string | null,
  entry: string,
  chapterTitle: string | null,
  chapterIndex: number,
  allChapters: ChapterInfo[],
  bookTitle: string,
): string {
  const sectionHeader = `## ${chapterTitle ?? 'Notes'}`;
  const fileHeader = `# ${bookTitle}\n`;

  if (!existing) {
    return `${fileHeader}\n${sectionHeader}\n\n${entry}`;
  }

  // Parse into preamble + sections using ## as delimiters.
  // Split keeps the delimiter in odd indices: [pre, '## H1', body1, '## H2', body2, ...]
  const parts = existing.split(/(^## .+$)/m);
  const preamble = parts[0];

  interface Segment { header: string; body: string; chIdx: number; }
  const segments: Segment[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i];
    const body = parts[i + 1] ?? '';
    const label = header.slice(3).trim();
    const found = allChapters.find(c => c.label === label);
    segments.push({ header, body, chIdx: found?.index ?? -1 });
  }

  // Find our section.
  const ourIdx = segments.findIndex(s => s.header === sectionHeader);
  if (ourIdx >= 0) {
    // Section exists — append entry at end of its body.
    const trimmed = segments[ourIdx].body.replace(/\n+$/, '');
    segments[ourIdx].body = `${trimmed}\n\n${entry}`;
  } else {
    // Section missing — create it and slot in by chapter index.
    const newSeg: Segment = { header: sectionHeader, body: `\n${entry}`, chIdx: chapterIndex };
    // Insert before the first segment with a higher known chapterIndex.
    const insertBefore = segments.findIndex(s => s.chIdx > chapterIndex && s.chIdx >= 0);
    if (insertBefore < 0) {
      segments.push(newSeg);
    } else {
      segments.splice(insertBefore, 0, newSeg);
    }
  }

  // Reassemble.
  const body = segments.map(s => `${s.header}\n${s.body}`).join('\n');
  return preamble + body;
}

export function deriveNotesPath(filePath: string): string {
  // Strip the original extension and replace with .notes.md
  const lastDot = filePath.lastIndexOf('.');
  const base = lastDot > filePath.lastIndexOf('/') ? filePath.slice(0, lastDot) : filePath;
  return `${base}.notes.md`;
}
