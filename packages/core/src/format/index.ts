/**
 * Subtitle formats. The editor works on one document model (cues with times, text and
 * settings); each format supplies what is its own: the markup of its cue text (a text dialect),
 * the cue settings it has, and how files are recognised. WebVTT is the only format so far.
 */
import type { TextDialect } from './dialect.ts';
import { WEBVTT_TEXT } from './webvtt-text.ts';

export type FormatId = 'webvtt';

/** Cue settings a format can express; the cue editor offers these. */
export type CueSettingId = 'align' | 'vertical' | 'line' | 'position' | 'size' | 'region';

export interface SubtitleFormat {
  id: FormatId;
  /** The format's name, as shown to users. */
  name: string;
  /** File extensions, with the dot; the first is the one files are saved with. */
  extensions: readonly string[];
  mimeType: string;
  text: TextDialect;
  cueSettings: readonly CueSettingId[];
  /** Whether a file with this name and start of text is in this format. */
  recognise(name: string, start: string): boolean;
}

export const WEBVTT: SubtitleFormat = {
  id: 'webvtt',
  name: 'WebVTT',
  extensions: ['.vtt'],
  mimeType: 'text/vtt',
  text: WEBVTT_TEXT,
  cueSettings: ['align', 'vertical', 'line', 'position', 'size', 'region'],
  recognise: (name, start) => /^\uFEFF?WEBVTT(?:[ \t\r\n]|$)/.test(start) || /\.vtt$/i.test(name),
};

export const FORMATS: readonly SubtitleFormat[] = [WEBVTT];

export function formatById(id: FormatId): SubtitleFormat {
  return FORMATS.find((f) => f.id === id) ?? WEBVTT;
}

/**
 * The format of a file, from its name and the start of its text. Files no format recognises are
 * read as WebVTT, which reports what is wrong with them.
 */
export function formatOf(name: string, start: string): SubtitleFormat {
  return FORMATS.find((f) => f.recognise(name, start)) ?? WEBVTT;
}

export { textTimestamps, type TextDialect } from './dialect.ts';
export { WEBVTT_TEXT } from './webvtt-text.ts';
