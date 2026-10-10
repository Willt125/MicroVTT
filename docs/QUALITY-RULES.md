# Style and accessibility rules

MicroVTT checks cues against subtitle style guides and accessibility guidance as well as
against the WebVTT format. The two are kept apart:

- **Problems** (`packages/core/src/diagnostics.ts`) are about the format. Errors are fixed on export.
- **Style and accessibility** findings (`packages/core/src/quality/`) are about how captions read.
  - They never block export.
  - They are listed in their own panel, grouped by rule.
  - They come from one ruleset at a time, chosen in that panel.

Until auto-captions are cleaned up, the checks wait, because almost every rolling auto-caption
cue fails them. "Check anyway" runs them regardless.

## How things are measured

- **Characters** are graphemes of the text a viewer reads:
  - markup is removed and character references are decoded;
  - ruby annotations (`<rt>`) are left out;
  - combining marks and emoji count once.
- **Characters per second** counts spaces and punctuation but not line breaks. The guides don't say
  how they count. Netflix's reading-speed figures are generally understood to include spaces, but
  the guide supplied doesn't state it.
- **Words** are runs of non-space text that contain a letter or a digit. In scripts written
  without spaces (Chinese, Japanese, Thai, Lao, Khmer, Myanmar) they are the words
  `Intl.Segmenter` finds.
- **Line breaks** that fixes make (Rewrap) fall at spaces, and inside unspaced scripts at the
  word boundaries `Intl.Segmenter` finds. Punctuation stays with its word, opening brackets
  with the word after, and Japanese hiragana endings with the word before. **Joining lines**
  (One line when it fits) adds a space except between Chinese or Japanese text; Thai, Khmer
  and Myanmar separate phrases with spaces, so a line break there stands for one.
- **The next cue** is the next one in the file. A file out of start order is a format error in any
  case.

## Rules

| Rule                       | Category      | Checks                                                                                                                        | Fix                                              |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `empty-cue`                | text          | a cue with no text to read                                                                                                    | delete                                           |
| `min-duration`             | timing        | duration under the minimum                                                                                                    | lengthen, when the next cue leaves room          |
| `max-duration`             | timing        | duration over the maximum                                                                                                     | none                                             |
| `min-gap`                  | timing        | a gap between cues that is more than 0 and less than the minimum                                                              | close the gap                                    |
| `frame-gaps`               | timing        | a gap other than exactly the minimum frames (2) that is under half a second, at the video's frame rate (24 fps without media) | leave exactly the minimum frames                 |
| `overlap`                  | timing        | a cue still showing when the next starts                                                                                      | end where the next starts                        |
| `chars-per-second`         | reading speed | characters per second over the maximum                                                                                        | none                                             |
| `words-per-minute`         | reading speed | words per minute over the maximum                                                                                             | none                                             |
| `max-lines`                | layout        | more lines than the maximum                                                                                                   | none                                             |
| `line-length`              | layout        | a line longer than the maximum                                                                                                | rewrap (plain text only, into at most two lines) |
| `line-shape`               | layout        | two lines where the top is longer, or holds only one or two words                                                             | rewrap (plain text only)                         |
| `single-line`              | layout        | two lines that would fit on one (dual-speaker cues aside)                                                                     | join (plain text only)                           |
| `line-break-words`         | layout        | a line ending in an article or preposition (English)                                                                          | none                                             |
| `centred`                  | layout        | a cue not centred (`align` other than center, or a position set)                                                              | centre                                           |
| `ellipsis-character`       | text          | three dots instead of `…`                                                                                                     | use `…`                                          |
| `double-space`             | text          | two spaces in a row                                                                                                           | single spaces                                    |
| `dash-characters`          | text          | an en or em dash                                                                                                              | none                                             |
| `speaker-hyphen`           | text          | a line starting with a hyphen and a space                                                                                     | remove the space                                 |
| `okay-spelling`            | text          | "OK" or "Ok"                                                                                                                  | "okay" ("Okay" at a sentence start)              |
| `lowercase-labels`         | text          | a bracketed label written in capitals                                                                                         | none (proper nouns may stay capitalised)         |
| `lyrics-notes`             | text          | lyrics not enclosed in `♪ … ♪`                                                                                                | none                                             |
| `glyph-list`               | text          | characters not in the Netflix Glyph List (version 2), e.g. emoji, or direction marks                                          | none                                             |
| `dual-speaker-second-line` | text          | a two-speaker cue with a hyphen on both lines (Finnish: second line only)                                                     | remove the first hyphen                          |
| `continuation-hyphen`      | text          | a cue ending with no punctuation before another cue (Finnish: end with " -")                                                  | add " -"                                         |
| `space-before-punctuation` | text          | a space before . , ! ? : ; or …                                                                                               | remove the space                                 |
| `finnish-numbers`          | text          | 10,000, 7:45 and 1.5 (Finnish: 10 000, 7.45, 1,5)                                                                             | Finnish formats                                  |
| `acronym-periods`          | text          | acronyms with full stops (U.S.A.); initials before a name are left alone                                                      | remove the full stops                            |
| `finnish-abbreviations`    | text          | common abbreviations without their full stop (esim., jne., vrt. …), or "klo."                                                 | fix                                              |
| `agency-names`             | text          | Finnish state body names in capitals that Kotus writes otherwise (KELA:n → Kelan)                                             | official form                                    |
| `bbc-characters`           | text          | characters outside the BBC's list (§9.3)                                                                                      | straight quotes and three dots                   |
| `bbc-colours`              | accessibility | `::cue` colours other than the BBC's four, or a coloured background                                                           | none                                             |
| `contrast`                 | accessibility | `::cue` text and background contrast, at worst over a black or white picture                                                  | none                                             |

