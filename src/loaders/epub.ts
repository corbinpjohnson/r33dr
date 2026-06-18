import ePub from 'epubjs';
import type { PageData, LoadLogger, LoadOptions } from './types';
import { IMG_PREFIX, isAbortError } from './types';
import { buildTokenMeta } from './text';

// Extracts reading-order tokens (and a preview HTML snapshot) from each spine
// item of an EPUB. Image markers are inserted in document order; image srcs are
// rewritten to archive blob URLs so both the RSVP intercept and the page
// preview reference a loadable URL.
export async function loadEpub(
  file: ArrayBuffer,
  addLog: LoadLogger,
  opts: LoadOptions = {},
): Promise<PageData[]> {
  const { signal, onMeta, onPage, registerUrl } = opts;
  const book = ePub(file);
  await book.ready;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyBook = book as any;
  addLog(`Book: ${anyBook.package?.metadata?.title ?? 'Untitled'}`);

  const spine = anyBook.spine;
  const totalPages = spine.length as number;
  onMeta?.(totalPages);

  const collectedPages: PageData[] = [];
  let parsedOk = 0;

  // Chapter tracking — carry forward the last seen TOC label so every page
  // knows which chapter it belongs to, not just chapter-start pages.
  let currentChapterLabel = '';
  let currentChapterIndex = -1;
  const seenChapters = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toc: any[] = anyBook.navigation?.toc ?? [];

  for (let i = 0; i < totalPages; i++) {
    signal?.throwIfAborted();
    const item = spine.get(i);
    if (!item) continue;

    addLog(`Scanning Page ${i + 1}/${totalPages}...`);

    // Resolve chapter for this spine item before parsing.
    const tocItem = toc.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) => t.href && item.href && t.href.split('#')[0] === item.href.split('#')[0],
    );
    const tocLabel = tocItem?.label?.trim();
    if (tocLabel && tocLabel !== currentChapterLabel) {
      currentChapterLabel = tocLabel;
      if (!seenChapters.has(currentChapterLabel)) {
        currentChapterIndex++;
        seenChapters.set(currentChapterLabel, currentChapterIndex);
      } else {
        currentChapterIndex = seenChapters.get(currentChapterLabel)!;
      }
    }

    let pageData: PageData;
    try {
      pageData = await parseSpineItem(book, anyBook, item, i, totalPages, addLog, registerUrl, signal);
      parsedOk++;
    } catch (err) {
      if (isAbortError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Page ${i + 1} failed: ${message}`);
      pageData = { label: `Page ${i + 1}`, tokens: [], loadError: message };
    }

    if (currentChapterLabel) {
      pageData.chapterLabel = currentChapterLabel;
      pageData.chapterIndex = currentChapterIndex;
    }

    collectedPages.push(pageData);
    onPage?.(pageData, i);
  }

  if (parsedOk === 0) {
    throw new Error('No readable text found in any page.');
  }
  return collectedPages;
}

async function parseSpineItem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  book: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anyBook: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  i: number,
  totalPages: number,
  addLog: LoadLogger,
  registerUrl: LoadOptions['registerUrl'],
  signal: AbortSignal | undefined,
): Promise<PageData> {
  const contents = await book.load(item.href);

  // Always normalize through an HTML document so element names are uppercased
  // and a <body> exists, regardless of whether epubjs returned a string or an
  // XHTML Document (whose lowercase node names would otherwise be missed).
  let rawHtml = '';
  if (typeof contents === 'string') {
    rawHtml = contents;
  } else if (contents instanceof Document) {
    rawHtml = contents.documentElement.outerHTML;
  }
  if (!rawHtml) {
    return { label: `Page ${i + 1}`, tokens: [], loadError: 'Empty content' };
  }
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const tokens: string[] = [];
  const paragraphBreaks = new Set<number>();
  const headingIndices = new Set<number>();

  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI']);

  // Resolve an <img>/<image> to an archive blob URL and rewrite it in place.
  const resolveImage = async (el: Element): Promise<string | null> => {
    const src = el.getAttribute('src') || el.getAttribute('xlink:href');
    if (!src) return null;
    try {
      const absolutePath = anyBook.path.resolve(src, item.href);
      const url: string = await book.archive.createUrl(absolutePath, { base64: false });
      el.setAttribute('src', url);
      registerUrl?.(url);
      return url;
    } catch (err) {
      addLog(`Page ${i + 1}: Image "${src}" could not be resolved — ${err instanceof Error ? err.message : err}`);
      return null;
    }
  };

  // Returns true if any ancestor of node is a heading tag.
  const isInsideHeading = (node: Node): boolean => {
    let p = node.parentElement;
    while (p) {
      if (HEADING_TAGS.has(p.nodeName)) return true;
      p = p.parentElement;
    }
    return false;
  };

  // Sequential await (not forEach) so async image resolution preserves
  // document order and the page isn't finalized before images resolve.
  const traverse = async (node: Node): Promise<void> => {
    signal?.throwIfAborted();
    if (['SCRIPT', 'STYLE', 'HEAD'].includes(node.nodeName)) return;

    // Mark a paragraph break at the index of the last token before this block.
    if ((BLOCK_TAGS.has(node.nodeName) || HEADING_TAGS.has(node.nodeName)) && tokens.length > 0) {
      paragraphBreaks.add(tokens.length - 1);
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent?.trim();
      if (content && content !== '[object Object]') {
        const words = content.split(/\s+/).filter((w) => w.length > 0);
        const inHeading = isInsideHeading(node);
        for (const w of words) {
          if (inHeading) headingIndices.add(tokens.length);
          tokens.push(w);
        }
      }
      return;
    }

    if (node.nodeName === 'IMG' || node.nodeName === 'IMAGE') {
      const url = await resolveImage(node as Element);
      if (url) tokens.push(`${IMG_PREFIX}${url}`);
      return;
    }

    for (const child of Array.from(node.childNodes)) {
      await traverse(child);
    }
  };

  const root = doc.body || doc.documentElement;
  await traverse(root);

  // Derive a human-readable label from the TOC if available.
  const tocItem = anyBook.navigation?.toc?.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t: any) => t.href && item.href && t.href.split('#')[0] === item.href.split('#')[0],
  );
  const tocLabel = tocItem?.label?.trim();
  const label = tocLabel || `Page ${i + 1}`;

  void totalPages; // suppress lint warning — used in the caller's log
  return {
    label,
    tokens,
    html: root.innerHTML,
    tokenMeta: buildTokenMeta(tokens, { paragraphBreaks, headingIndices }),
  };
}
