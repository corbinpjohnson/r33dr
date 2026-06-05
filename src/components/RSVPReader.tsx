import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, FastForward, Rewind, AlertCircle, Eye } from 'lucide-react';
import { loadEpub } from '../loaders/epub';
import { loadPdf } from '../loaders/pdf';
import { ocrCanvas } from '../loaders/ocr';
import { IMG_PREFIX, type PageData } from '../loaders/types';

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
  
  const timerRef = useRef<number | null>(null);

  const addLog = (msg: string) => {
    console.log(msg);
    setLogs(prev => [...prev.slice(-10), msg]);
  };

  useEffect(() => {
    const load = async () => {
      setReaderState('LOADING');
      setError(null);
      setLogs([]);
      addLog('--- Continuous Page Deep Scan ---');

      try {
        const collectedPages = isPdf(file)
          ? await loadPdf(file, addLog, ocrCanvas)
          : await loadEpub(file, addLog);

        setPages(collectedPages);
        setCurrentPageIndex(0);
        setCurrentWordIndex(0);
        setReaderState('PREVIEW');
        addLog(`Scan complete. ${collectedPages.length} pages ready.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        addLog(`Fatal Error: ${message}`);
        setError(message);
        setReaderState('ERROR');
      }
    };

    if (file) load();
  }, [file]);

  // Handle Preview Phase
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

  // Handle RSVP Phase
  useEffect(() => {
    if (readerState === 'RSVP' && isPlaying) {
        const currentPage = pages[currentPageIndex];
        if (!currentPage) return;

        if (currentWordIndex >= currentPage.tokens.length) {
            // End of page - move to next preview
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
        
        // Image Intercept
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

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, readerState]);

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

  // Overall progress includes position within the current page, and reaches
  // 100% when the last word of the last page is shown.
  const withinPage = currentPage ? currentWordIndex / Math.max(1, currentPage.tokens.length) : 0;
  const progressPct = pages.length
    ? Math.min(100, Math.round(((currentPageIndex + withinPage) / pages.length) * 100))
    : 0;

  return (
    <div className="space-y-12 max-w-5xl mx-auto">
      {/* Dynamic Display Area */}
      <div className={`relative h-[500px] bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl transition-all duration-500`}>
        
        {/* State 1: Full Page Preview */}
        {readerState === 'PREVIEW' && (
            <div className="absolute inset-0 flex flex-col animate-in fade-in duration-500">
                {currentPage.previewImage ? (
                    <div className="flex-1 overflow-auto flex justify-center p-6 bg-white">
                        <img src={currentPage.previewImage} alt={`Preview of ${currentPage.label}`} className="max-w-full h-auto object-contain shadow-lg" />
                    </div>
                ) : (
                    <div className="flex-1 overflow-auto p-12 bg-white text-slate-900 font-serif leading-relaxed prose prose-slate max-w-none">
                        <div dangerouslySetInnerHTML={{ __html: currentPage.html ?? '' }} />
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent pointer-events-none" />
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
                    <div className="px-4 py-2 bg-indigo-500 text-white rounded-full font-black text-sm shadow-xl flex items-center gap-2">
                        <Eye size={16} />
                        PREVIEWING PAGE {currentPageIndex + 1} ({previewCountdown}s)
                    </div>
                </div>
            </div>
        )}

        {/* State 2: RSVP Speed Reading */}
        {readerState === 'RSVP' && (
            <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 ${isPeripheralMode ? 'bg-black' : 'bg-slate-900'}`}>
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-indigo-500/10 -translate-x-1/2"></div>
                <div className={`text-7xl font-mono font-bold flex transition-all duration-300 ${isPeripheralMode ? 'scale-110' : ''}`}>
                    <span className={`text-right flex-1 min-w-[350px] transition-all duration-300 ${isPeripheralMode ? 'opacity-0 scale-95' : 'text-slate-600'}`}>{prefix}</span>
                    <span className="text-indigo-400 drop-shadow-[0_0_25px_rgba(129,140,248,0.5)]">{focus}</span>
                    <span className={`text-left flex-1 min-w-[350px] transition-all duration-300 ${isPeripheralMode ? 'opacity-0 scale-95' : 'text-slate-400'}`}>{suffix}</span>
                </div>
            </div>
        )}

        {/* State 3: Image Intercept */}
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

      {/* Persistent Controls */}
      <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 space-y-8 shadow-2xl">
        <div className="flex items-center justify-between gap-12">
            <div className="flex items-center gap-6">
                <button onClick={() => setCurrentWordIndex(Math.max(0, currentWordIndex - 25))} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all"><Rewind size={32} /></button>
                <button onClick={togglePlay} className="w-24 h-24 flex items-center justify-center bg-indigo-500 hover:bg-indigo-400 text-white rounded-[2rem] shadow-xl shadow-indigo-500/30 transition-all active:scale-95">
                    {isPlaying ? <Pause size={48} fill="currentColor" /> : <Play size={48} className="ml-1" fill="currentColor" />}
                </button>
                <button onClick={() => setCurrentWordIndex(Math.min(currentPage.tokens.length - 1, currentWordIndex + 25))} className="p-4 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-2xl transition-all"><FastForward size={32} /></button>
            </div>

            <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-indigo-500 uppercase tracking-[0.3em]">Neural Velocity</p>
                    <p className="text-4xl font-mono font-black text-white">{wpm} <span className="text-sm font-bold text-slate-600 uppercase">WPM</span></p>
                </div>
                <input type="range" min="100" max="2000" step="25" value={wpm} onChange={(e) => setWpm(parseInt(e.target.value))} className="w-full h-3 bg-slate-800 rounded-full appearance-none cursor-pointer accent-indigo-500 transition-all" />
            </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
            <button onClick={() => setIsDynamicSpeed(!isDynamicSpeed)} className={`flex flex-col items-start p-6 rounded-2xl border-2 transition-all ${isDynamicSpeed ? 'bg-indigo-500/10 border-indigo-500/50' : 'bg-slate-800/30 border-transparent hover:border-slate-700'}`}>
                <span className={`text-xs font-black uppercase tracking-widest ${isDynamicSpeed ? 'text-indigo-400' : 'text-slate-500'}`}>Adaptive Cadence</span>
                <p className="text-[11px] text-slate-500 mt-1">Slowing for syntax complexity.</p>
            </button>
            <button onClick={() => setIsPeripheralMode(!isPeripheralMode)} className={`flex flex-col items-start p-6 rounded-2xl border-2 transition-all ${isPeripheralMode ? 'bg-indigo-500/10 border-indigo-500/50' : 'bg-slate-800/30 border-transparent hover:border-slate-700'}`}>
                <span className={`text-xs font-black uppercase tracking-widest ${isPeripheralMode ? 'text-indigo-400' : 'text-slate-500'}`}>Focus Lockdown</span>
                <p className="text-[11px] text-slate-500 mt-1">Peripheral sensory deprivation.</p>
            </button>
        </div>

        <div className="space-y-4 pt-4 border-t border-slate-800/50">
            <div className="flex justify-between items-end">
                <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Library Progress</p>
                    <p className="text-xl font-mono font-bold text-slate-400">PAGE {currentPageIndex + 1} <span className="text-xs text-slate-600">/ {pages.length}</span></p>
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
