import { describe, it, expect } from 'vitest';
import {
  buildTokenMeta,
  dehyphenate,
  validateAlignment,
  chunkTokens,
  autoChunkSize,
  isFunctionWord,
  sentenceStartBefore,
} from './text';
import { unionBoxes, groupBoxesIntoLines } from './highlight';
import type { WordBox } from './types';

// ─── buildTokenMeta ──────────────────────────────────────────────────────────

describe('buildTokenMeta', () => {
  it('flags sentence-ending tokens', () => {
    const meta = buildTokenMeta(['Hello', 'world.', 'How', 'are', 'you?']);
    expect(meta[1].sentenceEnd).toBe(true);
    expect(meta[4].sentenceEnd).toBe(true);
    expect(meta[0].sentenceEnd).toBe(false);
  });

  it('flags paragraph-end tokens from the provided set', () => {
    const meta = buildTokenMeta(['a', 'b', 'c'], { paragraphBreaks: new Set([1]) });
    expect(meta[1].paragraphEnd).toBe(true);
    expect(meta[0].paragraphEnd).toBe(false);
  });

  it('flags heading tokens', () => {
    const meta = buildTokenMeta(['Title', 'body'], { headingIndices: new Set([0]) });
    expect(meta[0].heading).toBe(true);
    expect(meta[1].heading).toBe(false);
  });

  it('flags long words', () => {
    const meta = buildTokenMeta(['hi', 'superlongword']);
    expect(meta[0].longWord).toBe(false);
    expect(meta[1].longWord).toBe(true);
  });

  it('flags function words', () => {
    const meta = buildTokenMeta(['the', 'quick', 'fox']);
    expect(meta[0].functionWord).toBe(true);
    expect(meta[1].functionWord).toBe(false);
  });

  it('flags numeric/acronym tokens', () => {
    const meta = buildTokenMeta(['3rd', 'NATO', 'normal']);
    expect(meta[0].numeric).toBe(true);
    expect(meta[1].numeric).toBe(true);
    expect(meta[2].numeric).toBe(false);
  });
});

// ─── sentenceStartBefore ─────────────────────────────────────────────────────

describe('sentenceStartBefore', () => {
  it('returns 0 when no previous sentence boundary', () => {
    expect(sentenceStartBefore(['Hello', 'world'], 1)).toBe(0);
  });

  it('returns the token after the previous sentence end', () => {
    const tokens = ['Hi', 'there.', 'How', 'are', 'you?', 'Good', 'day'];
    expect(sentenceStartBefore(tokens, 5)).toBe(2); // after "there."
    expect(sentenceStartBefore(tokens, 6)).toBe(5); // after "you?"
  });
});

// ─── dehyphenate ─────────────────────────────────────────────────────────────

describe('dehyphenate', () => {
  it('merges soft line-end hyphen with next lowercase token', () => {
    const { tokens } = dehyphenate(['soft-', 'ware', 'is', 'great.']);
    expect(tokens).toEqual(['software', 'is', 'great.']);
  });

  it('keeps hyphen when next token starts with uppercase (proper noun / acronym)', () => {
    const { tokens } = dehyphenate(['Non-', 'ASCII', 'chars']);
    expect(tokens).toEqual(['Non-', 'ASCII', 'chars']);
  });

  it('keeps intentional compound words intact', () => {
    const { tokens } = dehyphenate(['state-of-the-art']);
    expect(tokens).toEqual(['state-of-the-art']);
  });

  it('preserves boxes: merged token keeps the first box', () => {
    const boxes: WordBox[] = [
      { x: 0, y: 0, w: 30, h: 10 },
      { x: 35, y: 0, w: 30, h: 10 },
    ];
    const { tokens, boxes: outBoxes } = dehyphenate(['soft-', 'ware'], boxes);
    expect(tokens).toEqual(['software']);
    expect(outBoxes[0]).toEqual(boxes[0]);
  });

  it('handles empty input', () => {
    const { tokens, boxes } = dehyphenate([]);
    expect(tokens).toEqual([]);
    expect(boxes).toEqual([]);
  });
});

// ─── validateAlignment ───────────────────────────────────────────────────────