Fixes are offered only where the right change is clear. Each fix is one undo step, and "Fix all"
applies one rule's fixes together.

## Rulesets

The guides were read from copies supplied on 2026-10-10. Each threshold is cited in
`packages/core/src/quality/rulesets.ts`, and a test pins the numbers.

### Basic checks (default)

These are MicroVTT's own, loose enough that ordinary captions (YouTube's included) pass:

| Check                 | Setting     | Severity |
| --------------------- | ----------- | -------- |
| Empty cues            |             | warning  |
| Minimum duration      | 0.5 s       | warning  |
| Maximum duration      | 10 s        | note     |
| Characters per second | 25          | warning  |
| Line length           | 50          | note     |
| Lines                 | 3           | note     |
| Overlaps              |             | note     |
| Gaps between cues     | under 80 ms | note     |

### Netflix English (USA), and the children's variant

Sources:

- [Timed Text Style Guide: General Requirements](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617), revision of 2022-10-07.
- [English (USA) Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977), 2025-12-19.
- Timed Text Style Guide: Subtitle Timing Guidelines, revision of 2025-07-04.
- Netflix Glyph List, version 2 (NGL2), supplied as a spreadsheet export.

| Rule                            | Setting                              | Section              |
| ------------------------------- | ------------------------------------ | -------------------- |
| Duration                        | 5/6 s to 7 s                         | General 1            |
| Frame gaps                      | exactly 2 frames, or at least 0.5 s  | Timing 5             |
| Lines                           | 2                                    | General 4            |
| Line length                     | 42                                   | English I.2 / II.3   |
| Reading speed                   | 20 characters/s adult, 17 children's | English I.14 / II.17 |
| Line shape (bottom-heavy)       |                                      | English I.10 / II.13 |
| One line when it fits           |                                      | English I.10 / II.13 |
| Line breaks                     |                                      | General 4            |
| Centred                         |                                      | General 5            |
| Ellipsis character              |                                      | English I.3 / II.5   |
| Double spaces, en and em dashes |                                      | English I.12 / II.15 |
| Speaker hyphens                 |                                      | English I.6 / II.8   |
| Glyph list (version 2)          |                                      | General 3            |
| "Okay"                          |                                      | English I.17 / II.21 |
| Lowercase labels (SDH)          |                                      | English I.16         |
| Lyrics notes (SDH)              |                                      | English I.15         |

