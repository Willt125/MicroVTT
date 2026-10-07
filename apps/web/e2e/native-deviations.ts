/**
 * Known places where a browser's WebVTT parser differs from the spec (and so from ours), found by
 * `native.e2e.ts`. Each entry gives what in the input triggers it, the differences it causes, and
 * a minimal example. A difference is excused only when every difference for that input is
 * covered by an entry whose trigger matches the input, so a new kind of difference still fails.
 * The examples are themselves tested: each must still show its difference in the browsers listed,
 * so an entry that was wrong, or that a browser has since fixed, fails instead of hiding things.
 *
 * Our parser is checked against the spec by the WPT suite and by differential fuzzing against
 * the WPT reference parser, so where we and a browser disagree on these inputs, the browser is
 * the one off the spec. Entries marked `exportedFiles` can affect valid files MicroVTT writes.
 */

import type { CompatibilityId } from '@microvtt/core';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface Deviation {
  browsers: BrowserName[];
  /** Matches the input text when the deviation can occur. */
  trigger: RegExp;
  /** Matches each difference it explains (as `native.e2e.ts` words them). */
  difference: RegExp;
  reason: string;
  /** A minimal input that shows it. */
  example: string;
  exportedFiles?: boolean;
  /** The export compatibility fix that avoids it, if any. */
  fixedBy?: CompatibilityId;
}

const NL = String.raw`(?:\r\n|\r|\n)`;
const LINE = String.raw`[^\r\n]`;
const CUE = '00:00.000 --> 00:01.000';

