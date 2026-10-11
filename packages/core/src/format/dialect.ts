/**
 * How a subtitle format writes cue text, and the text operations that depend on it. Everything
 * common to every format (the cue list, timing, find, the timeline, the quality rules) reaches
 * cue text through a dialect, never through one format's markup directly.
 */
export interface TextDialect {
  /**
   * A regular expression source for one markup token (a tag, an override block), with no
   * capturing groups and never matching a line break. Quality fixes keep these as they are, and
   * find skips them between words.
   */
  readonly tag: string;
  /** Like `tag`, for a token that closes a span; text added at the end goes before these. */
  readonly closingTag: string;
  /** A short description of the markup, for the cue text field. */
  readonly markupHint: string;
  /** Whether the raw text differs from what is read: markup, or escaped characters. */
  hasMarkup(text: string): boolean;
  /** The text a viewer reads, by line: markup removed, annotations (ruby text) left out. */
  readableLines(text: string): string[];
  /** The text to show for a cue in lists, by line: like `readableLines`, annotations kept. */
  displayLines(text: string): string[];
  /** Whether the text has italic spans. */
  hasItalics(text: string): boolean;
  /** The text with its italic markup removed (the text inside kept). */
  removeItalics(text: string): string;
  /**
   * Divides raw text near `offset` into two well-formed texts: never inside a tag or an escape;
   * spans open at the split closed in the first and reopened in the second; whitespace at the
   * split dropped.
   */
  splitText(text: string, offset: number): [string, string];
  /**
   * Calls `fn` for every time written in the text (word timings) and puts in its result: a new
   * time in ms, or null to remove it. Text in a format without times is returned as it is.
   */
  mapTimestamps(text: string, fn: (ms: number) => number | null): string;
  /** Markup that records a time inside text (for merged cues), or '' if the format has none. */
  timestampMarkup(ms: number): string;
}

/** The times written in `text` (word timings), in order. */
export function textTimestamps(dialect: TextDialect, text: string): number[] {
  const out: number[] = [];
  dialect.mapTimestamps(text, (ms) => {
    out.push(ms);
    return ms;
  });
  return out;
}