describe('validateAlignment', () => {
  const b: WordBox = { x: 0, y: 0, w: 10, h: 10 };
  const addLog = () => { /* no-op for tests */ };

  it('returns boxes unchanged when lengths match', () => {
    const boxes = [b, b];
    expect(validateAlignment(['a', 'b'], boxes, 'p1', addLog)).toBe(boxes);
  });

  it('returns undefined when no boxes provided', () => {
    expect(validateAlignment(['a'], [], 'p1', addLog)).toBeUndefined();
  });

  it('truncates extra boxes', () => {
    const result = validateAlignment(['a'], [b, b], 'p1', addLog);
    expect(result?.length).toBe(1);
  });

  it('pads with last box when tokens exceed boxes', () => {
    const result = validateAlignment(['a', 'b', 'c'], [b], 'p1', addLog);
    expect(result?.length).toBe(3);
    expect(result?.[2]).toEqual(b);
  });
});

// ─── chunkTokens ─────────────────────────────────────────────────────────────

describe('chunkTokens', () => {
  const meta = buildTokenMeta(['The', 'cat', 'sat.', 'A', 'dog', 'ran.']);

  it('size=1 returns one chunk per token', () => {
    const chunks = chunkTokens(['a', 'b', 'c'], meta, 1);
    expect(chunks).toEqual([[0], [1], [2]]);
  });

  it('size=2 groups two tokens but breaks at sentence end', () => {
    const chunks = chunkTokens(['The', 'cat', 'sat.', 'A', 'dog', 'ran.'], meta, 2);
    // "sat." is sentenceEnd → chunk [2] is alone; same for "ran."
    expect(chunks[0]).toEqual([0, 1]);   // "The cat"
    expect(chunks[1]).toEqual([2]);      // "sat." — sentence end cuts chunk
    expect(chunks[2]).toEqual([3, 4]);   // "A dog"
    expect(chunks[3]).toEqual([5]);      // "ran."
  });

  it('image markers are always isolated chunks', () => {
    const tokens = ['hello', '__IMG__:blob:x', 'world'];
    const m = buildTokenMeta(tokens);
    const chunks = chunkTokens(tokens, m, 2);
    expect(chunks[1]).toEqual([1]); // the image token is alone
  });
});

// ─── autoChunkSize ────────────────────────────────────────────────────────────

describe('autoChunkSize', () => {
  it('returns 1 below 400 WPM', () => expect(autoChunkSize(300)).toBe(1));
  it('returns 2 between 400 and 700 WPM', () => expect(autoChunkSize(600)).toBe(2));
  it('returns 3 above 700 WPM', () => expect(autoChunkSize(900)).toBe(3));
});

// ─── isFunctionWord ──────────────────────────────────────────────────────────

describe('isFunctionWord', () => {
  it('recognises common function words', () => {
    expect(isFunctionWord('the')).toBe(true);
    expect(isFunctionWord('The')).toBe(true);
    expect(isFunctionWord('and')).toBe(true);
  });

  it('rejects content words', () => {
    expect(isFunctionWord('elephant')).toBe(false);
    expect(isFunctionWord('running')).toBe(false);
  });
});

// ─── unionBoxes ───────────────────────────────────────────────────────────────

describe('unionBoxes', () => {
  it('returns a zero box for empty input', () => {
    expect(unionBoxes([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('correctly unions two non-overlapping boxes', () => {
    const a: WordBox = { x: 0, y: 0, w: 10, h: 5 };
    const b: WordBox = { x: 20, y: 0, w: 10, h: 5 };
    expect(unionBoxes([a, b])).toEqual({ x: 0, y: 0, w: 30, h: 5 });
  });
});

// ─── groupBoxesIntoLines ─────────────────────────────────────────────────────

describe('groupBoxesIntoLines', () => {
  it('returns empty for no boxes', () => {
    expect(groupBoxesIntoLines([])).toEqual([]);
  });

  it('groups boxes on the same line', () => {
    const boxes: WordBox[] = [
      { x: 0, y: 0, w: 30, h: 10 },
      { x: 40, y: 0, w: 30, h: 10 },
      { x: 0, y: 20, w: 30, h: 10 }, // second line
    ];
    const lines = groupBoxesIntoLines(boxes, 8);
    expect(lines.length).toBe(2);
    expect(lines[0].w).toBe(70); // 0..70
    expect(lines[1].w).toBe(30);
  });
});
