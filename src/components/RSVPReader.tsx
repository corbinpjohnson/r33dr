import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, FastForward, Rewind, AlertCircle, Eye, SkipBack, SkipForward, Bookmark } from 'lucide-react';
import { loadEpub } from '../loaders/epub';
import { loadPdf } from '../loaders/pdf';
import { ocrCanvas, releaseOcrWorker } from '../loaders/ocr';
import { IMG_PREFIX, type PageData } from '../loaders/types';
import PagePreview from './PagePreview';
import ThumbnailStrip from './ThumbnailStrip';
import {
  hashDocument,
  loadDocState,
  saveDocState,
  loadGlobalSettings,
  makeDebounced,
  type Bookmark as BookmarkEntry,
} from '../lib/persistence';

interface RSVPReaderProps {
  file: ArrayBuffer;
}

type ReaderState = 'LOADING' | 'PREVIEW' | 'RSVP' | 'IMAGE_INTERCEPT' | 'ERROR';

// PDFs begin with "%PDF"; EPUB (a zip) begins with "PK".
function isPdf(buffer: ArrayBuffer): boolean {
  const sig = new Uint8Array(buffer, 0, 4);
  return sig[0] === 0x25 && sig[1] === 0x50 && sig[2] === 0x44 && sig[3] === 0x46;
}

