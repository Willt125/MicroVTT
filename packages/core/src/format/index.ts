/**
 * Subtitle formats. The editor works on one document model (cues with times, text and
 * settings); each format supplies what is its own: the markup of its cue text (a text dialect),
 * the cue settings it has, and how files are recognised.
 */
import { looksLikeSrt } from '../srt/parse.ts';
import { SRT_TEXT } from '../srt/text.ts';
import type { TextDialect } from './dialect.ts';
import { WEBVTT_TEXT } from './webvtt-text.ts';

export type FormatId = 'webvtt' | 'srt';

/**
 * Cue settings a format can express; the cue editor offers these. `anchor` is SubRip's position
 * block (`{\an8}`), kept in the cue text.
 */
export type CueSettingId =
  'align' | 'vertical' | 'line' | 'position' | 'size' | 'region' | 'anchor';

export interface SubtitleFormat {
  id: FormatId;
  /** The format's name, as shown to users. */
  name: string;
  /** File extensions, with the dot; the first is the one files are saved with. */
  extensions: readonly string[];
  mimeType: string;
  text: TextDialect;
  cueSettings: readonly CueSettingId[];
  /** Whether cues have identifiers (SubRip numbers its cues instead). */
  cueIds: boolean;
  /** Whether a file starting with this text is in this format. */
  sniff(start: string): boolean;
}

export const WEBVTT: SubtitleFormat = {
  id: 'webvtt',
  name: 'WebVTT',
  extensions: ['.vtt'],
  mimeType: 'text/vtt',
  text: WEBVTT_TEXT,
  cueSettings: ['align', 'vertical', 'line', 'position', 'size', 'region'],
  cueIds: true,
  sniff: (start) => /^\uFEFF?WEBVTT(?:[ \t\r\n]|$)/.test(start),
};

export const SRT: SubtitleFormat = {
  id: 'srt',
  name: 'SubRip',
  extensions: ['.srt'],
  mimeType: 'application/x-subrip',
  text: SRT_TEXT,
  cueSettings: ['anchor'],
  cueIds: false,
  sniff: looksLikeSrt,
};

export const FORMATS: readonly SubtitleFormat[] = [WEBVTT, SRT];

export function formatById(id: FormatId): SubtitleFormat {
  return FORMATS.find((f) => f.id === id) ?? WEBVTT;
}

/**
 * The format of a file: from the start of its text (so a SubRip file named .vtt opens as
 * SubRip), else from its extension. Files neither recognises are read as WebVTT, which reports
 * what is wrong with them.
 */
export function formatOf(name: string, start: string): SubtitleFormat {
  const lower = name.toLowerCase();
  return (
    FORMATS.find((f) => f.sniff(start)) ??
    FORMATS.find((f) => f.extensions.some((ext) => lower.endsWith(ext))) ??
    WEBVTT
  );
}

export { textTimestamps, type TextDialect } from './dialect.ts';
export { WEBVTT_TEXT } from './webvtt-text.ts';
