/**
 * Diagnostic codes reported by the validator.
 *
 * Codes are stable identifiers: the UI, tests and docs refer to them, so never rename one; add a
 * new code instead. Each entry says how severe the problem is, where the spec defines the rule,
 * and what export does about it (export always produces a conforming file).
 */
import type { SourceRange } from './parser.ts';

export type Severity = 'error' | 'warning' | 'info';

export interface DiagnosticInfo {
  severity: Severity;
  /** Anchor in the WebVTT spec (https://w3c.github.io/webvtt/#…); '' for SubRip, which has none. */
  spec: string;
  /** One-line description of the rule. */
  rule: string;
  /** What export does about it. */
  fix: string;
}

const SPEC = 'https://w3c.github.io/webvtt/#';

export const DIAGNOSTICS = {
  // File structure (§4.1)
  'signature-invalid': {
    severity: 'error',
    spec: 'webvtt-file-body',
    rule: 'A WebVTT file must start with "WEBVTT", optionally followed by a space or tab and text.',
    fix: 'None: the file is not WebVTT and cannot be imported.',
  },
  'file-encoding': {
    severity: 'error',
    spec: 'webvtt-file-body',
    rule: 'A WebVTT file must be encoded as UTF-8. Parsers read other encodings as UTF-8, turning accented and non-Latin letters into "�" (and UTF-16 files into nothing).',
    fix: 'MicroVTT reads it in the encoding it was saved in (Windows-1252 when it is not valid UTF-8, or the one you choose), and export writes UTF-8.',
  },
  'signature-line-terminators': {
    severity: 'error',
    spec: 'webvtt-file-body',
    rule: 'The "WEBVTT" line must be followed by a blank line (two or more line terminators).',
    fix: 'A blank line is written after the signature line.',
  },
  'header-text': {
    severity: 'error',
    spec: 'webvtt-file-body',
    rule: 'Text directly after the "WEBVTT" line (such as "Kind:" / "Language:") is not allowed; parsers ignore it.',
    fix: 'The text is kept as a NOTE comment.',
  },
  'missing-final-line-terminator': {
    severity: 'error',
    spec: 'webvtt-file-body',
    rule: 'Every block, including the last, must end with a line terminator.',
    fix: 'The file ends with a line feed.',
  },
  'region-header-legacy': {
    severity: 'error',
    spec: 'webvtt-region',
    rule: 'Regions are defined in REGION blocks. A "Region: id=… width=…" line under "WEBVTT" is the 2014–15 drafts\' form, which parsers now ignore (with every cue\'s reference to it).',
    fix: 'MicroVTT reads it as the REGION block it meant, and export writes that block.',
  },
  'block-missing-blank-line': {
    severity: 'error',
    spec: 'webvtt-file-body',
    rule: 'Blocks must be separated by a blank line. A line containing "-->" always starts a new block.',
    fix: 'A blank line is inserted. If the line was meant as text, edit it and escape the arrow as "--&gt;".',
  },
  'block-discarded': {
    severity: 'error',
    spec: 'webvtt-file-body',
    rule: 'Every block must be a cue, a comment (NOTE), a STYLE block or a REGION block; parsers drop anything else.',
    fix: 'The text is kept as a NOTE comment.',
  },
  'style-after-cue': {
    severity: 'error',
    spec: 'webvtt-file-body',
    rule: 'STYLE blocks must come before the first cue; parsers ignore them afterwards.',
    fix: 'The block is kept as a NOTE comment (moving it would change how the file renders).',
  },
  'region-after-cue': {
    severity: 'error',
    spec: 'webvtt-file-body',
    rule: 'REGION blocks must come before the first cue; parsers ignore them afterwards.',
    fix: 'The block is kept as a NOTE comment (moving it would change how the file renders).',
  },
  'block-keyword-whitespace': {
    severity: 'error',
    spec: 'webvtt-style-block',
    rule: 'Only spaces and tabs may follow "STYLE" or "REGION" on its line.',
    fix: 'The keyword line is rewritten.',
  },
  'style-empty': {
    severity: 'info',
    spec: 'webvtt-style-block',
    rule: 'A STYLE block with no style sheet has no effect; parsers ignore it.',
    fix: 'The empty block is removed.',
  },
  'note-contains-arrow': {
    severity: 'error',
    spec: 'webvtt-comment-block',
    rule: 'A comment (NOTE) must not contain "-->".',
    fix: 'The comment is kept with the arrow broken up ("-- >").',
  },
  // Cues (§4.1)
  'cue-timings-invalid': {
    severity: 'error',
    spec: 'webvtt-cue-timings',
    rule: 'A line containing "-->" must be valid cue timings; otherwise parsers drop the whole block.',
    fix: 'The block is kept as a NOTE comment.',
  },
  'timestamp-syntax': {
    severity: 'error',
    spec: 'webvtt-timestamp',
    rule: 'Timestamps are [hh:]mm:ss.ttt with at least two hour digits when hours are present.',
    fix: 'The timestamp is rewritten in canonical form.',
  },
  'timestamp-legacy': {
    severity: 'error',
    spec: 'webvtt-timestamp',
    rule: 'A timestamp is [hh:]mm:ss.ttt. Parsers drop a cue whose timings use another form, such as SRT\'s comma ("00:00:01,000"), one-digit fields or a different number of fraction digits.',
    fix: 'MicroVTT reads the time as meant, and export writes it in canonical form.',
  },
  'timing-whitespace': {
    severity: 'error',
    spec: 'webvtt-cue-timings',
    rule: 'Cue timings are "start --> end" with spaces or tabs around the arrow and before the settings, and nothing before the start time.',
    fix: 'The timing line is rewritten.',
  },
  'cue-start-order': {
    severity: 'error',
    spec: 'webvtt-cue-timings',
    rule: 'A cue must not start before the previous cue in the file.',
    fix: 'Cues are sorted by start time (stable).',
  },
  'cue-end-not-after-start': {
    severity: 'error',
    spec: 'webvtt-cue-timings',
    rule: "A cue's end time must be greater than its start time.",
    fix: 'The end time is set to the start time plus 1 ms.',
  },
  'cue-id-duplicate': {
    severity: 'error',
    spec: 'webvtt-cue-identifier',
    rule: 'Cue identifiers must be unique.',
    fix: 'A numeric suffix is added to later duplicates.',
  },
  'cue-id-invalid': {
    severity: 'error',
    spec: 'webvtt-cue-identifier',
    rule: 'A cue identifier is one line and must not contain "-->". (Only possible through editing; files cannot express it.)',
    fix: 'Line breaks become spaces and arrows are broken up ("-- >").',
  },
  'cue-id-keyword': {
    severity: 'warning',
    spec: 'webvtt-cue-identifier',
    rule: 'A cue id that starts with "NOTE", "STYLE" or "REGION" is valid, but browsers may drop the id, and ffmpeg, video.js and Shaka Player may drop the whole cue.',
    fix: 'Kept. The export option "Remove cue ids that start with NOTE, STYLE or REGION" removes them.',
  },
  // Cue settings (§4.4)
  'cue-settings-whitespace': {
    severity: 'error',
    spec: 'webvtt-cue-settings-list',
    rule: 'Cue settings are separated by spaces or tabs, with nothing after the last one.',
    fix: 'The settings are rewritten.',
  },
  'cue-setting-malformed': {
    severity: 'error',
    spec: 'webvtt-cue-settings-list',
    rule: 'Each cue setting is "name:value" with a non-empty name and value.',
    fix: 'The setting is dropped (parsers ignore it).',
  },
  'cue-setting-unknown': {
    severity: 'error',
    spec: 'webvtt-cue-settings-list',
    rule: 'The only cue settings are vertical, line, position, size, align and region.',
    fix: 'The setting is dropped (parsers ignore it).',
  },
  'cue-setting-duplicate': {
    severity: 'error',
    spec: 'webvtt-cue-settings-list',
    rule: 'Each cue setting may appear at most once.',
    fix: 'The setting is written once, with the value parsers use.',
  },
  'cue-setting-value': {
    severity: 'error',
    spec: 'webvtt-cue-settings-list',
    rule: 'Each cue setting has a fixed set of valid values.',
    fix: 'Invalid values are dropped (parsers ignore them); valid-but-noncanonical values are rewritten.',
  },
  'cue-setting-legacy': {
    severity: 'error',
    spec: 'webvtt-cue-settings-list',
    rule: 'A cue setting uses a name from an older draft: "middle" or position "start"/"end" (2014–15), or a single-letter setting such as "A:middle" or "T:10%" (2010–11). Parsers ignore the whole setting; YouTube still writes "middle".',
    fix: 'MicroVTT reads it as it was meant, and export writes the current form ("align:center", "position:10%,line-left", …).',
  },
  'cue-setting-out-of-range': {
    severity: 'error',
    spec: 'webvtt-cue-settings-list',
    rule: 'Percentages in cue settings must be between 0% and 100%; parsers ignore a setting outside that range.',
    fix: 'MicroVTT clamps it to 0% or 100% (a guess: the file does not say what was meant), and export writes the clamped value.',
  },
  'cue-line-not-integer': {
    severity: 'error',
    spec: 'webvtt-line-cue-setting',
    rule: 'A line number (without %) must be an integer.',
    fix: 'The line number is rounded to the nearest integer.',
  },
  'cue-region-undefined': {
    severity: 'warning',
    spec: 'webvtt-region-cue-setting',
    rule: 'The cue refers to a region that is not defined before the first cue.',
    fix: 'The region reference is dropped (parsers ignore it).',
  },
  'cue-region-ignored': {
    severity: 'warning',
    spec: 'webvtt-region-cue-setting',
    rule: 'A cue with a vertical, line or size setting is taken out of its region.',
    fix: 'The region reference is dropped (parsers ignore it).',
  },
  // Cue text (§4.2)
  'cue-text-character-reference': {
    severity: 'error',
    spec: 'webvtt-caption-or-subtitle-cue-text',
    rule: 'A "&" must start a valid character reference ending in ";" (write a literal & as "&amp;").',
    fix: 'The cue text is rewritten with valid references.',
  },
  'cue-text-tag': {
    severity: 'error',
    spec: 'webvtt-caption-or-subtitle-cue-text',
    rule: 'Tags are <c>, <i>, <b>, <u>, <ruby>, <rt>, <v>, <lang> and timestamps (write a literal < as "&lt;").',
    fix: 'The cue text is rewritten; unknown tags are dropped as parsers drop them.',
  },
  'cue-text-legacy-tag': {
    severity: 'error',
    spec: 'webvtt-cue-text',
    rule: 'WebVTT cue text has no "<br>" or "<font>" tags (SRT and HTML habits). Parsers drop them, keeping the text: words on either side of "<br>" run together, and colours are lost.',
    fix: 'MicroVTT reads "<br>" as a line break and "<font color>" as a class: one of the spec\'s default colour classes ("<c.yellow>"), or a generated class with a STYLE rule. Export writes those.',
  },
  'cue-text-class': {
    severity: 'error',
    spec: 'webvtt-cue-span-start-tag',
    rule: 'A class name follows "." immediately and has no spaces, "&", "<", ">" or ".".',
    fix: 'The cue text is rewritten without empty classes.',
  },
  'cue-text-annotation': {
    severity: 'error',
    spec: 'webvtt-cue-span-start-tag',
    rule: '<v> and <lang> require an annotation; other tags must not have one.',
    fix: 'The cue text is rewritten; annotations parsers ignore are dropped.',
  },
  'cue-text-nesting': {
    severity: 'error',
    spec: 'webvtt-caption-or-subtitle-cue-text',
    rule: 'Spans must be closed in order. Only a voice span that is the whole cue, or the last ruby text, may omit its end tag.',
    fix: 'The cue text is rewritten with the structure parsers build.',
  },
  'cue-text-ruby': {
    severity: 'error',
    spec: 'webvtt-cue-ruby-span',
    rule: '<rt> may only appear directly inside <ruby>, and a ruby span needs base text followed by <rt>.',
    fix: 'The cue text is rewritten with the structure parsers build.',
  },
  'cue-text-timestamp': {
    severity: 'error',
    spec: 'webvtt-cue-timestamp',
    rule: 'Timestamps in cue text must be valid, increasing, and inside the cue.',
    fix: 'Invalid or out-of-order timestamps are removed; the text is kept.',
  },
  'cue-text-language': {
    severity: 'error',
    spec: 'webvtt-cue-language-span',
    rule: 'A <lang> annotation must be a valid BCP 47 language tag.',
    fix: 'The language span is unwrapped; its text is kept.',
  },
  'chapter-title-markup': {
    severity: 'error',
    spec: 'webvtt-chapter-title-text',
    rule: 'Chapter titles may only contain text and character references.',
    fix: 'Markup is removed; the title text is kept.',
  },
  'chapters-not-nested': {
    severity: 'error',
    spec: 'webvtt-file-using-only-nested-cues',
    rule: 'In a chapters file every pair of cues must either nest or not overlap.',
    fix: 'None automatically: fix the chapter times.',
  },
  // Regions (§4.3)
  'region-id-missing': {
    severity: 'error',
    spec: 'webvtt-region-identifier-setting',
    rule: 'Every region must have an id.',
    fix: 'The region is removed (no cue can refer to it).',
  },
  'region-id-duplicate': {
    severity: 'error',
    spec: 'webvtt-region-identifier-setting',
    rule: 'Region ids must be unique.',
    fix: 'Earlier duplicates are removed (cues use the last region with an id).',
  },
  'region-id-invalid': {
    severity: 'error',
    spec: 'webvtt-region-identifier-setting',
    rule: 'A region id must not contain "-->".',
    fix: 'The region and references to it are renamed.',
  },
  'region-settings-whitespace': {
    severity: 'error',
    spec: 'webvtt-region-settings-list',
    rule: 'Region settings are separated by spaces, tabs or single line breaks.',
    fix: 'The settings are rewritten.',
  },
  'region-setting-malformed': {
    severity: 'error',
    spec: 'webvtt-region-settings-list',
    rule: 'Each region setting is "name:value" with a non-empty name and value.',
    fix: 'The setting is dropped (parsers ignore it).',
  },
  'region-setting-unknown': {
    severity: 'error',
    spec: 'webvtt-region-settings-list',
    rule: 'The only region settings are id, width, lines, regionanchor, viewportanchor and scroll.',
    fix: 'The setting is dropped (parsers ignore it).',
  },
  'region-setting-duplicate': {
    severity: 'error',
    spec: 'webvtt-region-settings-list',
    rule: 'Each region setting may appear at most once.',
    fix: 'The setting is written once, with the value parsers use.',
  },
  'region-setting-value': {
    severity: 'error',
    spec: 'webvtt-region-settings-list',
    rule: 'Each region setting has a fixed set of valid values.',
    fix: 'Invalid values are dropped (parsers ignore them).',
  },
  // Style sheets (§4.1, §8)
  'style-css-syntax': {
    severity: 'error',
    spec: 'webvtt-style-block',
    rule: 'A STYLE block must contain a valid CSS style sheet.',
    fix: 'Rules and declarations that do not parse are removed.',
  },
  'style-selector': {
    severity: 'warning',
    spec: 'the-cue-pseudo-element',
    rule: 'Only ::cue and ::cue-region rules affect WebVTT cues.',
    fix: 'None: the rule is kept as written.',
  },
  'style-property-ignored': {
    severity: 'warning',
    spec: 'the-cue-pseudo-element',
    rule: 'This property does not apply to ::cue or ::cue-region and is ignored.',
    fix: 'None: the declaration is kept as written.',
  },
  // SubRip (.srt). It has no specification; the rules are what players commonly read.
  'srt-block-unreadable': {
    severity: 'error',
    spec: '',
    rule: 'Each SubRip block is a number, a timing line ("00:00:01,000 --> 00:00:02,500") and text. Lines that are not part of such a block are skipped by players.',
    fix: 'The lines are left out: they are not in the document.',
  },
  'srt-encoding': {
    severity: 'info',
    spec: '',
    rule: 'SubRip files have no set encoding, and players guess it. UTF-8 is read most widely.',
    fix: "Export writes UTF-8, or the file's own encoding when you choose it and every character fits.",
  },
  'srt-timing-format': {
    severity: 'warning',
    spec: '',
    rule: 'SubRip times are written HH:MM:SS,mmm. Other forms (a full stop for the comma, missing hours, one-digit fields) are read by some players and not others.',
    fix: 'Times are written HH:MM:SS,mmm.',
  },
  'srt-numbering': {
    severity: 'info',
    spec: '',
    rule: 'SubRip cues are numbered from 1 in order. Players ignore the numbers, but some tools need them.',
    fix: 'Cues are numbered from 1.',
  },
  'srt-coordinates': {
    severity: 'warning',
    spec: '',
    rule: 'Box coordinates after the times ("X1:100 X2:600 Y1:400 Y2:450", from DVD rips) are not read by most players.',
    fix: 'The coordinates are left out.',
  },
  'srt-end-before-start': {
    severity: 'warning',
    spec: '',
    rule: 'A cue must end after it starts; players skip or misplace cues that do not.',
    fix: 'None: the times are written as they are.',
  },
  'srt-blank-line': {
    severity: 'error',
    spec: '',
    rule: 'A blank line ends a SubRip cue, so cue text cannot contain one.',
    fix: 'Blank lines in cue text are left out.',
  },
  'srt-arrow': {
    severity: 'error',
    spec: '',
    rule: 'A line of cue text containing "-->" is read as the timing line of a new cue.',
    fix: '"-->" in cue text is written as "->".',
  },
  'srt-unknown-tag': {
    severity: 'warning',
    spec: '',
    rule: 'Players know <b>, <i>, <u>, <s>, <font color/face/size> and override blocks such as {\\an8} and {\\i1}; others are shown as text by some players and hidden by others.',
    fix: 'None: the markup is kept as written.',
  },
} as const satisfies Record<string, DiagnosticInfo>;

export type DiagnosticCode = keyof typeof DIAGNOSTICS;

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  /** Range in the normalized input. */
  range: SourceRange;
}

/** The spec section a code's rule comes from, or '' when no spec defines it (SubRip). */
export const specUrl = (code: DiagnosticCode): string =>
  DIAGNOSTICS[code].spec === '' ? '' : SPEC + DIAGNOSTICS[code].spec;

export function diagnostic(code: DiagnosticCode, message: string, range: SourceRange): Diagnostic {
  return { code, severity: DIAGNOSTICS[code].severity, message, range };
}
