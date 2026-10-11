/** SubRip (.srt): its text dialect, reading, checking, writing, and conversion to and from WebVTT. */
export { SRT_TEXT, srtAnchor, withSrtAnchor } from './text.ts';
export { looksLikeSrt, parseSrt, itemDiagnostic } from './parse.ts';
export type { ItemDiagnostic, SrtImport, SrtStyle } from './parse.ts';
export { formatSrtTime, validateSrt, writeSrt } from './write.ts';
export type { SrtWriteResult } from './write.ts';
export { srtToVtt, vttToSrt } from './convert.ts';
export type { Conversion, ConversionLoss } from './convert.ts';
