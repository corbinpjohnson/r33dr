import React, { useEffect, useRef } from 'react';
import type { PageData } from '../loaders/types';
import { textWordOrdinal, wrapWords } from '../loaders/highlight';

interface PagePreviewProps {
  page: PageData;
  currentWordIndex: number;
  faded: boolean; // true during RSVP (dim background behind the floating word)
}

// Renders an EPUB (HTML) or PDF (image) page preview and draws a red highlight
// on the current word, scrolling it into view.
const PagePreview: React.FC<PagePreviewProps> = ({ page, currentWordIndex, faded }) => {
  const htmlRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // EPUB: inject HTML once per page and pre-wrap words.
  useEffect(() => {
    const el = htmlRef.current;
    if (!el || page.previewImage) return;
    el.innerHTML = page.html ?? '';
    wrapWords(el);
  }, [page]);

  // EPUB: move the .vr-focus class to the current word + scroll into view.
  useEffect(() => {
    const el = htmlRef.current;
    if (!el || page.previewImage) return;
    el.querySelector('.vr-focus')?.classList.remove('vr-focus');
    const ordinal = textWordOrdinal(page.tokens, currentWordIndex);
    if (ordinal < 0) return;
    const span = el.querySelector(`span[data-w="${ordinal}"]`);
    if (span) {
      span.classList.add('vr-focus');
      span.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }, [page, currentWordIndex]);

  const opacity = faded ? 'opacity-25' : 'opacity-100';

  // PDF: image + percentage-positioned red box overlay.
  if (page.previewImage) {
    const box = page.wordBoxes?.[currentWordIndex];
    const iw = page.imageWidth ?? 1;
    const ih = page.imageHeight ?? 1;
    return (
      <div ref={scrollRef} className={`flex-1 overflow-auto bg-white transition-opacity duration-500 ${opacity}`}>
        <div className="relative inline-block min-w-full">
          <img src={page.previewImage} alt={`Preview of ${page.label}`} className="block w-full h-auto" />
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

  // EPUB
  return (
    <div
      ref={htmlRef}
      className={`flex-1 overflow-auto p-12 bg-white text-slate-900 font-serif leading-relaxed prose prose-slate max-w-none transition-opacity duration-500 ${opacity}`}
    />
  );
};

export default PagePreview;
