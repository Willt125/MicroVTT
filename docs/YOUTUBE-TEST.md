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

Not yet run. Date, player(s) and file used:

| #   | Time | Feature                 | What to check                                                 | Web | Notes |
| --- | ---- | ----------------------- | ------------------------------------------------------------- | --- | ----- |
| 1   | 0:06 | `italic-bold-underline` | italic, bold and underlined words                             |     |       |
| 2   | 0:12 | `class`                 | text shown (no colour expected: it comes from a player style) |     |       |
| 3   | 0:18 | `voice`                 | text shown, no "Alice" tag visible                            |     |       |
| 4   | 0:24 | `language`              | text shown, no tags visible                                   |     |       |
| 5   | 0:30 | `ruby`                  | "kanji" small above 漢字                                      |     |       |
| 6   | 0:36 | `timestamps`            | words appear one by one (or all at once: say which)           |     |       |
| 7   | 0:42 | `character-references`  | café, ©, and no `&` codes visible                             |     |       |
| 8   | 0:48 | `multiple-lines`        | three lines                                                   |     |       |
| 9   | 0:54 | `cue-id`                | "intro" not shown                                             |     |       |
| 10  | 1:00 | `line`                  | at the top                                                    |     |       |
| 11  | 1:06 | `line-percent`          | in the middle, top to bottom                                  |     |       |
| 12  | 1:12 | `position`              | near the left edge                                            |     |       |
| 13  | 1:18 | `size`                  | wrapped in a narrow box                                       |     |       |
| 14  | 1:24 | `align`                 | lines right-aligned                                           |     |       |
| 15  | 1:30 | `alignment-suffix`      | at the top, box ending at 90% across                          |     |       |
| 16  | 1:36 | `vertical`              | vertical text on the right                                    |     |       |
| 17  | 1:42 | `region`                | in a box at the lower left                                    |     |       |
| 18  | 1:48 | `style`                 | "green" in green                                              |     |       |
| 19  | 1:54 | `note`                  | the comment never shown                                       |     |       |
| 20  | 2:00 | `overlap`               | both captions on screen together, the second from 2:01        |     |       |
| 21  | 2:06 | `whitespace-line`       | an empty-looking line between two lines, all in one caption   |     |       |
