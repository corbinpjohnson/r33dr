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
