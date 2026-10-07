/**
 * Peaks on disk (OPFS), for the waveform worker: the fine bins of each media file in a file of
 * their own, written as they are computed and read back a view at a time, plus a small record
 * with the overview once a file is complete, so reopening the media needs no decoding.
 * Worker-only: it uses synchronous access handles.
 */
import { MemoryPeakStore, type PeakStore } from './peaks.ts';

const DIR = 'waveform-peaks';
/** Bump when the peak format changes, so old caches are ignored. */
const FORMAT = 1;
/** Cached files kept; the least recently used go first. */
const KEEP = 20;

interface SyncHandle {
  read(buffer: Int8Array, options: { at: number }): number;
  write(buffer: Int8Array, options: { at: number }): number;
  getSize(): number;
  flush(): void;
  close(): void;
}

export interface CacheRecord {
  format: number;
  bins: number;
  durationMs: number;
  /** Overview pairs, as a binary string (it is small: 2 bytes a second). */
  overview: string;
  usedAt: number;
}

/** A store on an OPFS file. */
class FilePeakStore implements PeakStore {
  private readonly handle: SyncHandle;

  constructor(handle: SyncHandle) {
    this.handle = handle;
  }

  write(from: number, pairs: Int8Array): void {
    this.handle.write(pairs, { at: from * 2 });
  }

  read(from: number, to: number): Int8Array {
    const out = new Int8Array(Math.max(0, to - from) * 2);
    this.handle.read(out, { at: from * 2 });
    return out;
  }

  close(): void {
    this.handle.flush();
    this.handle.close();
  }
}

/** A stable name for a media file (it is not read: name, size and modification time). */
export function cacheKey(file: { name: string; size: number; lastModified: number }): string {
  let h = 2166136261;
  for (const ch of `${file.name}\u0000${file.size}\u0000${file.lastModified}`) {
    h = Math.imul(h ^ (ch.codePointAt(0) as number), 16777619) >>> 0;
  }
  return `${file.size}-${h.toString(36)}`;
}

const toBinary = (bytes: Int8Array): string => {
  let s = '';
  for (const b of new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length)) {
    s += String.fromCharCode(b);
  }
  return s;
};
const fromBinary = (s: string): Int8Array =>
  Int8Array.from(s, (c) => (c.charCodeAt(0) << 24) >> 24);

async function directory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR, { create: true });
  } catch {
    return null; // No OPFS (or no permission, as in some private windows).
  }
}

async function syncHandle(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<SyncHandle | null> {
  try {
    const file = await dir.getFileHandle(name, { create: true });
    const create = (file as unknown as { createSyncAccessHandle?: () => Promise<SyncHandle> })
      .createSyncAccessHandle;
    return create ? await create.call(file) : null;
  } catch {
    return null; // Already open elsewhere (another tab), or not supported.
  }
}

async function readRecord(
  dir: FileSystemDirectoryHandle,
  key: string,
): Promise<CacheRecord | null> {
  try {
    const file = await (await dir.getFileHandle(`${key}.json`)).getFile();
    const record = JSON.parse(await file.text()) as CacheRecord;
    return record.format === FORMAT ? record : null;
  } catch {
    return null;
  }
}

async function writeRecord(dir: FileSystemDirectoryHandle, key: string, record: CacheRecord) {
  const handle = await syncHandle(dir, `${key}.json`);
  if (!handle) return;
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  handle.write(new Int8Array(bytes.buffer), { at: 0 });
  (handle as unknown as { truncate(n: number): void }).truncate(bytes.length);
  handle.close();
}

/** Removes the least recently used entries beyond `KEEP`. */
async function evict(dir: FileSystemDirectoryHandle, keep: string): Promise<void> {
  const records: { key: string; usedAt: number }[] = [];
  for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (!name.endsWith('.json')) continue;
    const key = name.slice(0, -5);
    const record = await readRecord(dir, key);
    records.push({ key, usedAt: record?.usedAt ?? 0 });
  }
  records.sort((a, b) => b.usedAt - a.usedAt);
  for (const { key } of records.slice(KEEP)) {
    if (key === keep) continue;
    for (const name of [`${key}.json`, `${key}.peaks`]) {
      await dir.removeEntry(name).catch(() => undefined);
    }
  }
}

export interface OpenedCache {
  store: PeakStore;
  /** Set when the peaks are already complete. */
  record: CacheRecord | null;
  /** Where the peaks live, for the info shown to the user. */
  where: 'opfs' | 'memory';
  /** Saves the record once decoding is complete. */
  complete(bins: number, durationMs: number, overview: Int8Array): Promise<void>;
}

/** Opens (or creates) the cache entry for a file; falls back to memory without OPFS. */
export async function openCache(file: File): Promise<OpenedCache> {
  const memory: OpenedCache = {
    store: new MemoryPeakStore(),
    record: null,
    where: 'memory',
    complete: async () => undefined,
  };
  const dir = await directory();
  if (!dir) return memory;
  const key = cacheKey(file);
  const handle = await syncHandle(dir, `${key}.peaks`);
  if (!handle) return memory;
  const record = await readRecord(dir, key);
  const ready = record !== null && handle.getSize() >= record.bins * 2 ? record : null;
  if (ready) await writeRecord(dir, key, { ...ready, usedAt: Date.now() });
  return {
    store: new FilePeakStore(handle),
    record: ready,
    where: 'opfs',
    complete: async (bins, durationMs, overview) => {
      await writeRecord(dir, key, {
        format: FORMAT,
        bins,
        durationMs,
        overview: toBinary(overview),
        usedAt: Date.now(),
      });
      await evict(dir, key);
    },
  };
}

export const overviewOf = (record: CacheRecord): Int8Array => fromBinary(record.overview);