Not checked:

- Timing to the audio and to shot changes (timing guidelines 1, 2 and 4). These need the audio and
  the picture.
- Anything that needs judgement or the audio.

Frame gaps are counted at the video's frame rate when media is open (measured, or chosen in the
media panel), and at 24 fps otherwise, the rate the timing guidelines are written for. Changing
the frame rate in the Rules dialog overrides both.

The timing guidelines put the minimum duration at "20 frames (or 4/5 sec)". The General
Requirements and the templates guide say 5/6 s ("20 frames for 24fps; 25 frames for 29.97fps"),
which is what is checked: 20 frames is 5/6 s at 24 fps, and 4/5 s only at 25 fps.

### Netflix English template, and the children's variant

Templates are the edited, timed English master files that translations are made from. Sources:
Timed Text Style Guide: Subtitle Templates (copy supplied 2026-10-10), with the timing guidelines
and the English (USA) guide.

| Rule                           | Setting                              | Section                          |
| ------------------------------ | ------------------------------------ | -------------------------------- |
| Duration                       | 5/6 s to 7 s                         | Templates 12                     |
| Frame gaps                     | exactly 2 frames, or at least 0.5 s  | Timing 5                         |
| Lines, line length             | 2 lines of 42                        | Templates 17, 5                  |
| One line when it fits          | (a warning: "always" one line)       | Templates 17                     |
| Reading speed                  | 17 characters/s adult, 15 children's | Templates 23 (English templates) |
| Line shape, line breaks        |                                      | Templates 17                     |
| Centred                        |                                      | Templates 21                     |
| Double spaces, speaker hyphens |                                      | Templates 22, 11                 |
| Ellipsis character, dashes     |                                      | English II.5, II.15              |
| Glyph list (version 2)         |                                      | Templates 16                     |

Not checked: coverage, annotations, forced narratives and segmentation (judgement), and timing to
the audio and to shot changes.

The glyph list is built into `packages/core/src/quality/netflix-glyphs.generated.ts` as code-point
ranges (38,645 code points). To update it, export the spreadsheet's source sheet as CSV and run
`pnpm gen:glyphs path/to/file.csv`; the CSV itself is not committed. The list has no emoji, no
zero-width joiner and no left-to-right or right-to-left marks, so those are reported.

### Netflix Finnish, and children's, SDH and SDH children's variants

Sources: Netflix Finnish Timed Text Style Guide (2025-12-19), with the General Requirements,
timing guidelines and glyph list; and the two Kotus lists the guide refers to for
abbreviations (_Lyhenneluettelo_; _Valtionhallinnon nimet ja niiden lyhenteet_), supplied
2026-10-10.

| Rule                                      | Setting                                    | Section                        |
| ----------------------------------------- | ------------------------------------------ | ------------------------------ |
| Duration, frame gaps, glyph list, centred |                                            | General 1, 3, 5; Timing 5      |
| Lines, line length                        | 2 lines of 42                              | Finnish 11, 2                  |
| Reading speed                             | 17 / 13 children's; SDH 20 / 17 children's | Finnish 15, 20                 |
| Line shape (bottom-heavy)                 |                                            | Finnish 11                     |
| Ellipsis character, continuation hyphen   |                                            | Finnish 4                      |
| Speaker hyphens (second line only)        |                                            | Finnish 6                      |
| Number formats                            |                                            | Finnish 12                     |
| Acronyms without full stops               |                                            | Finnish 1                      |
| Abbreviations, state body names           |                                            | Kotus (Finnish 1)              |
| Space before punctuation                  |                                            | Finnish 13 (Kotus conventions) |
| Lowercase labels, lyrics notes (SDH only) |                                            | Finnish 20                     |

