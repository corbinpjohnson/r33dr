import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Play, Pause, FastForward, Rewind, AlertCircle, Eye, SkipBack, SkipForward, Bookmark, EyeOff, SlidersHorizontal } from 'lucide-react';
import { loadEpub } from '../loaders/epub';
import { loadPdf } from '../loaders/pdf';
import { ocrCanvas, releaseOcrWorker } from '../loaders/ocr';
import { IMG_PREFIX, type PageData } from '../loaders/types';
import { autoChunkSize, chunkTokens } from '../loaders/text';
import { unionBoxes } from '../loaders/highlight';
import PagePreview from './PagePreview';
import ThumbnailStrip from './ThumbnailStrip';
import { useRsvpScheduler, computeRegression } from '../hooks/useRsvpScheduler';
import {
  hashDocument,
  loadDocState,
  saveDocState,
  loadGlobalSettings,
  makeDebounced,
  pushRecent,
  type Bookmark as BookmarkEntry,
} from '../lib/persistence';
import { makeSessionStats, statsWithWord, formatTime, type SessionStats } from '../lib/stats';
import { extractQuote, buildNoteEntry, insertIntoNotes, deriveNotesPath } from '../lib/notes';

interface RSVPReaderProps {
  file: ArrayBuffer;
  fileName: string;
  filePath?: string;
}

type ReaderState = 'LOADING' | 'PREVIEW' | 'RSVP' | 'IMAGE_INTERCEPT' | 'ERROR';

function isPdf(buffer: ArrayBuffer): boolean {
  const sig = new Uint8Array(buffer, 0, 4);
  return sig[0] === 0x25 && sig[1] === 0x50 && sig[2] === 0x44 && sig[3] === 0x46;
}

