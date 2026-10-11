/** The kinds of WebVTT file the editor knows (a track's `kind`), for the type pickers. */
import type { FileType } from '@microvtt/core';

export const FILE_TYPES: readonly { value: FileType; label: string }[] = [
  { value: 'captions', label: 'Captions / subtitles' },
  { value: 'chapters', label: 'Chapters' },
  { value: 'metadata', label: 'Metadata' },
  { value: 'any', label: 'Any (structure only)' },
];
