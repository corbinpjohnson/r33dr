import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, Zap, FileText, Clock, ChevronRight, X } from 'lucide-react';
import RSVPReader from './components/RSVPReader';
import { loadRecents, type RecentEntry } from './lib/persistence';

declare global {
  interface Window {
    electronAPI?: {
      readFile: (path: string) => Promise<ArrayBuffer>;
      summarizeChapter: (text: string, chapterTitle: string) => Promise<{ summary: string | null; error: string | null; chunkCount: number | null }>;
      readNotes: (notesPath: string) => Promise<string | null>;
      writeNotes: (notesPath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
      getPathForFile: (file: File) => string;
    };
  }
}

function App() {
  const [file, setFile] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState('');
  const [filePath, setFilePath] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setRecents(loadRecents()); }, []);
  useEffect(() => { if (!file) setRecents(loadRecents()); }, [file]);

  const openBuffer = useCallback((buf: ArrayBuffer, name: string, path = '') => {
    setFileName(name);
    setFilePath(path);
    setFile(buf);
  }, []);

  const openFile = useCallback((f: File) => {
    // webUtils.getPathForFile is the Electron 28+ way; file.path was removed.
    const nativePath = window.electronAPI?.getPathForFile(f) ?? '';
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result instanceof ArrayBuffer) openBuffer(e.target.result, f.name, nativePath);
    };
    reader.readAsArrayBuffer(f);
  }, [openBuffer]);

  const openRecent = useCallback(async (r: RecentEntry) => {
    if (r.filePath && window.electronAPI) {
      try {
        const buf = await window.electronAPI.readFile(r.filePath);
        openBuffer(buf, r.name, r.filePath);
        return;
      } catch {
        // File moved/deleted — fall through to picker.
      }
    }
    fileInputRef.current?.click();
  }, [openBuffer]);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) openFile(f);
    e.target.value = '';
  }, [openFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = Array.from(e.dataTransfer.files).find(f => /\.(pdf|epub)$/i.test(f.name));
    if (f) openFile(f);
  }, [openFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  }, [isDragging]);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }, []);

  if (file) {
    return (
      <div className="min-h-screen w-full flex flex-col bg-slate-950">
        <header
          className="flex items-center justify-between pr-5 py-2.5 border-b border-slate-800/60 bg-slate-950/90 backdrop-blur-xl shrink-0"
          style={{ WebkitAppRegion: 'drag', paddingLeft: '88px' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-indigo-400 flex-none" />
            <span className="text-[11px] font-black text-indigo-400 uppercase tracking-widest">r33dr</span>
            <span className="text-slate-700 mx-1">·</span>
            <FileText className="w-3 h-3 text-slate-500 flex-none" />
            <span className="text-xs text-slate-400 truncate max-w-xs">{fileName}</span>
          </div>
          <button
            onClick={() => setFile(null)}
            className="flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-slate-300 transition-colors uppercase tracking-widest"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <X size={11} />
            Close
          </button>
        </header>
        <main className="flex-1 min-h-0 p-4 lg:p-5 overflow-auto">
          <RSVPReader file={file} fileName={fileName} filePath={filePath} />
        </main>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center p-6 transition-colors duration-300"
      style={isDragging ? { backgroundColor: 'rgba(67,56,202,0.08)' } : undefined}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {/* Logo */}
      <div className="mb-8 text-center select-none">
        <div className="flex justify-center mb-4">
          <div className={`p-4 rounded-2xl transition-all duration-300 ${isDragging ? 'bg-indigo-500/25 scale-110' : 'bg-indigo-500/10'}`}>
            <Zap className={`w-9 h-9 transition-colors duration-300 ${isDragging ? 'text-indigo-200' : 'text-indigo-400'}`} />
          </div>
        </div>
        <h1 className="text-4xl font-black tracking-tight bg-gradient-to-br from-indigo-300 via-purple-400 to-indigo-400 bg-clip-text text-transparent">
          r33dr
        </h1>
        <p className="text-slate-500 mt-2 text-sm">Blast through books with RSVP speed reading.</p>
      </div>

      {/* Upload zone */}
      <label
        className={`relative flex flex-col items-center justify-center w-full max-w-sm h-40 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-200 ${
          isDragging
            ? 'border-indigo-400 bg-indigo-500/10 scale-[1.02] shadow-[0_0_40px_rgba(99,102,241,0.15)]'
            : 'border-slate-700/80 bg-slate-900/40 hover:border-indigo-500/50 hover:bg-slate-800/40'
        }`}
      >
        <Upload className={`w-7 h-7 mb-2.5 transition-colors duration-200 ${isDragging ? 'text-indigo-300' : 'text-slate-500'}`} />
        <p className={`text-sm font-semibold transition-colors duration-200 ${isDragging ? 'text-indigo-200' : 'text-slate-400'}`}>
          {isDragging ? 'Drop to open' : 'Drop a PDF or EPUB here'}
        </p>
        <p className="text-xs text-slate-600 mt-1">or click to browse</p>
        <div className="flex gap-2 mt-3">
          {['PDF', 'EPUB'].map(t => (
            <span key={t} className="text-[9px] font-black px-2 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700 uppercase tracking-wider">{t}</span>
          ))}
        </div>
        <input ref={fileInputRef} type="file" className="hidden" accept=".epub,.pdf" onChange={onFileInput} />
      </label>

      {/* Recent files */}
      {recents.length > 0 && (
        <div className="w-full max-w-sm mt-8">
          <div className="flex items-center gap-2 mb-3 px-1">
            <Clock size={11} className="text-slate-600" />
            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Recently read</p>
          </div>
          <div className="space-y-1.5">
            {recents.map(r => {
              const pct = r.totalPages > 0 ? Math.round(((r.page + 1) / r.totalPages) * 100) : 0;
              const ext = /\.pdf$/i.test(r.name) ? 'PDF' : 'EPUB';
              const extColor = ext === 'PDF' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400';
              const displayName = r.name.replace(/\.(pdf|epub)$/i, '');
              return (
                <button
                  key={r.hash}
                  onClick={() => openRecent(r)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 transition-all text-left group"
                  title={r.filePath ? `Open ${r.name}` : `Re-open ${r.name} — progress is saved`}
                >
                  <span className={`text-[9px] font-black rounded px-1.5 py-0.5 flex-none ${extColor}`}>{ext}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300 font-medium truncate group-hover:text-white transition-colors">{displayName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-0.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[9px] text-slate-600 whitespace-nowrap tabular-nums">
                        {r.totalPages > 0 ? `p ${r.page + 1} / ${r.totalPages}` : 'not started'}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={13} className="text-slate-700 group-hover:text-slate-400 flex-none transition-colors" />
                </button>
              );
            })}
          </div>
          <p className="text-[9px] text-slate-700 text-center mt-3">Progress is auto-saved — click any title to continue reading</p>
        </div>
      )}
    </div>
  );
}

export default App;
