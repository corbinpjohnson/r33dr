import ePub from 'epubjs';
import type { PageData, LoadLogger } from './types';
import { IMG_PREFIX } from './types';

// Extracts reading-order tokens (and a preview HTML snapshot) from each spine
// item of an EPUB. Image markers are inserted in document order; image srcs are
// rewritten to archive blob URLs so both the RSVP intercept and the page
// preview reference a loadable URL.
export async function loadEpub(
  file: ArrayBuffer,
  addLog: LoadLogger,
): Promise<PageData[]> {
  const book = ePub(file);
  await book.ready;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyBook = book as any;
  addLog(`Book: ${anyBook.package?.metadata?.title ?? 'Untitled'}`);

  const collectedPages: PageData[] = [];
  const spine = anyBook.spine;

  for (let i = 0; i < spine.length; i++) {
    const item = spine.get(i);
    if (!item) continue;

    addLog(`Scanning Page ${i + 1}/${spine.length}...`);
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
    if (!rawHtml) continue;
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html');

    const tokens: string[] = [];

    // Resolve an <img>/<image> to an archive blob URL and rewrite it in place.
    const resolveImage = async (el: Element): Promise<string | null> => {
      const src = el.getAttribute('src') || el.getAttribute('xlink:href');
      if (!src) return null;
      try {
        const absolutePath = anyBook.path.resolve(src, item.href);
        const url: string = await book.archive.createUrl(absolutePath, {
          base64: false,
        });
        el.setAttribute('src', url);
        return url;
      } catch {
        return null;
      }
    };

    // Sequential await (not forEach) so async image resolution preserves
    // document order and the page isn't finalized before images resolve.
    const traverse = async (node: Node): Promise<void> => {
      if (['SCRIPT', 'STYLE', 'HEAD'].includes(node.nodeName)) return;

      if (node.nodeType === Node.TEXT_NODE) {
        const content = node.textContent?.trim();
        if (content && content !== '[object Object]') {
          tokens.push(...content.split(/\s+/).filter((w) => w.length > 0));
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

    if (tokens.length > 0) {
      collectedPages.push({
        label: item.href,
        tokens,
        html: root.innerHTML,
      });
    }
  }

  if (collectedPages.length === 0) {
    throw new Error('No readable text found in any page.');
  }
  return collectedPages;
}
