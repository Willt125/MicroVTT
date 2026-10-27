/**
 * The open video's shot changes: marked by hand or imported from a list, and kept in this
 * browser per media file (by name, size and date, like the waveform cache), so they come back
 * when the same video is opened again. They are not part of the caption file.
 */
import { normalizeShotChanges, toggleShotChange } from '@microvtt/core';
import { cacheKey } from '../waveform/cache.ts';

const STORE_KEY = 'microvtt.shotChanges';
/** Videos whose shot changes are kept; the least recently used go first. */
const KEEP = 20;

interface Stored {
  usedAt: number;
  /** Times in ms. */
  times: number[];
}

function readStore(): Record<string, Stored> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Stored>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, Stored>): void {
  const kept = Object.entries(store)
    .sort(([, a], [, b]) => b.usedAt - a.usedAt)
    .slice(0, KEEP);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Not kept (storage full or unavailable); the marks still apply until the page closes.
  }
}

export class ShotChanges {
  /** Times in ms, sorted. */
  times = $state.raw<number[]>([]);
  private key: string | null = null;

  /** Switches to a media file's shot changes (none for no file). */
  open(file: { name: string; size: number; lastModified: number } | null): void {
    this.key = file ? cacheKey(file) : null;
    const stored = this.key ? readStore()[this.key] : undefined;
    this.times = Array.isArray(stored?.times)
      ? normalizeShotChanges(stored.times.filter((t) => Number.isFinite(t) && t >= 0))
      : [];
    if (stored) this.save();
  }

  /** Replaces the list. */
  set(times: readonly number[]): void {
    this.times = normalizeShotChanges(times);
    this.save();
  }

  /** Marks a shot change at `ms`, or removes the one within `toleranceMs`. True if added. */
  toggle(ms: number, toleranceMs: number): boolean {
    const before = this.times.length;
    this.set(toggleShotChange(this.times, ms, toleranceMs));
    return this.times.length > before;
  }

  private save(): void {
    if (!this.key) return;
    const store = readStore();
    if (this.times.length === 0) delete store[this.key];
    else store[this.key] = { usedAt: Date.now(), times: this.times };
    writeStore(store);
  }
}
