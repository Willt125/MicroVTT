/**
 * Known places where a browser's WebVTT parser differs from the spec (and so from ours), found by
 * `native.e2e.ts`. Each entry gives what in the input triggers it, the differences it causes, and
 * a minimal reproduction. A difference is excused only when every difference for that input is
 * covered by an entry whose trigger matches the input, so a new kind of difference still fails.
 *
 * Our parser is checked against the spec by the WPT suite and by differential fuzzing against
 * the WPT reference parser, so where we and a browser disagree on these inputs, the browser is
 * the one off the spec. Several of these also affect files a user exports (noted below).
 */

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

interface Deviation {
  browsers: BrowserName[];
  /** Matches the input text when the deviation can occur. */
  trigger: RegExp;
  /** Matches each difference it explains (as `native.e2e.ts` words them). */
  difference: RegExp;
  reason: string;
}

const NL = String.raw`(?:\r\n|\r|\n)`;
const LINE = String.raw`[^\r\n]`;

const DEVIATIONS: Deviation[] = [
  {
    // "00:00.000 --> 00:01.000 line:0,end" → line "auto". Affects exported files.
    browsers: ['chromium'],
    trigger: /\b(?:line|position):[^\s,]*,/,
    difference: /^cue \d+ (?:line|position): "auto", expected /,
    reason:
      'Chromium ignores a line or position setting that has an alignment suffix (it has no lineAlign/positionAlign)',
  },
  {
    // "size:6.%", "position:5.%", "line:1.", "line:-.5" are accepted.
    browsers: ['chromium', 'firefox'],
    trigger: /\b(?:line|position|size):-?(?:\d+\.(?!\d)|\.\d)/,
    difference: /^cue \d+ (?:line|position|size): /,
    reason: 'accepts numbers with a bare "." ("6.", ".5") that the spec rejects',
  },
  {
    // "... --> 00:01.000 ::\fposition:69%" → position "auto".
    browsers: ['chromium', 'webkit'],
    trigger: new RegExp(`-->${LINE}*\\f`),
    difference: /^cue \d+ (?:line|position|size|align|vertical|region): /,
    reason: 'does not treat a form feed as whitespace between cue settings',
  },
  {
    // "WEBVTT\n \n00:00.000 --> 00:01.000" → cue id " " (WPT header-space, header-tab).
    browsers: ['chromium', 'webkit'],
    trigger: new RegExp(`${LINE}+${NL}${LINE}+${NL}${LINE}*-->`),
    difference: /^cue \d+ id: ".*", expected ""$/,
    reason:
      'takes the line before a timing line as the cue id even where the spec ends the block (in the header, or after two lines of a block)',
  },
  {
    // "WEBVTT\n\nSTYLE \n00:00.000 --> 00:01.000" → cue id "". Affects exported files.
    browsers: ['chromium', 'webkit'],
    trigger: new RegExp(`(?:^|${NL})STYLE${LINE}*${NL}${LINE}*-->`),
    difference: /^cue \d+ id: "", expected "STYLE/,
    reason: 'drops a cue id that starts with "STYLE" before the first cue',
  },
  {
    // "WEBVTT\n\nREGION\n00:00.000 --> 00:01.000" → cue id "". Affects exported files.
    browsers: ['webkit'],
    trigger: new RegExp(`(?:^|${NL})REGION${LINE}*${NL}${LINE}*-->`),
    difference: /^cue \d+ id: "", expected "REGION/,
    reason: 'drops a cue id that starts with "REGION" before the first cue',
  },
  {
    // "WEBVTT\n\nNOTE\n00:00.000 --> 00:01.000" → cue id "". Affects exported files.
    browsers: ['firefox'],
    trigger: new RegExp(`(?:^|${NL})(?:NOTE|STYLE|REGION)${LINE}*${NL}${LINE}*-->`),
    difference: /^cue \d+ id: "", expected "(?:NOTE|STYLE|REGION)/,
    reason: 'drops a cue id that starts with "NOTE", "STYLE" or "REGION"',
  },
  {
    // "WEBVTT\n\n00:00.000 --> 00:01.000\none\n \ntwo" → text "one". Affects exported files,
    // and YouTube auto-captions, which put a " " line in most cues.
    browsers: ['firefox'],
    trigger: new RegExp(`${NL}[ \\t]+(?:${NL}|$)`),
    difference: /^cue \d+ text: /,
    reason: 'ends a cue at a line of only spaces or tabs, as if it were blank',
  },
  {
    // "WEBVTT\n\nNOTE\nSTYLE\n\n00:00.000 --> 00:01.000" → cue id "NOTE". Affects exported files
    // that keep a discarded STYLE block as a comment.
    browsers: ['chromium'],
    trigger: new RegExp(`(?:^|${NL})NOTE${NL}STYLE[ \\t]*${NL}`),
    difference: /^cue \d+ id: /,
    reason: 'Chromium misreads the next cue id after a comment whose first line is "STYLE"',
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
