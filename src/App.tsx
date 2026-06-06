import React, { useState, useCallback } from 'react';
import { Upload, Zap, BookOpen } from 'lucide-react';
import RSVPReader from './components/RSVPReader';

function App() {
  const [file, setFile] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');

  const onFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (uploadedFile) {
      setFileName(uploadedFile.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result instanceof ArrayBuffer) {
          setFile(event.target.result);
        }
      };
      reader.readAsArrayBuffer(uploadedFile);
    }
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4">
      {!file ? (
        <div className="max-w-md w-full bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-12 text-center shadow-2xl">
          <div className="mb-8 flex justify-center">
            <div className="bg-indigo-500/10 p-4 rounded-2xl">
              <Zap className="w-12 h-12 text-indigo-400" />
            </div>
          </div>
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            VibeReader
          </h1>
          <p className="text-slate-400 mb-8 text-lg">
            Blast through your books with RSVP speed reading.
          </p>
          
          <label className="group relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-slate-700 rounded-2xl cursor-pointer hover:border-indigo-500/50 hover:bg-slate-800/50 transition-all duration-300">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-8 h-8 text-slate-500 group-hover:text-indigo-400 mb-3 transition-colors" />
              <p className="text-sm text-slate-500 group-hover:text-slate-300">
                Click or drag EPUB or PDF here
              </p>
            </div>
            <input type="file" className="hidden" accept=".epub,.pdf" onChange={onFileUpload} />
          </label>
        </div>
      ) : (
        <div className="w-full max-w-7xl">
          <div className="flex items-center justify-between mb-8 px-4">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-500/10 p-2 rounded-lg">
                <BookOpen className="w-5 h-5 text-indigo-400" />
              </div>
              <span className="text-slate-400 font-medium truncate max-w-[200px]">
                {fileName}
              </span>
            </div>
            <button 
              onClick={() => setFile(null)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-widest"
            >
              Reset
            </button>
          </div>
          <RSVPReader file={file} />
        </div>
      )}
    </div>
  );
}

export default App;
