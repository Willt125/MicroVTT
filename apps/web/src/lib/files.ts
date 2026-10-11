/**
 * Opening and saving files. Where the File System Access API exists (Chromium), files opened
 * through it can be saved back in place; elsewhere saving downloads a copy.
 */
import { FORMATS, type SubtitleFormat } from '@microvtt/core';

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface PickerWindow {
  showOpenFilePicker(options: {
    types: PickerType[];
    excludeAcceptAllOption?: boolean;
  }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options: {
    suggestedName: string;
    types: PickerType[];
  }): Promise<FileSystemFileHandle>;
}
type PermissionHandle = FileSystemFileHandle & {
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
};

const pickerType = (format: SubtitleFormat): PickerType => ({
  description: format.name,
  accept: { [format.mimeType]: [...format.extensions] },
});

/** The `accept` list for file inputs: every format's extensions and MIME type. */
export const ACCEPT = FORMATS.flatMap((f) => [...f.extensions, f.mimeType]).join(',');

const picker = (): PickerWindow | null =>
  typeof window !== 'undefined' && 'showOpenFilePicker' in window
    ? (window as unknown as PickerWindow)
    : null;

/** True where files can be saved back to where they were opened from. */
export const canSaveInPlace = (): boolean => picker() !== null;

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

/** Shows the open picker for subtitle files. Returns null if cancelled. */
export async function pickSubtitleFile(): Promise<{
  file: File;
  handle: FileSystemFileHandle;
} | null> {
  try {
    const [handle] = await picker()!.showOpenFilePicker({ types: FORMATS.map(pickerType) });
    if (!handle) return null;
    return { file: await handle.getFile(), handle };
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** Shows the save picker for a file in `format`. Returns null if cancelled. */
export async function pickSaveFile(
  suggestedName: string,
  format: SubtitleFormat,
): Promise<FileSystemFileHandle | null> {
  try {
    return await picker()!.showSaveFilePicker({ suggestedName, types: [pickerType(format)] });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** Writes `text` to a file handle, asking for write permission first if needed. */
export async function writeFile(handle: FileSystemFileHandle, text: string): Promise<boolean> {
  const h = handle as PermissionHandle;
  if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await h.requestPermission?.({ mode: 'readwrite' })) !== 'granted') return false;
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return true;
}

/** Saves a copy through the browser's downloads. */
export function download(text: string, name: string, format: SubtitleFormat): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${format.mimeType};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The file handle of a dropped item, where supported. Must be called during the drop event:
 * the data transfer is emptied once the handler returns.
 */
export function droppedHandle(
  item: DataTransferItem | undefined,
): Promise<FileSystemFileHandle | null> {
  const getter = (item as { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
    ?.getAsFileSystemHandle;
  if (!item || !getter) return Promise.resolve(null);
  return getter
    .call(item)
    .then((h) => (h?.kind === 'file' ? (h as FileSystemFileHandle) : null))
    .catch(() => null);
}