const RSVPReader: React.FC<RSVPReaderProps> = ({ file, fileName, filePath }) => {
  const [pages, setPages] = useState<PageData[]>([]);
  const [totalPageCount, setTotalPageCount] = useState<number>(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [wpm, setWpm] = useState(300);
  const [isPlaying, setIsPlaying] = useState(false);
  const [readerState, setReaderState] = useState<ReaderState>('LOADING');
  const [isDynamicSpeed, setIsDynamicSpeed] = useState(false);
  const [isPeripheralMode, setIsPeripheralMode] = useState(false);
  const [isSkimMode, setIsSkimMode] = useState(false);
  const [isTrainerMode, setIsTrainerMode] = useState(false);
  const [chunkSize, setChunkSize] = useState(0); // 0 = auto
  const [isRegressionEnabled, setIsRegressionEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [previewCountdown, setPreviewCountdown] = useState(3);
  const [resumeToast, setResumeToast] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [stripCollapsed, setStripCollapsed] = useState(false);
  const [isPeeking, setIsPeeking] = useState(false);
  const [sessionStats, setSessionStats] = useState<SessionStats>(makeSessionStats());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isRewinding, setIsRewinding] = useState(false);
  const [summaryState, setSummaryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [notePanelOpen, setNotePanelOpen] = useState(false);
  const [noteQuote, setNoteQuote] = useState('');
  const [noteSaveState, setNoteSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const urlRegistryRef = useRef<string[]>([]);
  const rewindTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rewindPosRef = useRef(0);
  const docHashRef = useRef<string | null>(null);
  const pauseStartRef = useRef<number | null>(null);
  const lastWordTickRef = useRef<number>(performance.now());
  const lastPageIndexRef = useRef<number>(0);

  const addLog = useCallback((msg: string) => {
    console.log(msg);
    setLogs(prev => [...prev.slice(-10), msg]);
  }, []);

  const debouncedSave = useRef(
    makeDebounced((hash: string, state: Parameters<typeof saveDocState>[1], name: string, totalPages: number, fp?: string) => {
      saveDocState(hash, state);
      pushRecent({ name, hash, page: state.page, totalPages, updatedAt: Date.now(), filePath: fp });
    }, 1000),
  ).current;

  // Cancel any in-flight rewind when the component unmounts.
  useEffect(() => () => { if (rewindTimerRef.current) clearTimeout(rewindTimerRef.current); }, []);

  // ─── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    for (const url of urlRegistryRef.current) URL.revokeObjectURL(url);
    urlRegistryRef.current = [];
    docHashRef.current = null;

    const registerUrl = (url: string) => urlRegistryRef.current.push(url);

    const load = async () => {
      setReaderState('LOADING');
      setError(null);
      setLogs([]);
      setPages([]);
      setTotalPageCount(0);
      setCurrentPageIndex(0);
      setCurrentWordIndex(0);
      setBookmarks([]);
      setResumeToast(null);
      setIsPlaying(false);
      addLog('--- Continuous Page Deep Scan ---');

      const hashPromise = hashDocument(file);

      const onMeta = (total: number) => setTotalPageCount(total);

      let firstPage = true;
      const onPage = (page: PageData) => {
        setPages(prev => [...prev, page]);
        if (firstPage) {
          firstPage = false;
          setReaderState('PREVIEW');
          addLog('First page ready — starting preview.');
        }
      };

      try {
        const opts = { signal, onMeta, onPage, registerUrl };
        const allPages = isPdf(file)
          ? await loadPdf(file, addLog, ocrCanvas, opts)
          : await loadEpub(file, addLog, opts);

        if (!signal.aborted) {
          setPages(allPages);
          setTotalPageCount(allPages.length);
          if (firstPage) setReaderState('PREVIEW');
          addLog(`Scan complete. ${allPages.length} pages ready.`);
          void releaseOcrWorker();

          const hash = await hashPromise;
          docHashRef.current = hash;
          const saved = loadDocState(hash);
          if (saved && saved.page < allPages.length) {
            setCurrentPageIndex(saved.page);
            setCurrentWordIndex(saved.word);
            setWpm(saved.wpm);
            setIsDynamicSpeed(saved.dynamicSpeed);
            setIsSkimMode(saved.skimMode ?? false);
            setIsTrainerMode(saved.trainer ?? false);
            setChunkSize(saved.chunkSize ?? 0);
            setBookmarks(saved.bookmarks ?? []);
            setResumeToast(`Resumed at page ${saved.page + 1}`);
            setTimeout(() => setResumeToast(null), 3000);
          } else {
            const gs = loadGlobalSettings();
            setWpm(gs.wpm);
            setIsDynamicSpeed(gs.dynamicSpeed);
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        addLog(`Fatal Error: ${message}`);
        setError(message);
        setReaderState('ERROR');
      }
    };

    if (file) load();
    return () => { controller.abort(); };
  }, [file, addLog]);

  // ─── Persist state ─────────────────────────────────────────────────────────

  useEffect(() => {
    const hash = docHashRef.current;
    if (!hash || readerState === 'LOADING' || readerState === 'ERROR') return;
    debouncedSave(hash, {
      page: currentPageIndex,
      word: currentWordIndex,
      wpm,
      dynamicSpeed: isDynamicSpeed,
      skimMode: isSkimMode,
      chunkSize,
      trainer: isTrainerMode,
      bookmarks,
    }, fileName, totalPageCount || pages.length, filePath);
  }, [currentPageIndex, currentWordIndex, wpm, isDynamicSpeed, isSkimMode, chunkSize, isTrainerMode, bookmarks, readerState, debouncedSave]);

  // ─── Preview countdown ────────────────────────────────────────────────────

  useEffect(() => {
    if (readerState === 'PREVIEW' && isPlaying) {
      setPreviewCountdown(3);
      const interval = window.setInterval(() => {
        setPreviewCountdown(prev => {
          if (prev <= 1) { clearInterval(interval); setReaderState('RSVP'); return 3; }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [readerState, isPlaying]);

  // ─── Page boundary handling ───────────────────────────────────────────────

  // Handles crossing from one page to the next and skipping empty/error pages.
  useEffect(() => {
    if (readerState !== 'RSVP') return;
    const currentPage = pages[currentPageIndex];
    if (!currentPage) return;

    if (currentPage.tokens.length === 0) {
      if (currentPageIndex < pages.length - 1) {
        setCurrentPageIndex(prev => prev + 1);
        setCurrentWordIndex(0);
        setReaderState('PREVIEW');
      } else {
        setIsPlaying(false);
      }
      return;
    }

    const currentWord = currentPage.tokens[currentWordIndex];

    if (currentWordIndex >= currentPage.tokens.length) {
      if (currentPageIndex < pages.length - 1) {
        setCurrentPageIndex(prev => prev + 1);
        setCurrentWordIndex(0);
        setReaderState('PREVIEW');
      } else {
        setIsPlaying(false);
      }
      return;
    }

    if (currentWord?.startsWith(IMG_PREFIX)) {
      setReaderState('IMAGE_INTERCEPT');
      setIsPlaying(false);
    }
  }, [readerState, currentWordIndex, currentPageIndex, pages]);

  // ─── Scheduler ────────────────────────────────────────────────────────────

  const currentPage = pages[currentPageIndex];
  const isSchedulerActive = readerState === 'RSVP' && isPlaying;

  const handleAdvance = useCallback((nextIndex: number) => {
    const page = pages[currentPageIndex];
    if (!page) return;

    // Accumulate stats for the word just shown.
    const now = performance.now();
    const durationMs = now - lastWordTickRef.current;
    lastWordTickRef.current = now;
    const isNewPage = currentPageIndex !== lastPageIndexRef.current;
    lastPageIndexRef.current = currentPageIndex;
    setSessionStats(prev => statsWithWord(prev, durationMs, isNewPage));

    if (nextIndex >= page.tokens.length) {
      if (currentPageIndex < pages.length - 1) {
        setCurrentPageIndex(prev => prev + 1);
        setCurrentWordIndex(0);
        setReaderState('PREVIEW');
      } else {
        setIsPlaying(false);
      }
    } else {
      setCurrentWordIndex(nextIndex);
    }
  }, [pages, currentPageIndex]);

  const handleTrainerBump = useCallback((delta: number) => {
    setWpm(prev => Math.min(prev + delta, 1500));
  }, []);

  useRsvpScheduler({
    isPlaying: isSchedulerActive,
    wpm,
    tokens: currentPage?.tokens ?? [],
    tokenMeta: currentPage?.tokenMeta,
    wordIndex: currentWordIndex,
    chunkSize,
    dynamicSpeed: isDynamicSpeed,
    skimMode: isSkimMode,
    trainerMode: isTrainerMode,
    trainerCeiling: 1500,
    onAdvance: handleAdvance,
    onTrainerBump: handleTrainerBump,
  });

  // ─── Controls ─────────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => {
      const nowPlaying = !prev;
      if (!nowPlaying && pauseStartRef.current === null) {
        pauseStartRef.current = Date.now();
      }
      if (nowPlaying && pauseStartRef.current !== null) {
        const pauseMs = Date.now() - pauseStartRef.current;
        pauseStartRef.current = null;
        const page = pages[currentPageIndex];
        if (page && isRegressionEnabled) {
          const regressTo = computeRegression(page.tokens, currentWordIndex, pauseMs, true);
          if (regressTo < currentWordIndex) setCurrentWordIndex(regressTo);
        }
      }
      return nowPlaying;
    });
  }, [pages, currentPageIndex, currentWordIndex, isRegressionEnabled]);

  const goToPage = useCallback((target: number) => {
    if (pages.length === 0) return;
    const clamped = Math.max(0, Math.min(pages.length - 1, target));
    setCurrentPageIndex(clamped);
    setCurrentWordIndex(0);
    setIsPlaying(false);
    setReaderState('PREVIEW');
    // Manual seek resets trainer streak.
  }, [pages.length]);

  const seekToWord = useCallback((wordIndex: number) => {
    setCurrentWordIndex(wordIndex);
    setReaderState('RSVP');
    setIsPlaying(true);
  }, []);

  const addBookmark = useCallback(() => {
    setBookmarks(prev => {
      if (prev.find(b => b.page === currentPageIndex && b.word === currentWordIndex)) return prev;
      return [...prev, { page: currentPageIndex, word: currentWordIndex }];
    });
  }, [currentPageIndex, currentWordIndex]);

  const triggerSummary = useCallback(async () => {
    setIsPlaying(false);
    setSummaryState('loading');
    setSummaryText(null);

    // Find chapter start: walk back while pages share the same chapterLabel.
    const currentChapter = pages[currentPageIndex]?.chapterLabel ?? null;
    let chapterStart = currentPageIndex;
    if (currentChapter) {
      for (let p = currentPageIndex - 1; p >= 0; p--) {
        if (pages[p]?.chapterLabel === currentChapter) chapterStart = p;
        else break;
      }
    }

    // Collect text from chapter start up to (and including) current word.
    const parts: string[] = [];
    for (let p = chapterStart; p <= currentPageIndex; p++) {
      const pg = pages[p];
      if (!pg) continue;
      const limit = p === currentPageIndex ? currentWordIndex + 1 : pg.tokens.length;
      const words = pg.tokens.slice(0, limit).filter(t => !t.startsWith(IMG_PREFIX));
      if (words.length > 0) parts.push(words.join(' '));
    }
    const fullText = parts.join('\n\n');

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).electronAPI;
      if (!api?.summarizeChapter) {
        throw new Error('Summary requires the Electron app (not available in browser).');
      }
      const result = await api.summarizeChapter(fullText, currentChapter ?? '');
      if (result.error) throw new Error(result.error);
      setSummaryText(result.summary ?? '(No summary returned)');
      setSummaryState('ready');
    } catch (err) {
      setSummaryText(err instanceof Error ? err.message : String(err));
      setSummaryState('error');
    }
  }, [pages, currentPageIndex, currentWordIndex]);

  const rewindWords = useCallback((steps: number) => {
    if (rewindTimerRef.current) clearTimeout(rewindTimerRef.current);
    setIsPlaying(false);
    setIsRewinding(true);
    const target = Math.max(0, currentWordIndex - steps);
    rewindPosRef.current = currentWordIndex;

    const tick = () => {
      rewindPosRef.current = Math.max(target, rewindPosRef.current - 1);
      setCurrentWordIndex(rewindPosRef.current);
      if (rewindPosRef.current > target) {
        rewindTimerRef.current = setTimeout(tick, 60);
      } else {
        setIsRewinding(false);
        setIsPlaying(true);
        rewindTimerRef.current = null;
      }
    };
    rewindTimerRef.current = setTimeout(tick, 0);
  }, [currentWordIndex]);

  const openNotePanel = useCallback(() => {
    const page = pages[currentPageIndex];
    if (!page) return;
    setIsPlaying(false);
    const selected = window.getSelection()?.toString().trim();
    setNoteQuote(selected || extractQuote(page.tokens, currentWordIndex));
    setNoteSaveState('idle');
    setNotePanelOpen(true);
  }, [pages, currentPageIndex, currentWordIndex]);

  const saveNote = useCallback(async (text: string) => {
    if (!filePath) {
      setNoteSaveState('error');
      return;
    }
    setNoteSaveState('saving');

    const page = pages[currentPageIndex];
    const chapterTitle = page?.chapterLabel ?? null;
    const chapterIndex = page?.chapterIndex ?? 0;

    // Build ordered chapter list from pages.
    const seen = new Map<string, number>();
    for (const p of pages) {
      if (p.chapterLabel && p.chapterIndex !== undefined && !seen.has(p.chapterLabel)) {
        seen.set(p.chapterLabel, p.chapterIndex);
      }
    }
    const allChapters = Array.from(seen.entries()).map(([label, index]) => ({ label, index }));

    const entry = buildNoteEntry(noteQuote, text, currentPageIndex + 1);
    const notesPath = deriveNotesPath(filePath);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).electronAPI;
      if (!api?.readNotes || !api?.writeNotes) throw new Error('Note saving requires the Electron app.');
      const existing: string | null = await api.readNotes(notesPath);
      const updated = insertIntoNotes(existing, entry, chapterTitle, chapterIndex, allChapters, fileName);
      const result = await api.writeNotes(notesPath, updated);
      if (!result.ok) throw new Error(result.error ?? 'Write failed');
      setNoteSaveState('saved');
      setTimeout(() => setNotePanelOpen(false), 700);
    } catch (err) {
      setNoteSaveState('error');
      console.error('Note save failed:', err);
    }
  }, [filePath, pages, currentPageIndex, noteQuote, fileName]);

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    // Don't hijack keys typed in an input/textarea (e.g. future search fields).
    const inInput = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      // While the note panel is open, only Escape is handled here.
      // All other keys go to the textarea directly.
      if (notePanelOpen) {
        if (e.code === 'Escape') { e.preventDefault(); setNotePanelOpen(false); }
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (readerState === 'IMAGE_INTERCEPT') {
          setCurrentWordIndex(prev => prev + 1);
          setReaderState('RSVP');
          setIsPlaying(true);
        } else if (readerState === 'PREVIEW') {
          // Skip the countdown and jump straight into reading.
          setReaderState('RSVP');
          setIsPlaying(true);
        } else {
          togglePlay();
        }
      } else if (e.code === 'Escape' && summaryState !== 'idle') {
        e.preventDefault();
        setSummaryState('idle');
        setSummaryText(null);
      } else if (e.code === 'Escape' && (readerState === 'RSVP' || readerState === 'IMAGE_INTERCEPT')) {
        e.preventDefault();
        setIsPlaying(false);
        setReaderState('PREVIEW');
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        goToPage(currentPageIndex + 1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (readerState === 'RSVP') {
          rewindWords(10);
        } else {
          goToPage(currentPageIndex - 1);
        }
      } else if (e.code === 'ArrowDown' && readerState === 'RSVP') {
        e.preventDefault();
        setIsPeeking(true);
        setIsPlaying(false);
      } else if (!inInput(e)) {
        // Single-letter + number shortcuts — skip when typing in inputs.
        if (e.code === 'KeyN') { e.preventDefault(); openNotePanel(); }
        else if (e.code === 'KeyS') {
          e.preventDefault();
          if (summaryState !== 'idle') { setSummaryState('idle'); setSummaryText(null); }
          else { void triggerSummary(); }
        } else if (e.code === 'KeyB') { e.preventDefault(); addBookmark(); }
        else if (e.code === 'KeyA') { e.preventDefault(); setIsDynamicSpeed(v => !v); }
        else if (e.code === 'KeyK') { e.preventDefault(); setIsSkimMode(v => !v); }
        else if (e.code === 'KeyW') { e.preventDefault(); setIsRegressionEnabled(v => !v); }
        else if (e.code === 'KeyF') { e.preventDefault(); setIsPeripheralMode(v => !v); }
        else if (e.code === 'KeyT') { e.preventDefault(); setIsTrainerMode(v => !v); }
        else if (e.code === 'Digit0') { e.preventDefault(); setChunkSize(0); }
        else if (e.code === 'Digit1') { e.preventDefault(); setChunkSize(1); }
        else if (e.code === 'Digit2') { e.preventDefault(); setChunkSize(2); }
        else if (e.code === 'Digit3') { e.preventDefault(); setChunkSize(3); }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowDown' && isPeeking) {
        setIsPeeking(false);
        setIsPlaying(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [togglePlay, readerState, goToPage, currentPageIndex, addBookmark, isPeeking, summaryState, triggerSummary, notePanelOpen, openNotePanel, rewindWords]);

  // ─── Derived render values ────────────────────────────────────────────────

  // Compute chunk indices for display (multi-word chunking for F2).
  const chunks = useMemo(() => {
    if (!currentPage) return [];
    const effective = chunkSize === 0 ? autoChunkSize(wpm) : chunkSize;
    if (effective <= 1) return currentPage.tokens.map((_, i) => [i]);
    return chunkTokens(currentPage.tokens, currentPage.tokenMeta ?? [], effective);
  }, [currentPage, chunkSize, wpm]);

  const currentChunk = useMemo(() => {
    return chunks.find(c => c.includes(currentWordIndex)) ?? [currentWordIndex];
  }, [chunks, currentWordIndex]);

  // Build the display word (joined chunk for multi-word display).
  const displayTokens = currentPage?.tokens ?? [];
  const chunkWords = currentChunk
    .filter(i => i < displayTokens.length && !displayTokens[i].startsWith(IMG_PREFIX))
    .map(i => displayTokens[i]);
  const displayWord = chunkWords.join(' '); // non-breaking space — regular space collapses at the ORP split point

  const getORP = (word: string) => {
    const len = word.length;
    if (len <= 1) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 13) return 3;
    return 4;
  };
  const orpIndex = getORP(displayWord);
  const prefix = displayWord.substring(0, orpIndex);
  const focus = displayWord[orpIndex] || '';
  const suffix = displayWord.substring(orpIndex + 1);

  // Union box: spans all word boxes in the current chunk (PDF only).
  const chunkBox = useMemo(() => {
    if (!currentPage?.wordBoxes) return undefined;
    const chunkBoxes = currentChunk
      .filter(i => i < (currentPage.wordBoxes?.length ?? 0))
      .map(i => currentPage.wordBoxes![i])
      .filter(Boolean);
    return chunkBoxes.length > 0 ? unionBoxes(chunkBoxes) : undefined;
  }, [currentPage, currentChunk]);

  const displayTotal = totalPageCount || pages.length;
  const withinPage = currentPage ? currentWordIndex / Math.max(1, currentPage.tokens.length) : 0;
  const progressPct = displayTotal
    ? Math.min(100, Math.round(((currentPageIndex + withinPage) / displayTotal) * 100))
    : 0;

  const bookmarkedPages = useMemo(() => new Set(bookmarks.map(b => b.page)), [bookmarks]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (readerState === 'LOADING') {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-6"></div>
        <p className="text-xl font-bold text-indigo-400 animate-pulse">Syncing Pages...</p>
        <div className="mt-8 w-full max-w-sm bg-black/40 rounded-xl p-4 font-mono text-[10px] text-slate-500 border border-slate-800">
          {logs.map((log, i) => <div key={i} className="truncate">{log}</div>)}
        </div>
      </div>
    );
  }

  if (readerState === 'ERROR') {
    return (
      <div className="flex flex-col items-center justify-center h-96 bg-slate-900/50 border border-red-500/20 rounded-3xl p-8 text-center">
        <AlertCircle className="w-16 h-16 text-red-400 mb-6" />
        <h2 className="text-2xl font-bold text-white mb-2">Sync Failed</h2>
        <p className="text-slate-400 max-w-md">{error}</p>
        <button onClick={() => window.location.reload()} className="mt-8 px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-full font-bold transition-all">Retry</button>
      </div>
    );
  }

  const currentWord = currentPage?.tokens[currentWordIndex] || '';

  return (
    <div className="flex gap-5 w-full mx-auto items-start">
      {/* Summary modal */}
      {summaryState !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
          <div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => { setSummaryState('idle'); setSummaryText(null); }}
          />
          <div className="relative max-w-xl w-full bg-slate-900 border border-slate-700 rounded-3xl p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em]">Chapter Summary</span>
                {summaryState === 'ready' && (
                  <span className="text-[9px] text-slate-600 font-mono">Apple Intelligence</span>
                )}
              </div>
              <button
                onClick={() => { setSummaryState('idle'); setSummaryText(null); }}
                className="text-[9px] font-mono bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg px-2 py-1 transition-colors"
              >
                S / Esc
              </button>
            </div>

            {summaryState === 'loading' && (
              <div className="flex flex-col items-center gap-4 py-10">
                <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                <p className="text-slate-400 text-sm">Summarizing with Apple Intelligence…</p>
                <p className="text-slate-600 text-xs">On-device · No network required</p>
              </div>
            )}

            {summaryState === 'ready' && (
              <p className="text-slate-200 text-[15px] leading-relaxed">{summaryText}</p>
            )}

            {summaryState === 'error' && (
              <div className="space-y-2">
                <p className="text-red-400 text-sm font-bold">Summary unavailable</p>
                <p className="text-slate-400 text-sm leading-relaxed">{summaryText}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Note panel */}
      {notePanelOpen && (
        <NotePanel
          quote={noteQuote}
          chapterTitle={pages[currentPageIndex]?.chapterLabel ?? null}
          pageNum={currentPageIndex + 1}
          saveState={noteSaveState}
          hasFilePath={!!filePath}
          fileName={fileName}
          onSave={saveNote}
          onClose={() => setNotePanelOpen(false)}
        />
      )}

      {/* Resume toast */}
      {resumeToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-full shadow-xl animate-in fade-in slide-in-from-top-2 duration-300">
          {resumeToast}
        </div>
      )}

      {/* ── Main column ── */}
      <div className="flex-1 min-w-0 space-y-4">

      {/* Display area */}
      <div className="relative h-[clamp(420px,70vh,1100px)] bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl transition-all duration-500">

        {readerState === 'PREVIEW' && (
          <div className="absolute inset-0 flex flex-col animate-in fade-in duration-500">
            <PagePreview page={currentPage} currentWordIndex={currentWordIndex} chunkBox={chunkBox} faded={false} peeking={false} onWordClick={seekToWord} />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent pointer-events-none" />
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
              <div className="px-4 py-2 bg-indigo-500 text-white rounded-full font-black text-sm shadow-xl flex items-center gap-2">
                <Eye size={16} />
                PREVIEWING PAGE {currentPageIndex + 1} ({previewCountdown}s)
              </div>
            </div>
          </div>
        )}

        {readerState === 'RSVP' && (
          <div className={`absolute inset-0 flex flex-col transition-all duration-500 ${isPeripheralMode ? 'bg-black' : 'bg-slate-900'}`}>
            {!isPeripheralMode && (
              <div className="absolute inset-0 flex flex-col">
                <PagePreview page={currentPage} currentWordIndex={currentWordIndex} chunkBox={chunkBox} faded={!isPeeking} peeking={isPeeking} onWordClick={seekToWord} />
              </div>
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className={`absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150 ${isRewinding ? 'bg-cyan-500/15' : 'bg-indigo-500/10'}`}></div>
              {isRewinding && (
                <div className="absolute top-5 px-3 py-1 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-[11px] font-black tracking-[0.3em] uppercase font-mono text-cyan-300 select-none">
                  ◀◀ REWIND
                </div>
              )}
              <div className={`font-mono font-bold flex px-6 py-4 rounded-3xl backdrop-blur-sm text-[clamp(2rem,6vw,4.5rem)] transition-all duration-150 ${isRewinding ? 'bg-cyan-950/60 scale-95' : 'bg-slate-950/70'} ${isPeripheralMode && !isRewinding ? 'scale-110' : ''}`}>
                <span className={`text-right flex-1 min-w-[300px] transition-all duration-150 ${isPeripheralMode ? 'opacity-0 scale-95' : isRewinding ? 'text-cyan-900/80' : 'text-slate-500'}`}>{prefix}</span>
                <span className={`transition-colors duration-100 ${isRewinding ? 'text-cyan-400 drop-shadow-[0_0_25px_rgba(34,211,238,0.6)]' : 'text-indigo-400 drop-shadow-[0_0_25px_rgba(129,140,248,0.5)]'}`}>{focus}</span>
                <span className={`text-left flex-1 min-w-[300px] transition-all duration-150 ${isPeripheralMode ? 'opacity-0 scale-95' : isRewinding ? 'text-cyan-900/80' : 'text-slate-300'}`}>{suffix}</span>
              </div>
            </div>
          </div>
        )}

        {readerState === 'IMAGE_INTERCEPT' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 p-12 bg-slate-900 animate-in zoom-in duration-300">
            <img src={currentWord.slice(IMG_PREFIX.length)} className="max-h-[350px] rounded-2xl shadow-2xl border border-slate-700" alt="Illustration" />
            <button
              onClick={() => { setCurrentWordIndex(prev => prev + 1); setReaderState('RSVP'); setIsPlaying(true); }}
              className="px-10 py-4 bg-indigo-500 hover:bg-indigo-400 text-white rounded-full font-black shadow-xl transition-all active:scale-95"
            >
              RESUME FLOW
            </button>
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      <ThumbnailStrip
        pages={pages}
        currentIndex={currentPageIndex}
        bookmarkedPages={bookmarkedPages}
        onNavigate={goToPage}
        collapsed={stripCollapsed}
        onToggleCollapse={() => setStripCollapsed(c => !c)}
      />

      {/* Controls */}
      <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <button onClick={() => goToPage(currentPageIndex - 1)} disabled={currentPageIndex === 0} className="p-3 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all disabled:opacity-30 disabled:hover:bg-transparent" title="Previous page (←)"><SkipBack size={22} /></button>
            <button onClick={() => setCurrentWordIndex(Math.max(0, currentWordIndex - 25))} className="p-3 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all" title="Rewind 25 words"><Rewind size={26} /></button>
            <button onClick={togglePlay} className="w-18 h-18 flex items-center justify-center bg-indigo-500 hover:bg-indigo-400 text-white rounded-[1.5rem] shadow-xl shadow-indigo-500/30 transition-all active:scale-95 px-5 py-4" title="Play / Pause (Space)">
              {isPlaying ? <Pause size={36} fill="currentColor" /> : <Play size={36} className="ml-0.5" fill="currentColor" />}
            </button>
            <button onClick={() => setCurrentWordIndex(Math.min((currentPage?.tokens.length ?? 1) - 1, currentWordIndex + 25))} className="p-3 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all" title="Forward 25 words"><FastForward size={26} /></button>
            <button onClick={() => goToPage(currentPageIndex + 1)} disabled={currentPageIndex === pages.length - 1} className="p-3 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all disabled:opacity-30 disabled:hover:bg-transparent" title="Next page (→)"><SkipForward size={22} /></button>
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-indigo-500 uppercase tracking-[0.3em]">Neural Velocity</p>
              <div className="flex items-center gap-3">
                <p className="text-3xl font-mono font-black text-white">{wpm} <span className="text-sm font-bold text-slate-600 uppercase">WPM</span></p>
                <button
                  onClick={() => setSidebarOpen(v => !v)}
                  title={sidebarOpen ? 'Hide features panel' : 'Show features panel'}
                  className={`p-1.5 rounded-lg transition-all ${sidebarOpen ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}
                >
                  <SlidersHorizontal size={15} />
                </button>
              </div>
            </div>
            <input type="range" min="100" max="2000" step="25" value={wpm} onChange={(e) => setWpm(parseInt(e.target.value))} className="w-full h-3 bg-slate-800 rounded-full appearance-none cursor-pointer accent-indigo-500 transition-all" />
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-slate-800/50">
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Library Progress</p>
              <p className="text-lg font-mono font-bold text-slate-400">PAGE {currentPageIndex + 1} <span className="text-xs text-slate-600">/ {displayTotal || '…'}</span></p>
            </div>
            <p className="text-4xl font-mono font-black text-indigo-500/30">{progressPct}%</p>
          </div>
          <div className="h-3 w-full bg-slate-800/50 rounded-full p-0.5 border border-slate-700/50 shadow-inner">
            <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-1000 ease-out shadow-[0_0_12px_rgba(99,102,241,0.5)]" style={{ width: `${progressPct}%` }}></div>
          </div>

          {sessionStats.wordsShown > 0 && (
            <div className="flex justify-between pt-1 border-t border-slate-800/30">
              <StatChip label="Words" value={sessionStats.wordsShown.toLocaleString()} />
              <StatChip label="Active" value={formatTime(sessionStats.activeMs)} />
              <StatChip label="Eff. WPM" value={String(sessionStats.effectiveWpm)} />
              <StatChip label="Pages" value={String(sessionStats.pagesRead)} />
            </div>
          )}
        </div>
      </div>

      </div>{/* end main column */}

      {/* ── Feature sidebar ── */}
      {sidebarOpen && <aside className="w-44 flex-none flex flex-col space-y-1.5 sticky top-4">
        <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.25em] px-1 pb-0.5">Features</p>

        <SideToggle hotkey="A" active={isDynamicSpeed}      onClick={() => setIsDynamicSpeed(v => !v)}      label="Adaptive Cadence" sub="Paces for syntax" />
        <SideToggle hotkey="K" active={isSkimMode}          onClick={() => setIsSkimMode(v => !v)}          label="Skim Mode"         sub="Rush function words" />
        <SideToggle hotkey="W" active={isRegressionEnabled} onClick={() => setIsRegressionEnabled(v => !v)} label="Auto Rewind"        sub="Rewinds to sentence on 2s pause" />
        <SideToggle hotkey="F" active={isPeripheralMode}    onClick={() => setIsPeripheralMode(v => !v)}    label="Focus Lockdown"    sub="Remove page context" />
        <SideToggle hotkey="T" active={isTrainerMode}       onClick={() => setIsTrainerMode(v => !v)}       label="Trainer"           sub="Auto-nudge WPM up" />

        <div className="pt-1.5 border-t border-slate-800/50 space-y-1.5">
          <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.25em] px-1 pb-0.5">Actions</p>

          <button
            onClick={() => void triggerSummary()}
            disabled={summaryState === 'loading'}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl transition-all text-left group ${summaryState === 'loading' ? 'bg-indigo-500/10 border border-indigo-500/30' : 'bg-slate-800/30 hover:bg-slate-800'}`}
          >
            <kbd className="text-[9px] font-black font-mono bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 min-w-[18px] text-center leading-none">S</kbd>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-slate-400 group-hover:text-slate-200 truncate">
                {summaryState === 'loading' ? 'Summarizing…' : 'Summarize'}
              </p>
              <p className="text-[9px] text-slate-600">Apple Intelligence</p>
            </div>
            {summaryState === 'loading' && (
              <div className="w-3 h-3 border border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin flex-none" />
            )}
          </button>

          <button onClick={openNotePanel} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl bg-slate-800/30 hover:bg-slate-800 transition-all text-left group">
            <kbd className="text-[9px] font-black font-mono bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 min-w-[18px] text-center leading-none">N</kbd>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-slate-400 group-hover:text-slate-200 truncate">Note</p>
              <p className="text-[9px] text-slate-600">Quote + annotate</p>
            </div>
          </button>

          <button onClick={addBookmark} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl bg-slate-800/30 hover:bg-slate-800 transition-all text-left group">
            <kbd className="text-[9px] font-black font-mono bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 min-w-[18px] text-center leading-none">B</kbd>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-slate-400 group-hover:text-slate-200 truncate">Bookmark</p>
              <p className="text-[9px] text-slate-600">{bookmarks.length} saved</p>
            </div>
            <Bookmark size={9} className="flex-none text-slate-600" />
          </button>

          <button
            onPointerDown={() => { setIsPeeking(true); setIsPlaying(false); }}
            onPointerUp={() => { setIsPeeking(false); setIsPlaying(true); }}
            onPointerLeave={() => { if (isPeeking) { setIsPeeking(false); setIsPlaying(true); } }}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl transition-all text-left group select-none touch-none ${isPeeking ? 'bg-indigo-500/20 border border-indigo-500/40' : 'bg-slate-800/30 hover:bg-slate-800'}`}
          >
            <kbd className="text-[9px] font-black font-mono bg-slate-700 text-slate-300 rounded px-1 py-0.5 min-w-[18px] text-center leading-none">↓</kbd>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-slate-400 group-hover:text-slate-200 truncate">Context Peek</p>
              <p className="text-[9px] text-slate-600">Hold to unfade</p>
            </div>
            <EyeOff size={9} className="flex-none text-slate-600" />
          </button>
        </div>

        <div className="pt-1.5 border-t border-slate-800/50">
          <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.25em] px-1 pb-1.5">Words / Flash</p>
          <div className="grid grid-cols-4 gap-1 px-1">
            {([0, 1, 2, 3] as const).map(n => (
              <button
                key={n}
                onClick={() => setChunkSize(n)}
                title={n === 0 ? `Auto (${autoChunkSize(wpm)} @ ${wpm} WPM)` : `${n} word${n > 1 ? 's' : ''} per flash`}
                className={`py-1.5 rounded-lg text-[11px] font-black transition-all ${chunkSize === n ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300'}`}
              >
                {n === 0 ? 'A' : n}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-slate-600 text-center mt-1">keys: 0 · 1 · 2 · 3</p>
          {chunkSize === 0 && <p className="text-[9px] text-indigo-500/60 text-center">{autoChunkSize(wpm)}w @ {wpm} WPM</p>}
        </div>

        <div className="pt-1.5 border-t border-slate-800/50">
          <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.25em] px-1 pb-1.5">Navigation</p>
          <div className="space-y-0.5 px-1">
            {([['Space', 'Play / pause'], ['← →', 'Prev / next page'], ['↓ hold', 'Peek at page']] as const).map(([key, desc]) => (
              <div key={key} className="flex items-center gap-2">
                <kbd className="text-[9px] font-mono bg-slate-800 text-slate-400 rounded px-1.5 py-0.5 whitespace-nowrap">{key}</kbd>
                <span className="text-[9px] text-slate-600 truncate">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-1.5 border-t border-slate-800/50">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.25em]">Bookmarks</p>
            {bookmarks.length > 0 && (
              <span className="text-[9px] text-slate-600">{bookmarks.length}</span>
            )}
          </div>
          {bookmarks.length === 0 ? (
            <p className="text-[9px] text-slate-700 px-1">Press <kbd className="font-mono bg-slate-800 text-slate-500 rounded px-1">B</kbd> to save position</p>
          ) : (
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {[...bookmarks].reverse().map((b, i) => (
                <button
                  key={i}
                  onClick={() => { goToPage(b.page); setCurrentWordIndex(b.word); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/30 hover:bg-indigo-500/10 border border-transparent hover:border-indigo-500/25 transition-all text-left group"
                >
                  <Bookmark size={8} className="text-indigo-400 fill-indigo-400 flex-none" />
                  <span className="text-[10px] font-medium text-slate-400 group-hover:text-indigo-300 transition-colors">Page {b.page + 1}</span>
                  <span className="ml-auto text-[8px] text-slate-600 tabular-nums">w.{b.word}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>}

    </div>
  );
};


interface NotePanelProps {
  quote: string;
  chapterTitle: string | null;
  pageNum: number;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  hasFilePath: boolean;
  fileName: string;
  onSave: (text: string) => void;
  onClose: () => void;
}

const NotePanel: React.FC<NotePanelProps> = ({ quote, chapterTitle, pageNum, saveState, hasFilePath, fileName, onSave, onClose }) => {
  const [text, setText] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    // Slight delay so the animation starts before focus is grabbed.
    const id = setTimeout(() => textareaRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (saveState === 'idle' && text.trim()) onSave(text);
    }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-w-xl w-full bg-slate-900 border border-slate-700 rounded-3xl p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em]">Note</p>
            {chapterTitle && <p className="text-[11px] text-slate-500 truncate max-w-[300px]">{chapterTitle} · p. {pageNum}</p>}
            {!chapterTitle && <p className="text-[11px] text-slate-500">p. {pageNum}</p>}
          </div>
          <button onClick={onClose} className="text-[9px] font-mono bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg px-2 py-1 transition-colors">
            Esc
          </button>
        </div>

        {/* Quote */}
        <blockquote className="border-l-2 border-amber-500/40 pl-4 text-slate-400 text-[13px] leading-relaxed italic">
          {quote || '(no text at current position)'}
        </blockquote>

        {/* Note textarea */}
        {!hasFilePath ? (
          <p className="text-slate-500 text-sm">Open a file from disk to enable note saving.</p>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Your note… (Enter to save, Shift+Enter for new line)"
              rows={4}
              className="w-full bg-slate-800 border border-slate-700 focus:border-amber-500/50 rounded-xl px-4 py-3 text-slate-200 text-sm leading-relaxed resize-none outline-none placeholder-slate-600 transition-colors"
            />

            <div className="flex items-center justify-between">
              <p className="text-[9px] text-slate-600 font-mono">saved to …{fileName.slice(-30)}.notes.md</p>
              <button
                onClick={() => { if (text.trim()) onSave(text); }}
                disabled={!text.trim() || saveState !== 'idle'}
                className={`px-5 py-2 rounded-xl text-[11px] font-black transition-all ${
                  saveState === 'saved' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                  saveState === 'saving' ? 'bg-slate-700 text-slate-400' :
                  saveState === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                  'bg-amber-500 hover:bg-amber-400 text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                {saveState === 'saved' ? 'Saved ✓' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Error — retry?' : 'Done'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const StatChip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col items-center gap-0.5">
    <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">{label}</span>
    <span className="text-sm font-mono font-bold text-slate-400">{value}</span>
  </div>
);

const SideToggle: React.FC<{ hotkey: string; active: boolean; onClick: () => void; label: string; sub: string }> = ({ hotkey, active, onClick, label, sub }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all text-left group ${active ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-slate-800/30 border-transparent hover:bg-slate-800 hover:border-slate-700'}`}
  >
    <kbd className={`text-[9px] font-black font-mono rounded px-1.5 py-0.5 min-w-[18px] text-center leading-none flex-none ${active ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'}`}>{hotkey}</kbd>
    <div className="min-w-0 flex-1">
      <p className={`text-[11px] font-bold truncate ${active ? 'text-indigo-300' : 'text-slate-400 group-hover:text-slate-200'}`}>{label}</p>
      <p className="text-[9px] text-slate-600 truncate">{sub}</p>
    </div>
    <span className={`w-1.5 h-1.5 rounded-full flex-none ${active ? 'bg-indigo-400' : 'bg-slate-700'}`} />
  </button>
);

export default RSVPReader;
