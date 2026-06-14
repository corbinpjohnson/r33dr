import React, { useRef, useEffect } from 'react';
import { Bookmark, AlertTriangle } from 'lucide-react';
import type { PageData } from '../loaders/types';

interface ThumbnailStripProps {
  pages: PageData[];
  currentIndex: number;
  bookmarkedPages: Set<number>;
  onNavigate: (index: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

// A horizontal scrollable strip of page thumbnails (PDF preview images or
// chapter-label chips for EPUB). Clicking any item navigates to that page.
// Bookmark pins and error glyphs are overlaid on the relevant items.
const ThumbnailStrip: React.FC<ThumbnailStripProps> = ({
  pages,
  currentIndex,
  bookmarkedPages,
  onNavigate,
  collapsed,
  onToggleCollapse,
}) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the active thumb visible when the current page changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentIndex]);

  const isPdf = pages[0]?.previewImage != null;

  return (
    <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      {/* Header / collapse toggle */}
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-800/50 transition-colors"
      >
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">
          {pages.length > 0 ? `${pages.length} pages` : 'Loading…'}
        </span>
        <span className="text-slate-600 text-xs">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div
          ref={stripRef}
          className="flex gap-2 overflow-x-auto px-4 pb-4 scrollbar-thin scrollbar-thumb-slate-700"
        >
          {pages.map((page, idx) => {
            const isCurrent = idx === currentIndex;
            const hasBookmark = bookmarkedPages.has(idx);
            const hasError = !!page.loadError;

            return (
              <button
                key={idx}
                ref={isCurrent ? activeRef : undefined}
                onClick={() => onNavigate(idx)}
                title={page.label}
                className={`relative flex-none rounded-xl overflow-hidden transition-all duration-150 border-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                  isCurrent
                    ? 'border-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.5)]'
                    : 'border-slate-700 hover:border-slate-500'
                }`}
                style={{ width: isPdf ? 64 : 96 }}
              >
                {isPdf && page.previewImage ? (
                  <img
                    src={page.previewImage}
                    alt={page.label}
                    className="block w-full h-20 object-cover object-top"
                    loading="lazy"
                  />
                ) : (
                  // EPUB: chapter label chip
                  <div className="w-full h-20 bg-slate-800 flex flex-col items-center justify-center gap-1 px-1">
                    <span className="text-[8px] font-bold text-slate-400 text-center leading-tight line-clamp-3">
                      {page.label}
                    </span>
                  </div>
                )}

                {/* Page number label */}
                <div className="absolute bottom-0 left-0 right-0 bg-slate-950/80 text-[8px] text-center text-slate-400 py-0.5">
                  {idx + 1}
                </div>

                {/* Bookmark pin */}
                {hasBookmark && (
                  <div className="absolute top-1 right-1">
                    <Bookmark size={10} className="text-indigo-400 fill-indigo-400" />
                  </div>
                )}

                {/* Error glyph */}
                {hasError && (
                  <div className="absolute top-1 left-1">
                    <AlertTriangle size={10} className="text-red-400" />
                  </div>
                )}

                {/* Empty page dim overlay */}
                {page.tokens.length === 0 && !hasError && (
                  <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center">
                    <span className="text-[7px] text-slate-500">empty</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThumbnailStrip;
