# YouTube upload test

YouTube converts uploaded caption files to its own format, and that conversion cannot be run
locally. This is a manual check of what it keeps. The results go into `YOUTUBE` in
`packages/core/src/features.ts`, which drives the export dialog's "Uploading to YouTube?" list
(warnings only: the file is valid either way).

## Files

Both are generated from the feature catalogue (`pnpm gen:youtube-test`; a test fails when they
are stale). Each caption says what you should see. A feature has the same number and start time
in both files.

- [`youtube-test.vtt`](youtube-test.vtt): every feature, with a STYLE and a REGION block in the
  header.
- [`youtube-test-no-blocks.vtt`](youtube-test-no-blocks.vtt): the same without the STYLE and
  REGION blocks (features 17 and 18), in case they make YouTube reject the file or lose cues,
  as ffmpeg does.

## How to run it

1. Upload any video at least 2:15 long, as private or unlisted.
2. In YouTube Studio, open the video's Subtitles, add a language, choose "Upload file", "With
   timing", and pick `youtube-test.vtt`. Note any error or warning.
3. Watch it with captions on, on the web player (and, if you can, the mobile app and a TV app,
   which render captions separately). Compare each caption with what it says you should see.
4. In Studio, download the captions back (as `.vtt` and `.srv3` if offered) and keep them: they
   show what YouTube stored.
5. Repeat with `youtube-test-no-blocks.vtt` if the first file was rejected or lost captions.

Record each feature as **kept** (shown as described), **changed** (shown, but not as described:
say how), or **dropped** (the feature, or the whole caption, is lost).

## Results

**2026-10-07**, `youtube-test.vtt`, the YouTube web player and the YouTube mobile app.
`YOUTUBE` in `features.ts` follows the web column; the export fixes for YouTube only aim at
what YouTube Studio reports as errors on upload (see the decisions log in PLAN.md).

On upload, YouTube Studio reported errors on four lines and offered to import anyway:

| Line | What is there                                                  | Meaning                                                       |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| 3    | the `REGION` block                                             | REGION blocks are not supported (STYLE is accepted)           |
| 88   | `line:0 position:90%,line-right size:40%`                      | the `,line-right` alignment suffix                            |
| 98   | `region:test`                                                  | the region setting                                            |
| 126  | `…and below it, in the same cue.`, after a line of only spaces | the cue ended at the space-only line; this line was left over |

Studio's own caption editor then warned that it would discard some formatting if the captions
were saved from it, so edit captions in MicroVTT and upload them again rather than editing in
Studio.

The second file (`youtube-test-no-blocks.vtt`) was not needed: everything else imported.

| #   | Time | Feature                 | What to check                                                 | Web     | Mobile  | Notes                                                                    |
| --- | ---- | ----------------------- | ------------------------------------------------------------- | ------- | ------- | ------------------------------------------------------------------------ |
| 1   | 0:06 | `italic-bold-underline` | italic, bold and underlined words                             | kept    | changed | mobile: only italic is formatted                                         |
| 2   | 0:12 | `class`                 | text shown (no colour expected: it comes from a player style) | kept    | kept    |                                                                          |
| 3   | 0:18 | `voice`                 | text shown, no "Alice" tag visible                            | kept    | kept    |                                                                          |
| 4   | 0:24 | `language`              | text shown, no tags visible                                   | kept    | kept    |                                                                          |
| 5   | 0:30 | `ruby`                  | "kanji" small above 漢字                                      | changed | changed | "kanji" shown in brackets right after "漢字", as 漢字(kanji)             |
| 6   | 0:36 | `timestamps`            | words appear one by one (or all at once: say which)           | kept    | kept    | one by one                                                               |
| 7   | 0:42 | `character-references`  | café, ©, and no `&` codes visible                             | kept    | kept    |                                                                          |
| 8   | 0:48 | `multiple-lines`        | three lines                                                   | kept    | kept    |                                                                          |
| 9   | 0:54 | `cue-id`                | "intro" not shown                                             | kept    | kept    |                                                                          |
| 10  | 1:00 | `line`                  | at the top                                                    | kept    | kept    |                                                                          |
| 11  | 1:06 | `line-percent`          | in the middle, top to bottom                                  | kept    | kept    |                                                                          |
| 12  | 1:12 | `position`              | near the left edge                                            | kept    | changed | mobile: position ignored                                                 |
| 13  | 1:18 | `size`                  | wrapped in a narrow box                                       | dropped | dropped | not wrapped                                                              |
| 14  | 1:24 | `align`                 | lines right-aligned                                           | kept    | changed | mobile: alignment ignored                                                |
| 15  | 1:30 | `alignment-suffix`      | at the top, box ending at 90% across                          | kept    | kept    | upload error on its timing line (line 88), but shown as described        |
| 16  | 1:36 | `vertical`              | vertical text on the right                                    | dropped | dropped | horizontal, default position and alignment                               |
| 17  | 1:42 | `region`                | in a box at the lower left                                    | dropped | dropped | default position and alignment; upload errors (lines 3 and 98)           |
| 18  | 1:48 | `style`                 | "green" in green                                              | dropped | dropped | no colour change                                                         |
| 19  | 1:54 | `note`                  | the comment never shown                                       | kept    | kept    |                                                                          |
| 20  | 2:00 | `overlap`               | both captions on screen together, the second from 2:01        | kept    | kept    |                                                                          |
| 21  | 2:06 | `whitespace-line`       | an empty-looking line between two lines, all in one caption   | dropped | dropped | only "Above an empty-looking line…" shown; upload error on the next line |

The mobile app also ignores bold, underline, `position` and `align`. A space-only line loses
the rest of the cue on both. Studio reports the line after it as an error while reading the
file, which points to the cue being cut when the file is parsed rather than the second line
being pushed off screen when it is drawn. To confirm: Studio's caption editor, or the
captions downloaded back from Studio, should show caption 21 with only its first line.

Not yet checked: TV apps.
