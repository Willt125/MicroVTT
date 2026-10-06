/**
 * Autosave to the origin private file system (OPFS), from the worker. Uses synchronous access
 * handles, the one OPFS write API that Chromium, Firefox and Safari all support in workers.
 *
 * Saves alternate between two files and each carries its time, so a crash in the middle of a
 * write leaves the previous save intact; loading picks the newest one that parses.
 */
import type { VttDocument } from '@microvtt/core';
import type { Autosave } from './protocol.ts';

const SLOTS = ['autosave-a.json', 'autosave-b.json'] as const;
const FORMAT = 1;

interface SyncAccessHandle {
  read(buffer: Uint8Array, options?: { at: number }): number;
  write(buffer: Uint8Array, options?: { at: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}
type WorkerFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccessHandle>;
};

let nextSlot = 0;

async function root(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator.storage?.getDirectory !== 'function') return null;
  if (typeof FileSystemFileHandle === 'undefined') return null;
  if (!('createSyncAccessHandle' in FileSystemFileHandle.prototype)) return null;
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null; // E.g. private browsing in some browsers.
  }
}

async function open(dir: FileSystemDirectoryHandle, name: string, create: boolean) {
  const file = (await dir.getFileHandle(name, { create })) as WorkerFileHandle;
  return file.createSyncAccessHandle();
}

/** Writes a save; returns false where OPFS is unavailable. */
export async function writeAutosave(save: Autosave): Promise<boolean> {
  const dir = await root();
  if (!dir) return false;
  const bytes = new TextEncoder().encode(JSON.stringify({ format: FORMAT, ...save }));
  const handle = await open(dir, SLOTS[nextSlot] as string, true);
  try {
    handle.truncate(0);
    handle.write(bytes, { at: 0 });
    handle.flush();
  } finally {
    handle.close();
  }
  nextSlot = 1 - nextSlot;
  return true;
}

async function readSlot(dir: FileSystemDirectoryHandle, name: string): Promise<Autosave | null> {
  try {
    const handle = await open(dir, name, false);
    try {
      const bytes = new Uint8Array(handle.getSize());
      handle.read(bytes, { at: 0 });
      const data = JSON.parse(new TextDecoder().decode(bytes)) as Autosave & { format: number };
      if (data.format !== FORMAT || !Array.isArray((data.document as VttDocument)?.body))
        return null;
      return { meta: data.meta, document: data.document };
    } finally {
      handle.close();
    }
  } catch {
    return null; // Missing, locked by another tab, or torn.
  }
}

/** The newest readable save, or null. */
export async function readAutosave(): Promise<Autosave | null> {
  const dir = await root();
  if (!dir) return null;
  let best: Autosave | null = null;
  for (const [i, name] of SLOTS.entries()) {
    const save = await readSlot(dir, name);
    if (save && (!best || save.meta.savedAt > best.meta.savedAt)) {
      best = save;
      nextSlot = 1 - i; // Next write must not overwrite the newest save.
    }
  }
  return best;
}

export async function clearAutosave(): Promise<void> {
  const dir = await root();
  if (!dir) return;
  for (const name of SLOTS) await dir.removeEntry(name).catch(() => {});
}
