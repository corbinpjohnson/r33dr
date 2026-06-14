import { useEffect, useRef, useCallback } from 'react';
import type { TokenMeta } from '../loaders/text';
import { autoChunkSize, sentenceStartBefore } from '../loaders/text';
import { IMG_PREFIX } from '../loaders/types';

export interface SchedulerOptions {
  isPlaying: boolean;
  wpm: number;
  tokens: string[];
  tokenMeta: TokenMeta[] | undefined;
  wordIndex: number;
  chunkSize: number; // 0 = auto
  dynamicSpeed: boolean;
  skimMode: boolean;
  trainerMode: boolean;
  trainerCeiling: number;
  onAdvance: (nextIndex: number, chunkLen: number) => void;
  onTrainerBump: (delta: number) => void;
}

// Words over which WPM eases from 60% up to 100% on every play/resume.
const RAMP_WORDS = 20;
// Consecutive words without interruption before trainer nudges WPM up.
const TRAINER_THRESHOLD = 200;

// Ease-out cubic ramp: 60% → 100% over RAMP_WORDS words.
// Returns a fraction of target WPM (0.6 at word 0, 1.0 at word RAMP_WORDS+).
export function rampFactor(wordsSinceResume: number): number {
  if (wordsSinceResume >= RAMP_WORDS) return 1;
  const t = wordsSinceResume / RAMP_WORDS;
  return 0.6 + 0.4 * (1 - (1 - t) ** 3);
}

// Returns a delay multiplier for the current word.
// 1.0 = nominal delay; >1.0 = slower (more time on this word); <1.0 = faster.
export function delayMultiplier(
  token: string,
  meta: TokenMeta | undefined,
  dynamicSpeed: boolean,
  skimMode: boolean,
): number {
  if (!meta) {
    // Legacy fallback when tokenMeta is unavailable.
    if (!dynamicSpeed) return 1;
    if (/[.!?]$/.test(token)) return 2.0;
    if (/,$/.test(token)) return 1.25;
    if (token.length > 10) return 1.33;
    return 1;
  }

  // Compute multiplier for dynamic pacing (priority: paragraph > sentence > rest).
  let dm = 1;
  if (dynamicSpeed) {
    if (meta.heading) dm = Math.max(dm, 2.0);
    else if (meta.paragraphEnd) dm = Math.max(dm, 1.8);
    else if (meta.sentenceEnd) dm = Math.max(dm, 2.0);
    else if (meta.clause) dm = Math.max(dm, 1.18);   // 1/0.85
    else if (meta.longWord) dm = Math.max(dm, 1.33); // 1/0.75

    if (meta.numeric) dm = Math.min(dm, 0.7); // numbers flash faster
  }

  // Skim mode: function words flash at 0.55× duration (overrides slower factors).
  if (skimMode && meta.functionWord) {
    dm = Math.min(dm, 0.55);
  }

  return dm;
}

// Drift-corrected RSVP scheduler.  All mutable loop state lives in refs so
// the hook body never triggers re-renders.
export function useRsvpScheduler(opts: SchedulerOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const wordsSinceResumeRef = useRef(0);
  const consecutiveWordsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  // Schedules the next tick using a self-referencing closure; compensates for
  // drift by measuring how late the previous tick fired.
  const scheduleTick = useCallback((afterMs: number, scheduledAt: number) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      const {
        isPlaying, wpm, tokens, tokenMeta, wordIndex,
        chunkSize, dynamicSpeed, skimMode, trainerMode, trainerCeiling,
        onAdvance, onTrainerBump,
      } = optsRef.current;

      if (!isPlaying) return;

      const now = performance.now();
      const drift = now - (scheduledAt + afterMs);

      const tok = tokens[wordIndex];
      if (!tok || tok.startsWith(IMG_PREFIX)) return;

      const effective = chunkSize === 0 ? autoChunkSize(wpm) : chunkSize;
      void effective; // multi-word display is handled in RSVPReader display layer

      const meta = tokenMeta?.[wordIndex];
      const dm = delayMultiplier(tok, meta, dynamicSpeed, skimMode);
      const ramp = rampFactor(wordsSinceResumeRef.current);
      // baseDelay / ramp gives us the "current effective WPM" scaled by ramp.
      const baseDelay = (60 / wpm) * 1000;
      const nextDelay = Math.max(16, (baseDelay * dm) / ramp - drift);

      wordsSinceResumeRef.current++;
      consecutiveWordsRef.current++;

      if (trainerMode && consecutiveWordsRef.current >= TRAINER_THRESHOLD) {
        consecutiveWordsRef.current = 0;
        if (wpm < trainerCeiling) onTrainerBump(25);
      }

      onAdvance(wordIndex + 1, 1);

      const nextAt = performance.now();
      scheduleTick(nextDelay, nextAt);
    }, afterMs);
  }, [clearTimer]);

  useEffect(() => {
    if (!opts.isPlaying) {
      clearTimer();
      wordsSinceResumeRef.current = 0;
      consecutiveWordsRef.current = 0;
      return;
    }
    const baseDelay = (60 / optsRef.current.wpm) * 1000;
    scheduleTick(baseDelay, performance.now());
    return clearTimer;
  // Re-arm when play state, word position, or WPM changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.isPlaying, opts.wordIndex, opts.wpm, scheduleTick, clearTimer]);
}

// ─── Comprehension regression ─────────────────────────────────────────────────

// Returns the word index to resume from after a pause of `pauseDurationMs`.
// Rewinds 5–8 words clamped to the nearest sentence start.
export function computeRegression(
  tokens: string[],
  currentIndex: number,
  pauseDurationMs: number,
  enabled: boolean,
): number {
  if (!enabled || pauseDurationMs < 2000) return currentIndex;
  const rawRewind = Math.min(8, Math.max(5, Math.round(pauseDurationMs / 1000)));
  const rawTarget = Math.max(0, currentIndex - rawRewind);
  return sentenceStartBefore(tokens, rawTarget === 0 ? 0 : rawTarget + 1);
}