const RSVPReader: React.FC<RSVPReaderProps> = ({ file }) => {
  const [pages, setPages] = useState<PageData[]>([]);
  const [totalPageCount, setTotalPageCount] = useState<number>(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [wpm, setWpm] = useState(300);
  const [isPlaying, setIsPlaying] = useState(false);
  const [readerState, setReaderState] = useState<ReaderState>('LOADING');
  const [isDynamicSpeed, setIsDynamicSpeed] = useState(false);
  const [isPeripheralMode, setIsPeripheralMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [previewCountdown, setPreviewCountdown] = useState(3);
  const [resumeToast, setResumeToast] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [stripCollapsed, setStripCollapsed] = useState(false);

  const timerRef = useRef<number | null>(null);
  const urlRegistryRef = useRef<string[]>([]);
  const docHashRef = useRef<string | null>(null);

  const addLog = useCallback((msg: string) => {
    console.log(msg);
    setLogs(prev => [...prev.slice(-10), msg]);
  }, []);

  // Debounced persistence save — fires at most once per second while reading.
  const debouncedSave = useRef(
    makeDebounced((hash: string, state: Parameters<typeof saveDocState>[1]) => {
      saveDocState(hash, state);
    }, 1000),
  ).current;

  // ─── Load effect ──────────────────────────────────────────────────────────

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
      addLog('--- Continuous Page Deep Scan ---');

      // Compute doc hash and load saved state in parallel with the file parse
      // (hash is fast — completes well before the first page finishes).
      const hashPromise = hashDocument(file);

      const onMeta = (total: number) => {
        setTotalPageCount(total);
      };

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

          // Restore saved position now that we have the full doc.
          const hash = await hashPromise;
          docHashRef.current = hash;
          const saved = loadDocState(hash);
          if (saved && saved.page < allPages.length) {
            setCurrentPageIndex(saved.page);
            setCurrentWordIndex(saved.word);
            setWpm(saved.wpm);
            setIsDynamicSpeed(saved.dynamicSpeed);
            setBookmarks(saved.bookmarks ?? []);
            setResumeToast(`Resumed at page ${saved.page + 1}`);
            setTimeout(() => setResumeToast(null), 3000);
          } else {
            // First load — persist global default settings.
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

  // ─── Persist reading position (debounced) ─────────────────────────────────

  useEffect(() => {
    const hash = docHashRef.current;
    if (!hash || readerState === 'LOADING' || readerState === 'ERROR') return;
    debouncedSave(hash, {
      page: currentPageIndex,
      word: currentWordIndex,
      wpm,
      dynamicSpeed: isDynamicSpeed,
      skimMode: false,
      chunkSize: 0,
      trainer: false,
      bookmarks,
    });
  }, [currentPageIndex, currentWordIndex, wpm, isDynamicSpeed, bookmarks, readerState, debouncedSave]);

  // ─── Preview countdown ────────────────────────────────────────────────────

  useEffect(() => {
    if (readerState === 'PREVIEW' && isPlaying) {
      setPreviewCountdown(3);
      const interval = window.setInterval(() => {
        setPreviewCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            setReaderState('RSVP');
            return 3;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [readerState, isPlaying]);

  // ─── RSVP word advance ────────────────────────────────────────────────────

  useEffect(() => {
    if (readerState === 'RSVP' && isPlaying) {
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

      const currentWord = currentPage.tokens[currentWordIndex];

      if (currentWord.startsWith(IMG_PREFIX)) {
        setReaderState('IMAGE_INTERCEPT');
        setIsPlaying(false);
        return;
      }

      let speedFactor = 1;
      if (isDynamicSpeed) {
        if (currentWord.length > 10) speedFactor = 0.75;
        if (/[.!?]$/.test(currentWord)) speedFactor = 0.5;
        if (/,$/.test(currentWord)) speedFactor = 0.8;
      }

      const delay = (60 / (wpm * speedFactor)) * 1000;
      timerRef.current = window.setTimeout(() => {
        setCurrentWordIndex(prev => prev + 1);
      }, delay);

      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }
  }, [readerState, isPlaying, currentWordIndex, currentPageIndex, pages, wpm, isDynamicSpeed]);

  // ─── Controls ─────────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  const goToPage = useCallback((target: number) => {
    if (pages.length === 0) return;
    const clamped = Math.max(0, Math.min(pages.length - 1, target));
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrentPageIndex(clamped);
    setCurrentWordIndex(0);
    setReaderState('PREVIEW');
  }, [pages.length]);

  const addBookmark = useCallback(() => {
    setBookmarks(prev => {
      const already = prev.find(b => b.page === currentPageIndex && b.word === currentWordIndex);
      if (already) return prev; // don't duplicate
      return [...prev, { page: currentPageIndex, word: currentWordIndex }];
    });
  }, [currentPageIndex, currentWordIndex]);

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (readerState === 'IMAGE_INTERCEPT') {
          setCurrentWordIndex(prev => prev + 1);
          setReaderState('RSVP');
          setIsPlaying(true);
        } else {
          togglePlay();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        goToPage(currentPageIndex + 1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        goToPage(currentPageIndex - 1);
      } else if (e.code === 'KeyB') {
        e.preventDefault();
        addBookmark();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, readerState, goToPage, currentPageIndex, addBookmark]);

  // ─── Derived ──────────────────────────────────────────────────────────────

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

  const currentPage = pages[currentPageIndex];
  const currentWord = currentPage?.tokens[currentWordIndex] || '';

  const getORP = (word: string) => {
    const len = word.length;
    if (len <= 1) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 13) return 3;
    return 4;
  };

  const orpIndex = getORP(currentWord);
  const prefix = currentWord.substring(0, orpIndex);
  const focus = currentWord[orpIndex] || '';
  const suffix = currentWord.substring(orpIndex + 1);

  const displayTotal = totalPageCount || pages.length;
  const withinPage = currentPage ? currentWordIndex / Math.max(1, currentPage.tokens.length) : 0;
  const progressPct = displayTotal
    ? Math.min(100, Math.round(((currentPageIndex + withinPage) / displayTotal) * 100))
    : 0;

  const bookmarkedPages = new Set(bookmarks.map(b => b.page));

  return (
    <div className="space-y-4 w-full mx-auto">
      {/* Resume toast */}
      {resumeToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-full shadow-xl animate-in fade-in slide-in-from-top-2 duration-300">
          {resumeToast}
        </div>
      )}

      {/* Dynamic Display Area */}
      <div className="relative h-[clamp(420px,70vh,1100px)] bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl transition-all duration-500">

        {/* PREVIEW */}
        {readerState === 'PREVIEW' && (
          <div className="absolute inset-0 flex flex-col animate-in fade-in duration-500">
            <PagePreview page={currentPage} currentWordIndex={currentWordIndex} faded={false} />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent pointer-events-none" />
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
              <div className="px-4 py-2 bg-indigo-500 text-white rounded-full font-black text-sm shadow-xl flex items-center gap-2">
                <Eye size={16} />
                PREVIEWING PAGE {currentPageIndex + 1} ({previewCountdown}s)
              </div>
            </div>
          </div>
        )}

        {/* RSVP */}
        {readerState === 'RSVP' && (
          <div className={`absolute inset-0 flex flex-col transition-all duration-500 ${isPeripheralMode ? 'bg-black' : 'bg-slate-900'}`}>
            {!isPeripheralMode && (
              <div className="absolute inset-0 flex flex-col">
                <PagePreview page={currentPage} currentWordIndex={currentWordIndex} faded={true} />
              </div>
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-indigo-500/10 -translate-x-1/2"></div>
              <div className={`text-7xl font-mono font-bold flex transition-all duration-300 px-8 py-4 rounded-3xl bg-slate-950/70 backdrop-blur-sm ${isPeripheralMode ? 'scale-110' : ''}`}>
                <span className={`text-right flex-1 min-w-[300px] transition-all duration-300 ${isPeripheralMode ? 'opacity-0 scale-95' : 'text-slate-500'}`}>{prefix}</span>
                <span className="text-indigo-400 drop-shadow-[0_0_25px_rgba(129,140,248,0.5)]">{focus}</span>
                <span className={`text-left flex-1 min-w-[300px] transition-all duration-300 ${isPeripheralMode ? 'opacity-0 scale-95' : 'text-slate-300'}`}>{suffix}</span>
              </div>
            </div>
          </div>
        )}

        {/* IMAGE_INTERCEPT */}
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

      {/* Thumbnail strip (F7) */}
      <ThumbnailStrip
        pages={pages}
        currentIndex={currentPageIndex}
        bookmarkedPages={bookmarkedPages}
        onNavigate={goToPage}
        collapsed={stripCollapsed}
        onToggleCollapse={() => setStripCollapsed(c => !c)}
      />

      {/* Controls */}
      <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 space-y-8 shadow-2xl">
        <div className="flex items-center justify-between gap-12">
          <div className="flex items-center gap-4">
            <button onClick={() => goToPage(currentPageIndex - 1)} disabled={currentPageIndex === 0} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all disabled:opacity-30 disabled:hover:bg-transparent" title="Previous page (←)"><SkipBack size={28} /></button>
            <button onClick={() => setCurrentWordIndex(Math.max(0, currentWordIndex - 25))} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all"><Rewind size={32} /></button>
            <button onClick={togglePlay} className="w-24 h-24 flex items-center justify-center bg-indigo-500 hover:bg-indigo-400 text-white rounded-[2rem] shadow-xl shadow-indigo-500/30 transition-all active:scale-95">
              {isPlaying ? <Pause size={48} fill="currentColor" /> : <Play size={48} className="ml-1" fill="currentColor" />}
            </button>
            <button onClick={() => setCurrentWordIndex(Math.min((currentPage?.tokens.length ?? 1) - 1, currentWordIndex + 25))} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all"><FastForward size={32} /></button>
            <button onClick={() => goToPage(currentPageIndex + 1)} disabled={currentPageIndex === pages.length - 1} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all disabled:opacity-30 disabled:hover:bg-transparent" title="Next page (→)"><SkipForward size={28} /></button>
          </div>

          <div className="flex-1 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-indigo-500 uppercase tracking-[0.3em]">Neural Velocity</p>
              <p className="text-4xl font-mono font-black text-white">{wpm} <span className="text-sm font-bold text-slate-600 uppercase">WPM</span></p>
            </div>
            <input type="range" min="100" max="2000" step="25" value={wpm} onChange={(e) => setWpm(parseInt(e.target.value))} className="w-full h-3 bg-slate-800 rounded-full appearance-none cursor-pointer accent-indigo-500 transition-all" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <button onClick={() => setIsDynamicSpeed(!isDynamicSpeed)} className={`flex flex-col items-start p-5 rounded-2xl border-2 transition-all ${isDynamicSpeed ? 'bg-indigo-500/10 border-indigo-500/50' : 'bg-slate-800/30 border-transparent hover:border-slate-700'}`}>
            <span className={`text-xs font-black uppercase tracking-widest ${isDynamicSpeed ? 'text-indigo-400' : 'text-slate-500'}`}>Adaptive Cadence</span>
            <p className="text-[11px] text-slate-500 mt-1">Slows for syntax.</p>
          </button>
          <button onClick={() => setIsPeripheralMode(!isPeripheralMode)} className={`flex flex-col items-start p-5 rounded-2xl border-2 transition-all ${isPeripheralMode ? 'bg-indigo-500/10 border-indigo-500/50' : 'bg-slate-800/30 border-transparent hover:border-slate-700'}`}>
            <span className={`text-xs font-black uppercase tracking-widest ${isPeripheralMode ? 'text-indigo-400' : 'text-slate-500'}`}>Focus Lockdown</span>
            <p className="text-[11px] text-slate-500 mt-1">Remove page context.</p>
          </button>
          <button onClick={addBookmark} title="Bookmark current position (B)" className="flex flex-col items-start p-5 rounded-2xl border-2 border-transparent hover:border-slate-700 bg-slate-800/30 transition-all">
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <Bookmark size={12} /> Bookmark
            </span>
            <p className="text-[11px] text-slate-500 mt-1">{bookmarks.length} saved</p>
          </button>
        </div>

        <div className="space-y-4 pt-4 border-t border-slate-800/50">
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Library Progress</p>
              <p className="text-xl font-mono font-bold text-slate-400">PAGE {currentPageIndex + 1} <span className="text-xs text-slate-600">/ {displayTotal || '…'}</span></p>
            </div>
            <p className="text-5xl font-mono font-black text-indigo-500/30">{progressPct}%</p>
          </div>
          <div className="h-4 w-full bg-slate-800/50 rounded-full p-1 border border-slate-700/50 shadow-inner">
            <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(99,102,241,0.5)]" style={{ width: `${progressPct}%` }}></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RSVPReader;
