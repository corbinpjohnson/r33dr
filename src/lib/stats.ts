// Session-level reading statistics accumulator.

export interface SessionStats {
  wordsShown: number;
  activeMs: number;  // time actually playing (excludes pauses)
  pagesRead: number; // unique pages that had words played through them
  effectiveWpm: number; // wordsShown / (activeMs / 60000)
}

export function makeSessionStats(): SessionStats {
  return { wordsShown: 0, activeMs: 0, pagesRead: 0, effectiveWpm: 0 };
}

export function statsWithWord(
  stats: SessionStats,
  durationMs: number,
  isNewPage: boolean,
): SessionStats {
  const wordsShown = stats.wordsShown + 1;
  const activeMs = stats.activeMs + durationMs;
  const pagesRead = isNewPage ? stats.pagesRead + 1 : stats.pagesRead;
  const effectiveWpm = activeMs > 0 ? Math.round(wordsShown / (activeMs / 60000)) : 0;
  return { wordsShown, activeMs, pagesRead, effectiveWpm };
}

export function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}