Not checked: condensing and merging (the guide asks for a condensed style), italics, quotes,
spelled-out numbers, and timing to the audio and to shot changes. The guide allows two lines
even when the text would fit on one, so the one-line rule is not used.

Of the Kotus lists, only what can be checked without false alarms is used:

- **Missing full stops:** 16 abbreviations common in dialogue that Kotus writes only with a full
  stop, and whose form without it is neither another abbreviation nor a word: esim., jne., yms.,
  tms., jms., vrt., ks., ym., ts., pvm., ko., em., nk., huom., eKr., jKr. Left out: "ns.",
  "mm.", "ml." and "n.", which are units without the stop. Also flagged: "klo" written with one.
- **State body names:** the 26 short names with a single official mixed-case form (Kela, Syke,
  Traficom …). They are flagged in capitals, with any case ending (KELA:n → Kelan), but not in
  all-capital cues (forced narratives).

Run on three real YouTube auto-caption files machine-translated into Finnish (after cleanup),
these Finnish-specific rules raised no false alarms. Space before punctuation and the
continuation hyphen caught real problems.

### BBC

Source: [BBC Subtitle Guidelines](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/), March 2026.

| Rule                 | Setting               | Section                                                     |
| -------------------- | --------------------- | ----------------------------------------------------------- |
| Line length          | 37                    | 3.1 (broadcast; online is limited by width, about the same) |
| Lines                | 2 (landscape)         | 3.3                                                         |
| Reading speed        | 180 words/min         | 4 (160–180 recommended)                                     |
| Gaps                 | none, or at least 1 s | 4.5                                                         |
| Line breaks          |                       | 3.4                                                         |
| Permitted characters |                       | 9.3                                                         |
| Speaker colours      |                       | 8                                                           |

Not checked:

- Synchronisation, shot changes and editing (these need the audio and picture).
- Speaker identification, sound labels and song marks (judgement).
- Online line length by width.

### WCAG 2.2

Source: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), W3C Recommendation of 12 December 2024.

| Rule     | Setting                        | Success criterion        |
| -------- | ------------------------------ | ------------------------ |
| Contrast | 4.5:1 (set 7:1 for 1.4.6, AAA) | 1.4.3 Contrast (Minimum) |

WCAG sets almost nothing measurable for captions, so this ruleset is deliberately small, and
passing it does not make captions accessible. 1.2.2 and 1.2.4 (captions exist for all the audio)
need the media, and 2.3.1 (flashing) is a property of the video. 3.1.2 (language of parts) is
already covered by the format checks on `<lang>`.

### Where guides disagree

- **Ellipses:** Netflix wants `…`, and the BBC's character list has only `.` (three dots).
- **Labels:** Netflix writes labels in lowercase brackets. The BBC writes sound effects in capitals
  without brackets.
- **Gaps:** the BBC asks for no gap or at least a second. Netflix asks for exactly 2 frames, or at
  least half a second.

Only one ruleset is active at a time, so these never conflict in use.

## Adding a ruleset

1. Read the guide, and note its edition or revision date.
2. In `packages/core/src/quality/rulesets.ts`:
   - add a `GuideSource`;
   - add a `Ruleset` that picks rules from `rules.ts`, with settings and the section each comes
     from, plus a `notChecked` list, and the `language` it is for, if one;
   - add it to `RULESETS`.
3. If the guide needs a check no rule covers, add a rule to `rules.ts`. Each rule is a function
   over one cue (or over the document), and its settings are numbers.
4. Add the guide's numbers to the "match the guides' numbers" test in
   `packages/core/test/quality.test.ts`, and a table here.

Users can switch rules off and change settings per ruleset (the Rules… dialog). Their changes
are kept in the browser and can be reset to the guide's values.

When the text's language (from the file, or set by the user) differs from the chosen ruleset's
`language`, the panel says so and offers a ruleset for the text's language if there is one. It
never switches by itself, and rulesets for any language (the basic checks, WCAG) never prompt.
