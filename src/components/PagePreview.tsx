import React, { useEffect, useRef, useCallback } from 'react';
import type { PageData, WordBox } from '../loaders/types';
import { IMG_PREFIX } from '../loaders/types';
import { textWordOrdinal, wrapWords, groupBoxesIntoLines } from '../loaders/highlight';
import { sentenceRangeAt } from '../loaders/text';

interface PagePreviewProps {
  page: PageData;
  currentWordIndex: number;
  faded: boolean;      // true during RSVP (dim background behind the floating word)
  peeking?: boolean;   // context peek: animate from faded back to full opacity
  chunkBox?: WordBox;  // pre-computed union box for multi-word chunk (PDF only)
  onWordClick?: (wordIndex: number) => void; // click-to-seek
}

const PagePreview: React.FC<PagePreviewProps> = ({
  page,
  currentWordIndex,
  faded,
  peeking = false,
  chunkBox,
  onWordClick,
}) => {
  const htmlRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledOrdinalRef = useRef<number>(-1);

  // EPUB: inject HTML once per page and pre-wrap words.
  useEffect(() => {
    const el = htmlRef.current;
    if (!el || page.previewImage) return;
    el.innerHTML = page.html ?? '';
    wrapWords(el);
    lastScrolledOrdinalRef.current = -1;
  }, [page]);

  // Throttled scroll: only fire when the target span is outside the visible area.
  const scrollIfNeeded = useCallback((span: Element) => {
    const container = scrollRef.current ?? htmlRef.current;
    if (!container) { span.scrollIntoView({ block: 'center', behavior: 'auto' }); return; }
    const { top, bottom } = span.getBoundingClientRect();
    const { top: cTop, bottom: cBottom } = container.getBoundingClientRect();
    if (top < cTop || bottom > cBottom) {
      span.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }, []);

  // EPUB: move .vr-focus + .vr-sentence classes to current word + sentence.
  useEffect(() => {
    const el = htmlRef.current;
    if (!el || page.previewImage) return;

    const ordinal = textWordOrdinal(page.tokens, currentWordIndex);
    if (ordinal < 0) return;

    // Focus word.
    el.querySelector('.vr-focus')?.classList.remove('vr-focus');
    const focusSpan = el.querySelector(`span[data-w="${ordinal}"]`);
    if (focusSpan) {
      focusSpan.classList.add('vr-focus');
      if (lastScrolledOrdinalRef.current !== ordinal) {
        scrollIfNeeded(focusSpan);
        lastScrolledOrdinalRef.current = ordinal;
      }
    }

    // Sentence trace: mark all spans in the current sentence.
    el.querySelectorAll('.vr-sentence').forEach(s => s.classList.remove('vr-sentence'));
    const [sentStart, sentEnd] = sentenceRangeAt(page.tokens, currentWordIndex);
    for (let i = sentStart; i <= sentEnd; i++) {
      const so = textWordOrdinal(page.tokens, i);
      if (so >= 0) el.querySelector(`span[data-w="${so}"]`)?.classList.add('vr-sentence');
    }
  }, [page, currentWordIndex, scrollIfNeeded]);

  // Click-to-seek: PDF hit-test against word boxes.
  const handlePdfClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onWordClick || !page.wordBoxes?.length) return;
    const img = e.currentTarget.querySelector('img') as HTMLImageElement | null;
    if (!img) return;
    const r = img.getBoundingClientRect();
    const relX = (e.clientX - r.left) / r.width;
    const relY = (e.clientY - r.top) / r.height;
    const clickX = relX * (page.imageWidth ?? 1);
    const clickY = relY * (page.imageHeight ?? 1);
    let best = -1, bestScore = Infinity;
    page.wordBoxes.forEach((box, i) => {
      if (!box) return;
      const inside = clickX >= box.x && clickX <= box.x + box.w && clickY >= box.y && clickY <= box.y + box.h;
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const score = inside ? 0 : Math.hypot(clickX - cx, clickY - cy);
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) onWordClick(best);
  }, [onWordClick, page]);

  // Click-to-seek: EPUB — resolve data-w ordinal back to token index.
  const handleEpubClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onWordClick) return;
    const span = (e.target as Element).closest('[data-w]');
    if (!span) return;
    const ordinal = parseInt(span.getAttribute('data-w') ?? '-1', 10);
    if (ordinal < 0) return;
    let count = 0;
    for (let i = 0; i < page.tokens.length; i++) {
      if (page.tokens[i].startsWith(IMG_PREFIX)) continue;
      if (count === ordinal) { onWordClick(i); return; }
      count++;
    }
  }, [onWordClick, page.tokens]);

  // Opacity: peeking overrides faded (snappy 200ms transition for peek).
  const opacity = peeking ? 'opacity-100' : faded ? 'opacity-25' : 'opacity-100';
  const transitionCls = peeking || faded ? 'transition-opacity duration-200' : 'transition-opacity duration-500';

  // PDF: image + percentage-positioned red box overlay + sentence trace boxes.
  if (page.previewImage) {
    const box: WordBox | undefined = chunkBox ?? page.wordBoxes?.[currentWordIndex];
    const iw = page.imageWidth ?? 1;
    const ih = page.imageHeight ?? 1;

    // Sentence trace: amber line-union boxes.
    const [sentStart, sentEnd] = page.wordBoxes
      ? sentenceRangeAt(page.tokens, currentWordIndex)
      : [0, -1];
    const sentBoxes = page.wordBoxes
      ? page.tokens
          .slice(sentStart, sentEnd + 1)
          .map((_, i) => page.wordBoxes![sentStart + i])
          .filter(Boolean)
      : [];
    const sentLines = groupBoxesIntoLines(sentBoxes);

    return (
      <div ref={scrollRef} onClick={handlePdfClick} className={`flex-1 overflow-auto bg-white ${transitionCls} ${opacity} ${onWordClick ? 'cursor-crosshair' : ''}`}>
        <div className="relative inline-block min-w-full">
          <img src={page.previewImage} alt={`Preview of ${page.label}`} className="block w-full h-auto" />

          {/* Sentence trace amber underlines */}
          {sentLines.map((lb, i) => (
            <span
              key={i}
              className="absolute pointer-events-none"
              style={{
                left: `${(lb.x / iw) * 100}%`,
                top: `${((lb.y + lb.h - 3) / ih) * 100}%`,
                width: `${(lb.w / iw) * 100}%`,
                height: `${Math.max(3, (3 / ih) * 100)}%`,
                backgroundColor: 'rgba(245, 158, 11, 0.4)',
                borderRadius: '1px',
              }}
            />
          ))}

          {/* Red word highlight */}
          {box && (
            <span
              className="absolute bg-red-500/30 border-2 border-red-500 rounded-sm transition-all duration-100"
              style={{
                left: `${(box.x / iw) * 100}%`,
                top: `${(box.y / ih) * 100}%`,
                width: `${(box.w / iw) * 100}%`,
                height: `${(box.h / ih) * 100}%`,
              }}
              ref={(node) => node?.scrollIntoView({ block: 'center', behavior: 'auto' })}
            />
          )}
        </div>
      </div>
    );
  }

  // EPUB: HTML with inline .vr-focus + .vr-sentence spans.
  return (
    <div
      ref={el => { (htmlRef as React.MutableRefObject<HTMLDivElement | null>).current = el; (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
      onClick={handleEpubClick}
      className={`flex-1 overflow-auto p-12 bg-white text-slate-900 font-serif leading-relaxed prose prose-slate max-w-none ${transitionCls} ${opacity} ${onWordClick ? 'vr-clickable' : ''}`}
    />
  );
};

export default React.memo(PagePreview);
