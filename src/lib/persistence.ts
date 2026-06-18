// Per-document reading state persisted to localStorage.

const KEY_PREFIX = 'r33dr:doc:';
const SETTINGS_KEY = 'r33dr:settings';
const SCHEMA_VERSION = 1;

export interface Bookmark {
  page: number;
  word: number;
  note?: string;
}

export interface DocState {
  v: typeof SCHEMA_VERSION;
  page: number;
  word: number;
  wpm: number;
  dynamicSpeed: boolean;
  skimMode: boolean;
  chunkSize: number; // 0 = auto
  trainer: boolean;
  bookmarks: Bookmark[];
  updatedAt: number; // Date.now()
}

export interface GlobalSettings {
  v: typeof SCHEMA_VERSION;
  wpm: number;
  dynamicSpeed: boolean;
  skimMode: boolean;
  chunkSize: number;
  trainer: boolean;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  v: SCHEMA_VERSION,
  wpm: 300,
  dynamicSpeed: false,
  skimMode: false,
  chunkSize: 0,
  trainer: false,
};

// ─── Hashing ─────────────────────────────────────────────────────────────────

// SHA-256 of the first 256 KB of the document + its byte length → 16 hex chars.
// Stays stable across sessions for the same file regardless of reload path.
export async function hashDocument(buf: ArrayBuffer): Promise<string> {
  const SAMPLE = 256 * 1024;
  const slice = buf.byteLength <= SAMPLE ? buf : buf.slice(0, SAMPLE);
  // Append 8-byte little-endian length so files that differ only in length
  // still produce different hashes.
  const payload = new Uint8Array(slice.byteLength + 8);
  payload.set(new Uint8Array(slice));
  const dv = new DataView(payload.buffer);
  dv.setUint32(slice.byteLength, buf.byteLength >>> 0, true);
  dv.setUint32(slice.byteLength + 4, Math.floor(buf.byteLength / 2 ** 32), true);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Load / Save ─────────────────────────────────────────────────────────────

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== SCHEMA_VERSION) return null; // stale schema
    return parsed as T;
  } catch {
    return null; // corrupt JSON — discard silently
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can throw if quota is exceeded — ignore gracefully.
  }
}

export function loadDocState(hash: string): DocState | null {
  return readJson<DocState>(`${KEY_PREFIX}${hash}`);
}

export function saveDocState(hash: string, state: Omit<DocState, 'v' | 'updatedAt'>): void {
  writeJson(`${KEY_PREFIX}${hash}`, { ...state, v: SCHEMA_VERSION, updatedAt: Date.now() });
}

export function loadGlobalSettings(): GlobalSettings {
  return readJson<GlobalSettings>(SETTINGS_KEY) ?? DEFAULT_SETTINGS;
}

export function saveGlobalSettings(s: Omit<GlobalSettings, 'v'>): void {
  writeJson(SETTINGS_KEY, { ...s, v: SCHEMA_VERSION });
}

// ─── Debounce helper ─────────────────────────────────────────────────────────

// ─── Recent files ────────────────────────────────────────────────────────────

export interface RecentEntry {
  name: string;
  hash: string;
  page: number;
  totalPages: number;
  updatedAt: number;
  filePath?: string; // native path, only available in Electron
}

const RECENTS_KEY = 'r33dr:recents';
const MAX_RECENTS = 6;

export function loadRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

export function pushRecent(entry: RecentEntry): void {
  try {
    const prev = loadRecents().filter(r => r.hash !== entry.hash);
    localStorage.setItem(RECENTS_KEY, JSON.stringify([entry, ...prev].slice(0, MAX_RECENTS)));
  } catch {}
}

// ─── Debounce helper ─────────────────────────────────────────────────────────

export function makeDebounced<T extends unknown[]>(
  fn: (...args: T) => void,
  delayMs: number,
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