export const DEVIATIONS: Deviation[] = [
  {
    browsers: ['chromium'],
    trigger: /\b(?:line|position):[^\s,]*,/,
    // A percentage line also leaves snapToLines at its default (true).
    difference: /^cue \d+ (?:(?:line|position): "auto"|snapToLines: true), expected /,
    reason:
      'ignores a line or position setting that has an alignment suffix (no lineAlign/positionAlign)',
    example: `WEBVTT\n\n${CUE} line:0,end\nx\n`,
    exportedFiles: true,
  },
  {
    browsers: ['chromium', 'firefox'],
    trigger: /\b(?:line|position|size):-?(?:\d+\.(?!\d)|\.\d)/,
    difference: /^cue \d+ (?:line|position|size): /,
    reason: 'accepts numbers with a bare "." ("6.", ".5") that the spec rejects',
    example: `WEBVTT\n\n${CUE} size:6.%\nx\n`,
  },
  {
    browsers: ['chromium', 'webkit'],
    trigger: new RegExp(`-->${LINE}*\\f`),
    difference: /^cue \d+ (?:line|position|size|align|vertical|region): /,
    reason: 'does not treat a form feed as whitespace between cue settings',
    example: `WEBVTT\n\n${CUE} align:start\fposition:69%\nx\n`,
  },
  {
    browsers: ['chromium', 'webkit', 'firefox'],
    trigger: new RegExp(`${LINE}+${NL}${LINE}+${NL}${LINE}*-->`),
    difference: /^cue \d+ id: ".*", expected ""$/,
    reason:
      'takes the line before a timing line as the cue id even where the spec ends the block (in the header, or after two lines of a block)',
    example: `WEBVTT\nheader\n${CUE}\nx\n`,
  },
  {
    browsers: ['chromium', 'webkit'],
    trigger: new RegExp(`(?:^|${NL})STYLE${LINE}*${NL}${LINE}*-->`),
    difference: /^cue \d+ id: "", expected "STYLE/,
    reason: 'drops a cue id that starts with "STYLE" before the first cue',
    example: `WEBVTT\n\nSTYLE\n${CUE}\nx\n`,
    fixedBy: 'keyword-ids',
    exportedFiles: true,
  },
  {
    browsers: ['webkit'],
    trigger: new RegExp(`(?:^|${NL})REGION${LINE}*${NL}${LINE}*-->`),
    difference: /^cue \d+ id: "", expected "REGION/,
    reason: 'drops a cue id that starts with "REGION" before the first cue',
    example: `WEBVTT\n\nREGION\n${CUE}\nx\n`,
    fixedBy: 'keyword-ids',
    exportedFiles: true,
  },
  {
    browsers: ['firefox'],
    trigger: new RegExp(`(?:^|${NL})(?:NOTE|STYLE|REGION)${LINE}*${NL}${LINE}*-->`),
    difference: /^cue \d+ id: "", expected "(?:NOTE|STYLE|REGION)/,
    reason: 'drops a cue id that starts with "NOTE", "STYLE" or "REGION"',
    example: `WEBVTT\n\nNOTE\n${CUE}\nx\n`,
    fixedBy: 'keyword-ids',
    exportedFiles: true,
  },
  {
    browsers: ['chromium'],
    trigger: new RegExp(`(?:^|${NL})NOTE${NL}STYLE[ \\t]*${NL}`),
    difference: /^cue \d+ id: /,
    reason: 'misreads the next cue id after a comment whose first line is "STYLE"',
    example: `WEBVTT\n\nNOTE\nSTYLE\n\n${CUE}\nx\n`,
    exportedFiles: true,
  },
  {
    // YouTube auto-captions put a " " line in most cues.
    browsers: ['firefox'],
    trigger: new RegExp(`${NL}[ \\t]+(?:${NL}|$)`),
    difference: /^cue \d+ text: /,
    reason: 'ends a cue at a line of only spaces or tabs, as if it were blank',
    example: `WEBVTT\n\n${CUE}\none\n \ntwo\n`,
    fixedBy: 'trim-whitespace',
    exportedFiles: true,
  },
  {
    browsers: ['firefox'],
    trigger: /\bline:[^\s,]*,(?!(?:start|center|end)(?:\s|$))/,
    difference: /^cue \d+ line: /,
    reason: 'keeps a line setting whose alignment is invalid ("line:19,") instead of rejecting it',
    example: `WEBVTT\n\n${CUE} line:19,\nx\n`,
  },
  {
    browsers: ['firefox'],
    trigger: /\bline:[^\s,]*,(?:start|center|end)\b/,
    difference: /^cue \d+ lineAlign: /,
    reason: 'applies a line alignment even when the line position is rejected ("line:-83%,end")',
    example: `WEBVTT\n\n${CUE} line:-83%,end\nx\n`,
  },
  {
    // An older draft defined regions in the header.
    browsers: ['firefox', 'webkit'],
    trigger: new RegExp(`^\\uFEFF?WEBVTT${LINE}*(?:${NL}${LINE}+)*?${NL}REGION`),
    difference: /^cue \d+ region: \S+, expected null$/,
    reason: 'defines a region from REGION lines in the header, which the spec ignores',
    example: `WEBVTT\nREGION\nid:r\n\n${CUE} region:r\nx\n`,
  },
  {
    browsers: ['webkit'],
    trigger: new RegExp(`(?:^|${NL})REGION${LINE}*(?:${NL}${LINE}+)*?${NL}${LINE}*-->`),
    difference: /^cue \d+ region: null, expected /,
    reason: 'ignores a REGION block that a timing line ends without a blank line',
    example: `WEBVTT\n\nREGION\nid:r\n${CUE} region:r\nx\n`,
  },
  {
    // Exported files keep unparsed header text as a leading comment, which hides their regions.
    browsers: ['firefox'],
    trigger: new RegExp(
      `^\\uFEFF?WEBVTT${LINE}*${NL}(?:${NL})*(?!REGION)${LINE}[\\s\\S]*${NL}REGION`,
    ),
    difference: /^cue \d+ region: null, expected /,
    reason:
      'ignores REGION blocks unless they come first after the signature (header text or a comment before them hides them)',
    example: `WEBVTT\nLanguage: en\n\nREGION\nid:r\n\n${CUE} region:r\nx\n`,
    fixedBy: 'regions-first',
    exportedFiles: true,
  },
  {
    browsers: ['firefox', 'webkit'],
    trigger: new RegExp(`-->${LINE}*\\b(?:line|size|vertical):`),
    difference: /^cue \d+ region: \S+, expected null$/,
    reason: 'keeps a cue in its region when it also has a line, size or vertical setting',
    example: `WEBVTT\n\nREGION\nid:r\n\n${CUE} region:r line:1\nx\n`,
  },
  {
    browsers: ['firefox'],
    trigger: new RegExp(`-->${LINE}*\\bregion:${LINE}*\\bregion:`),
    difference: /^cue \d+ region: \S+, expected null$/,
    reason: 'a later region setting with an unknown id does not clear an earlier one',
    example: `WEBVTT\n\nREGION\nid:r\n\n${CUE} region:r region:zz\nx\n`,
  },
];

/** The reasons, if every difference for this input is a known deviation of this browser. */
export function knownDeviation(browser: string, text: string, diffs: string[]): string | null {
  const matching = DEVIATIONS.filter(
    (d) => d.browsers.includes(browser as BrowserName) && d.trigger.test(text),
  );
  const reasons = new Set<string>();
  for (const diff of diffs) {
    const d = matching.find((m) => m.difference.test(diff));
    if (!d) return null;
    reasons.add(d.reason);
  }
  return [...reasons].join('; ');
}
