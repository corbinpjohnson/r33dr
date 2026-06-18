import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Bookmark, AlertTriangle } from 'lucide-react';
import type { PageData } from '../loaders/types';
import { IMG_PREFIX } from '../loaders/types';

interface ThumbnailStripProps {
  pages: PageData[];
  currentIndex: number;
  bookmarkedPages: Set<number>;
  onNavigate: (index: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

// Subtle tints for up to 12 distinct chapters — cycles if there are more.
const CHAPTER_COLORS = [
  { border: 'border-indigo-500/60',  bg: 'bg-indigo-500/8',  dot: 'bg-indigo-400',  label: 'text-indigo-300'  },
  { border: 'border-violet-500/60',  bg: 'bg-violet-500/8',  dot: 'bg-violet-400',  label: 'text-violet-300'  },
  { border: 'border-emerald-500/60', bg: 'bg-emerald-500/8', dot: 'bg-emerald-400', label: 'text-emerald-300' },
  { border: 'border-amber-500/60',   bg: 'bg-amber-500/8',   dot: 'bg-amber-400',   label: 'text-amber-300'   },
  { border: 'border-rose-500/60',    bg: 'bg-rose-500/8',    dot: 'bg-rose-400',    label: 'text-rose-300'    },
  { border: 'border-cyan-500/60',    bg: 'bg-cyan-500/8',    dot: 'bg-cyan-400',    label: 'text-cyan-300'    },
  { border: 'border-orange-500/60',  bg: 'bg-orange-500/8',  dot: 'bg-orange-400',  label: 'text-orange-300'  },
  { border: 'border-teal-500/60',    bg: 'bg-teal-500/8',    dot: 'bg-teal-400',    label: 'text-teal-300'    },
  { border: 'border-pink-500/60',    bg: 'bg-pink-500/8',    dot: 'bg-pink-400',    label: 'text-pink-300'    },
  { border: 'border-lime-500/60',    bg: 'bg-lime-500/8',    dot: 'bg-lime-400',    label: 'text-lime-300'    },
  { border: 'border-sky-500/60',     bg: 'bg-sky-500/8',     dot: 'bg-sky-400',     label: 'text-sky-300'     },
  { border: 'border-fuchsia-500/60', bg: 'bg-fuchsia-500/8', dot: 'bg-fuchsia-400', label: 'text-fuchsia-300' },
];

function pageSnippet(page: PageData): string {
  const words = page.tokens.filter(t => !t.startsWith(IMG_PREFIX)).slice(0, 7);
  return words.join(' ');
}

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
  const [visibleChapter, setVisibleChapter] = useState('');

  // Keep the active thumb visible when the current page changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentIndex]);

  // Update floating chapter label as the strip scrolls.
  const onScroll = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const elLeft = el.getBoundingClientRect().left;
    const buttons = el.querySelectorAll<HTMLElement>('[data-page-idx]');
    for (const btn of buttons) {
      if (btn.getBoundingClientRect().right > elLeft + 8) {
        const idx = parseInt(btn.dataset.pageIdx ?? '0', 10);
        setVisibleChapter(pages[idx]?.chapterLabel ?? '');
        return;
      }
    }
  }, [pages]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll, collapsed]);

  // Also refresh chapter label when pages stream in.
  useEffect(() => { onScroll(); }, [pages, onScroll]);

  const isPdf = pages[0]?.previewImage != null;
  const hasChapters = pages.some(p => p.chapterLabel);

  return (
    <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      {/* Header / collapse toggle */}
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] shrink-0">
            {pages.length > 0 ? `${pages.length} pages` : 'Loading…'}
          </span>
          {hasChapters && visibleChapter && !collapsed && (
            <span className="text-[10px] text-slate-400 truncate">· {visibleChapter}</span>
          )}
        </div>
        <span className="text-slate-600 text-xs ml-2">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div
          ref={stripRef}
          className="flex gap-2 overflow-x-auto px-3 pb-3 scrollbar-thin scrollbar-thumb-slate-700"
        >
          {pages.map((page, idx) => {
            const isCurrent = idx === currentIndex;
            const hasBookmark = bookmarkedPages.has(idx);
            const hasError = !!page.loadError;
            const isChapterStart = hasChapters && page.chapterLabel != null &&
              (idx === 0 || pages[idx - 1]?.chapterLabel !== page.chapterLabel);

            const chapterColor = (hasChapters && page.chapterIndex != null)
              ? CHAPTER_COLORS[page.chapterIndex % CHAPTER_COLORS.length]
              : null;

            const snippet = pageSnippet(page);

            return (
              <button
                key={idx}
                ref={isCurrent ? activeRef : undefined}
                data-page-idx={idx}
                onClick={() => onNavigate(idx)}
                title={page.chapterLabel ? `${page.chapterLabel} — ${snippet}` : snippet || page.label}
                className={`relative flex-none rounded-xl overflow-hidden transition-all duration-150 border-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                  isCurrent
                    ? 'border-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.5)]'
                    : chapterColor
                      ? `${chapterColor.border} hover:brightness-125`
                      : 'border-slate-700 hover:border-slate-500'
                }`}
                style={{ width: isPdf ? 64 : 104 }}
              >
                {isPdf && page.previewImage ? (
                  <img
                    src={page.previewImage}
                    alt={page.label}
                    className="block w-full h-20 object-cover object-top"
                    loading="lazy"
                  />
                ) : (
                  <div className={`w-full h-20 flex flex-col justify-between px-1.5 pt-1.5 pb-0 ${chapterColor ? chapterColor.bg : 'bg-slate-800'}`}>
                    {/* Chapter start marker */}
                    {isChapterStart && chapterColor && (
                      <div className={`flex items-center gap-1 mb-0.5`}>
                        <span className={`w-1 h-1 rounded-full flex-none ${chapterColor.dot}`} />
                        <span className={`text-[7px] font-black uppercase tracking-wide truncate ${chapterColor.label}`}>
                          Ch
                        </span>
                      </div>
                    )}
                    {/* Content snippet */}
                    <p className={`text-[8px] leading-tight line-clamp-3 flex-1 ${isCurrent ? 'text-slate-200' : 'text-slate-400'}`}>
                      {snippet || page.label}
                    </p>
                  </div>
                )}

                {/* Page number bar */}
                <div className={`absolute bottom-0 left-0 right-0 text-[8px] text-center py-0.5 ${chapterColor && !isCurrent ? `${chapterColor.bg} ${chapterColor.label}` : 'bg-slate-950/80 text-slate-400'}`}>
                  {idx + 1}
                </div>

                {/* Bookmark pin */}
                {hasBookmark && (
                  <div className="absolute top-1 right-1">
                    <Bookmark size={9} className="text-indigo-400 fill-indigo-400" />
                  </div>
                )}

                {/* Error glyph */}
                {hasError && (
                  <div className="absolute top-1 left-1">
                    <AlertTriangle size={9} className="text-red-400" />
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
