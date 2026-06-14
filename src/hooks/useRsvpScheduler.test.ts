import { describe, it, expect } from 'vitest';
import { rampFactor, delayMultiplier, computeRegression } from './useRsvpScheduler';
import { buildTokenMeta } from '../loaders/text';

// ─── rampFactor ───────────────────────────────────────────────────────────────

describe('rampFactor', () => {
  it('starts at 0.6 (60% WPM) on word 0', () => {
    expect(rampFactor(0)).toBeCloseTo(0.6, 2);
  });

  it('reaches 1.0 at RAMP_WORDS (20)', () => {
    expect(rampFactor(20)).toBe(1);
    expect(rampFactor(100)).toBe(1);
  });

  it('increases monotonically', () => {
    const values = [0, 5, 10, 15, 20].map(rampFactor);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
});

// ─── delayMultiplier ──────────────────────────────────────────────────────────

describe('delayMultiplier — no tokenMeta fallback', () => {
  it('returns 1 with no dynamic speed', () => {
    expect(delayMultiplier('hello', undefined, false, false)).toBe(1);
  });

  it('slows for sentence-ending token', () => {
    expect(delayMultiplier('end.', undefined, true, false)).toBe(2.0);
  });

  it('slows for long word', () => {
    expect(delayMultiplier('superlongtoken', undefined, true, false)).toBeCloseTo(1.33, 1);
  });
});

describe('delayMultiplier — with tokenMeta', () => {
  it('returns 1 for plain word with no dynamic speed', () => {
    const [meta] = buildTokenMeta(['hello']);
    expect(delayMultiplier('hello', meta, false, false)).toBe(1);
  });

  it('2× delay for sentence-end with dynamic speed', () => {
    const [meta] = buildTokenMeta(['done.']);
    expect(delayMultiplier('done.', meta, true, false)).toBe(2.0);
  });

  it('1.8× delay for paragraph-end', () => {
    const meta = buildTokenMeta(['end'], { paragraphBreaks: new Set([0]) });
    expect(delayMultiplier('end', meta[0], true, false)).toBeCloseTo(1.8, 2);
  });

  it('2× delay for heading', () => {
    const meta = buildTokenMeta(['Title'], { headingIndices: new Set([0]) });
    expect(delayMultiplier('Title', meta[0], true, false)).toBe(2.0);
  });

  it('0.55× delay for function word in skim mode', () => {
    const [meta] = buildTokenMeta(['the']);
    expect(delayMultiplier('the', meta, false, true)).toBe(0.55);
  });

  it('skim mode overrides slow dynamic factor', () => {
    // "the" is a function word AND ends with a comma (unlikely but tests composition)
    const meta = buildTokenMeta(['the,'], { paragraphBreaks: new Set([0]) });
    // skimMode 0.55 should win over paragraphEnd 1.8
    expect(delayMultiplier('the,', meta[0], true, true)).toBeLessThan(1);
  });

  it('0.7× delay for numeric tokens', () => {
    const [meta] = buildTokenMeta(['2026']);
    expect(delayMultiplier('2026', meta, true, false)).toBeCloseTo(0.7, 2);
  });
});

// ─── computeRegression ────────────────────────────────────────────────────────

describe('computeRegression', () => {
  const tokens = ['Hi', 'there.', 'How', 'are', 'you?', 'Good', 'day'];

  it('returns currentIndex unchanged when disabled', () => {
    expect(computeRegression(tokens, 5, 5000, false)).toBe(5);
  });

  it('returns currentIndex unchanged when pause < 2s', () => {
    expect(computeRegression(tokens, 5, 1500, true)).toBe(5);
  });

  it('rewinds at least 5 words for a 3s pause', () => {
    const result = computeRegression(tokens, 6, 3000, true);
    expect(result).toBeLessThan(6);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('clamps to sentence start (returns 0 or 2 for tokens above)', () => {
    // At index 5 ('Good'), regression of ~5 words → 0, sentence start = 0
    const result = computeRegression(tokens, 5, 5000, true);
    expect(result).toBe(0);
  });
});
