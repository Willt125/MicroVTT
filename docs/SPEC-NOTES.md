# WebVTT specification notes

A working digest of the normative requirements MicroVTT has to meet, organized by the module
that implements them. This is a map into the spec, not a substitute for it: when implementing,
read the linked section of the pinned revision.

## Sources of truth

| Source                                                         | Revision pinned                                                                    | Use                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| WebVTT Editor's Draft, `w3c/webvtt` `index.bs`                 | `0648025` (2026-05-20, "Updated spec for TTWG publication")                        | Normative. `scripts/sync-spec.sh` checks it out into `.spec/`.                                              |
| W3C Candidate Recommendation, <https://www.w3.org/TR/webvtt1/> | Matches the ED above at time of pinning                                            | Citation target for user-facing docs.                                                                       |
| web-platform-tests `webvtt/`                                   | See `tests/wpt/SOURCE.txt`                                                         | Conformance tests for the parser and the VTTCue/VTTRegion API semantics. Vendored by `scripts/sync-wpt.sh`. |
| WPT `webvtt/parsing/file-parsing/tools/parser.py`              | Same as above, vendored as `tests/wpt/file-parsing/reference-parser.py`            | A Python port of the parser algorithm. Useful for differential testing.                                     |
| HTML Standard: named character references                      | Taken from the `entities` npm package, then checked against WHATWG `entities.json` | Cue text `&name;` decoding (about 2,200 entries).                                                           |
| BCP 47 / IANA Language Subtag Registry                         | Snapshot to be bundled                                                             | Validating `<lang>` annotations (an authoring requirement only).                                            |
| MDN browser-compat-data                                        | 8.1.4                                                                              | Browser support matrix below.                                                                               |

When a spec revision lands, re-run `pnpm sync:spec`, diff `index.bs` against the pinned hash,
update this file, and re-run `pnpm sync:wpt`.

## Conformance classes MicroVTT claims (spec §2.1)

MicroVTT belongs to three of the spec's conformance classes at the same time. Each one has its
own requirements:

1. **Authoring tool.** It "must generate conforming WebVTT files". When editing a
   non-conforming file it _may_ round-trip errors in sections that were not edited, but it
   "must not claim that the output is conformant if errors have been so preserved".
   → MicroVTT does not use the round-trip allowance: **every export conforms.** Non-conforming
   input is fixed on export and the fixes are listed (see "Repair" below).
   Converters from other formats (SRT, etc.) also count as authoring tools.
2. **Conformance checker.** It "must verify that a WebVTT file conforms to the applicable
   conformance criteria". → The validator checks the _syntax_ rules (§4), which are stricter
   than the parsing rules (§6). Example from the spec: two cues with no blank line between
   them parse fine but must be flagged.
3. **User agent with scripting and a full CSS engine**, for the preview only. All processing
   requirements apply, and the CSS applied to cues has to be limited to the properties the
   spec allows (§7.4 and the `::cue` property list).

**One deliberate divergence, on import only:** cue setting values written with an older draft's
names (`align:middle`, `line:…,middle`, `position:…,start|middle|end`) are read as they were
meant, where the spec's parser ignores the whole setting. YouTube still writes
`position:X%,middle` in its own WebVTT, and editing YouTube captions is MicroVTT's main use, so
dropping those positions would lose what the file says. The validator reports each one
(`cue-setting-legacy`), and export writes the current name, so output still conforms. The parser
itself stays exactly the spec's algorithm unless asked (`parse(text, { legacyValues: true })`;
`importDocument` asks), so the WPT and browser comparisons are unaffected.

Also: **implementations must not normalize Unicode** (§2.2). Never call `String.prototype.normalize`
on cue text, IDs, or selectors.

## Module → spec section map

### Decoding and input (`core/decode`)

- §6.1: decode with the **UTF-8 decode** algorithm (which strips a leading BOM and replaces
  invalid sequences with U+FFFD). WebVTT has no other encodings. → Use
  `TextDecoder('utf-8')` / `TextDecoderStream` with `fatal: false` and the default
  `ignoreBOM: false`.
- Before parsing, replace NUL → U+FFFD, then CRLF → LF, then any remaining CR → LF. The
  source map records offsets in the original text, so diagnostics point at the right place.
- The spec's parser is incremental. Our parser should be too, so it can run on a stream.
- _Converter imports (SRT, later SCC) may need encoding detection_ (Windows-1252 and so on). That
  is outside the WebVTT spec and must never apply to `.vtt` input.

### File parser (`core/parse`), spec §6.1 "WebVTT file parsing"

- Signature: the input must be ≥ 6 chars and start with `WEBVTT`. If it is longer, the 7th char must be
  SPACE, TAB or LF; otherwise parsing **fails** (the file is rejected).
- The rest of the first line is ignored. The block immediately after it, if any, is collected with
  the _in header_ flag (legacy header metadata).
- Block collection ("collect a WebVTT block"): a line containing `-->` begins a cue's
  timings, even when it is the first line of the block, in which case there is no identifier.
  `STYLE` and `REGION` blocks are recognized **only before the first cue**
  (`seen cue` flag). After that point they parse as text or are dropped.
- Cue timings and settings: §6.3. Timestamp algorithm: §6.3 "collect a WebVTT timestamp"
  (implemented in `packages/core/src/timestamp.ts`). Unknown settings and settings with
  invalid values are ignored by the parser and **flagged by the validator**.
- Region settings: §6.2. A later region with the same id replaces the earlier one.
- Cue text: §6.4 "cue text parsing rules" is an HTML-tokenizer-style state machine that
  produces a node tree (class, italic, bold, underline, ruby/rt, voice, language, timestamp,
  text). Character references follow HTML's named, decimal and hex rules.
- Chapter titles: §6.6 "rules for extracting the chapter title".

### Syntax validator (`core/validate`), spec §4

Everything the parser tolerates but the syntax forbids is a diagnostic. Each diagnostic carries
a stable code, a severity, a source range, and a link to the spec anchor. Non-exhaustive list:

- `-->` substring in a cue ID, payload, NOTE, STYLE or region setting.
- Missing blank line between blocks. Junk lines.
- Cue start times not non-decreasing (§4.1: "must be greater than or equal to the start time
  offsets of all previous cues"). End time not greater than start time.
- Timestamp shape: hours must be present if non-zero, minutes and seconds two digits ≤ 59,
  exactly three fraction digits.
- Duplicate cue IDs. Duplicate region IDs. A region without `id`. A cue that references an undefined region.
- Duplicate cue settings. Unknown setting names. Invalid values. Percentages outside 0..100.
- Region settings: `width`, `lines`, `regionanchor`, `viewportanchor`, `scroll:up`, `id`.
- Cue text: unbalanced or misnested spans, a `<v>` end tag omitted when the voice span is not the
  only component, annotations on tags that disallow them, `<lang>` with an invalid BCP 47 tag,
  cue timestamps not strictly increasing or outside the cue's [start, end] interval, ruby structure.
- File-type rules (§4.6): files of _only metadata_, _only chapter titles_, or _only caption
  text_. Chapter files must also have no overlapping cues; this is the "nested cues" property in
  §4.5. The validator should infer or let the user choose the file type and check accordingly.
- STYLE blocks: the content is CSS and "the requirements given in the relevant CSS specifications
  apply". We can check that it parses as CSS and that `::cue`/`::cue-region` rules only use the
  properties allowed by §8.

### Data model (`core/model`), spec §3

- Cue properties: id, start, end, pause-on-exit, region, writing direction (horizontal / `rl` /
  `lr`), snap-to-lines, line (number, percentage, or `auto`), line alignment, position (or `auto`),
  position alignment (or `auto`), size, text alignment (`start|center|end|left|right`), text.
- Region properties: id, width, lines, region anchor x/y, viewport anchor x/y, scroll.
- Cue kinds by payload: caption/subtitle text, chapter title text, metadata text.
- Pause-on-exit is not part of the syntax (it is always false for parsed cues), so the model
  omits it.
- Values follow the `VTTCue`/`VTTRegion` IDL (§9) so the model can be mirrored into native
  objects. `updateCue` applies the attribute rules: unknown enum strings are ignored,
  `position`/`size` outside 0..100 throw `IndexSizeError`, and `line` may be any finite number.
  The API can express states the syntax cannot; `repair` converts those (see below).

### Serializer (`core/serialize`)

Not specified by the spec beyond "must generate conforming files". Our rules:

- Strict mode: always output `WEBVTT`, a blank line, STYLE and REGION blocks, then cues sorted by
  start time, with LF terminators by default and settings in canonical order. Escape `&`, `<`, `>` in
  text spans and annotations. Never emit `-->` inside payloads (escape the `>` as `&gt;`).
  Optional hours in timestamps.
- Property tests: `parse(serialize(doc))` is equivalent to `doc` for any doc.

### Repair (`core/repair`): export-time fixes

Most conformance comes free from serializing the model, because the parser only stores valid
values: invalid or duplicate settings are already gone, timestamps are re-formatted, and
settings are written in canonical form. The rest is fixed by `repair`, which reports every
change with the validator's diagnostic code. The full list of rules and fixes is generated into
`docs/DIAGNOSTICS.md`. The judgment calls:

- **End not after start:** end = start + 1 ms.
- **Ignored text** (header lines, stray blocks, STYLE/REGION after the first cue, cues with broken
  timings) is kept as a NOTE comment, never dropped and never moved into effect.
- **Values the syntax cannot express:**
  - `line` auto, or outside 0..100, with `snapToLines` false renders as 100% (the cue
    computed line rule, §3), so it is written as `line:100%`.
  - A fractional line number is rounded.
  - A line or position alignment without a line or position is dropped.
- **Cue text with errors** is rebuilt from the tree parsers build, so what viewers see is kept:
  - out-of-order or out-of-range timestamp tags are dropped;
  - invalid `<lang>` spans and `<v>` spans without a voice are unwrapped;
  - a ruby span without `<rt>` is unwrapped;
  - text after the last `<rt>` moves out of the ruby span.
- **Chapters** (when the file type is chapters): an overlapping chapter is shortened to end where
  the next one starts.
- **Strings** are normalized the way parsers read them (NUL → U+FFFD, CR → LF) before anything else.

Import also reports what the parser discards (junk lines, invalid settings, late STYLE/REGION
blocks), because by export it no longer exists in parser terms.

### Renderer (`web/render`), spec §7 "Rendering" and §8 "CSS extensions"

- §7.1 processing model, §7.2 processing cue settings (line/position computation,
  snap-to-lines collision avoidance), §7.3 obtaining CSS boxes, §7.4 applying CSS properties.
- `::cue`, `::cue(selector)`, `::cue-region`, `:past`, `:future`, and the default color classes
  (`.white .lime .cyan .red .yellow .magenta .blue .black` and `.bg_*`, §5).
- Region scroll-up roll-up behavior (§4.3 notes and §7).

### MIME (`text/vtt`), spec §10

The file extension is `.vtt`, the MIME type is `text/vtt`, and the charset is always UTF-8. Exports must use these.

## Auto-caption input (YouTube), as it meets the spec

Measured from ten real `yt-dlp` downloads: seven `.auto.en-orig.vtt` (5m48s to 4h18m29s) and
three `.auto.fi.vtt` machine translations. They are kept locally in `tests/private-fixtures/`
(see the README there) and not committed. Synthetic fixtures with invented text reproduce the
structure: `packages/core/test/fixtures/autocaption-sample.vtt` (`en-orig` style) and
`autocaption-translated-sample.vtt` (`fi` style).

**Layout.** UTF-8 with no BOM, LF line endings, no cue IDs, and every cue has the settings
`align:start position:0%`. Each caption line goes through two cues:

```
00:00:04.080 --> 00:00:06.630 align:start position:0%     ← "growing" cue (about 1–3 s)
<previous line, plain text, or a single space>
and<00:00:04.400><c> just</c><00:00:04.640><c> one</c>…     ← new line with per-word timing

00:00:06.630 --> 00:00:06.640 align:start position:0%     ← 10 ms hand-off cue
and just one prompt is all it took.                        ← the completed line, plain text
<a single space>
```

The cues are back-to-back: each one ends exactly where the next starts, and **none overlap**.
The rolling effect comes from repeating the text, not from overlapping times. Payload lines made
of a single U+0020 space are common (a blank top or bottom line).

**How each feature meets the spec:**

- **Header lines** `Kind: captions` / `Language: en` come directly after `WEBVTT`. The parser
  accepts and discards them (the block after the signature is collected with the _in header_ flag,
  §6.1). They are **not conforming syntax**: §4.1 requires two or more line terminators after
  the signature line. Export moves those lines into a `NOTE` block.
- **Cue settings** `align:start position:0%` are valid (§4.4).
- **Word timing** `<hh:mm:ss.mmm><c> word</c>` uses cue timestamps and class spans with no class
  names, which is valid. The first word of each line has no timestamp (it starts at the cue start).
  §4.2 requires each cue timestamp to be strictly greater than the previous one and than the cue
  start, and less than the cue end. **Real files break this rarely:** the 4h18m sample has 2
  violations in about 38k timed words (one duplicate timestamp, one 10 ms past the cue end). The
  validator must report them, and the cleanup step clamps them.
- **Escaping.** `&gt;&gt;` (the `>>` speaker-change marker; 2,312 times in the 48 min sample) and
  `&amp;` appear correctly escaped. Non-ASCII text occurs (`°`). No sample contains `-->` in a payload.
- **Sound tags** `[Music]`, `[Applause]`, `[music]`, `[laughter]`, … are plain text. Their case
  differs between videos.
- **Timing.** Start times are non-decreasing and every end is after its start. Hours are always
  written.

**Variations between samples:**

|                      | `en-orig` (speech recognition)                           | `fi` (machine translation)                                                                                                                                       |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Word span spacing    | Leading: `<c> word</c>`                                  | Trailing: `<c>word </c>`                                                                                                                                         |
| Word timestamps      | From the audio. Only 7–15% of consecutive gaps are equal | **Interpolated**: 100% of consecutive gaps within a line are equal                                                                                               |
| Censored word        | `[&nbsp;__&nbsp;]` (an HTML character reference, valid)  | `[ __ ]`                                                                                                                                                         |
| Sound tags           | `[music]`, `[laughter]`, or `[Music]` in older videos    | Translated: `[musiikki]`, `[naurua]`                                                                                                                             |
| Odd whitespace       | none                                                     | Double spaces after sentences. Pairs of U+200B ZERO WIDTH SPACE. Occasionally 3 line feeds after a cue (an empty second payload line, which simply ends the cue) |
| Timestamp violations | 2 in about 38k words (4h18m sample)                      | none seen                                                                                                                                                        |

None of these variations is a conformance problem by itself. Extra blank lines between blocks are
allowed (§4.1), and U+200B is just text. The spec forbids Unicode normalization (§2.2), so any
whitespace cleanup is an editorial choice the user makes, never a parse-time or repair-time change.

The cleanup ("de-roll") step should take the timed line from each growing cue (it gives word
timings) and ignore the repeated line and the hand-off cues. About 1–6% of growing cues have no
word timings (sound tags, short lines). Those lines get their timing from the cue itself. For
translated tracks, the word timings are only an estimate and must not be presented as accurate.

**Found while building the cleanup** (all ten samples):

- **Screen clears.** After an untimed line, YouTube sometimes clears the screen: the hand-off
  cue is blank (`" \n "`) and the next growing cue's first line is blank. That line is then
  shown by no other cue, so the growing cues are the only complete source of the text.
- **Hand-off cues are copies.** Every hand-off cue's line appears, in order, among the growing
  cues' new lines (9,000+ lines checked). One growing cue's repeated first line differs from the
  line it repeats (`"the Navy? With"` re-shown as `"the Navy with"`): YouTube re-punctuates
  occasionally. The timed new line is the one used.
- **Untimed lines** are single words in every sample (`"end?"`, `"[music]"`): the first word of a
  line never has a timestamp, so a one-word line has none.
- **Machine translations** sometimes put a space before final punctuation (`"En tiedä ."`).
  Cleanup never starts a cue or a line with such punctuation.

## Browser support relevant to us (MDN BCD 8.1.4)

| Feature                                                  | Chrome   | Firefox  | Safari   | Consequence                                                                                                            |
| -------------------------------------------------------- | -------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `VTTCue`                                                 | 23       | 31       | 6        | Native track preview works everywhere.                                                                                 |
| `VTTCue.lineAlign`, `positionAlign`                      | **no**   | 31       | 14.1     | Chrome ignores them, so native preview is wrong in Chrome.                                                             |
| `VTTRegion` / `VTTCue.region`                            | **no**   | 59       | 7 / 14.1 | No regions in Chrome's native rendering.                                                                               |
| `::cue`                                                  | 26       | 55       | 7        |                                                                                                                        |
| `:past` / `:future`                                      | 23       | **no**   | 7        | Karaoke-style timestamps are not styled in Firefox.                                                                    |
| `TextDecoderStream`, `Blob.stream()`                     | 71 / 76  | 105 / 69 | 14.1     | Streaming import works everywhere.                                                                                     |
| OPFS (`StorageManager.getDirectory`, sync access handle) | 86 / 102 | 111      | 15.2     | Autosave and the waveform-peak cache work everywhere.                                                                  |
| `showOpenFilePicker` / `showSaveFilePicker`              | 86       | **no**   | **no**   | In-place "Save" in Chromium only. Elsewhere, fall back to `<input type=file>` and download.                            |
| WebCodecs `AudioDecoder`                                 | 94       | 130      | **26**   | Streamed waveform peaks for long media. Decided by feature detection, not browser version (see PLAN.md decisions log). |
| `requestVideoFrameCallback`                              | 83       | 132      | 15.4     | Frame-accurate playhead sync.                                                                                          |
| `launchQueue` (PWA file handling)                        | 102      | no       | no       | "Open with MicroVTT" for the installed PWA works in Chromium only.                                                     |

**Conclusion:** native `<track>` rendering is not spec-faithful in any single browser, so MicroVTT
needs its own renderer (§7) for the preview. Native `<track>` rendering stays available as a
side-by-side "what browser X will show" mode.

### Parser deviations measured in real browsers

`apps/web/e2e/native.e2e.ts` loads the WPT file-parsing inputs, our fixtures and seeded fuzz
documents (as generated and after export) into real `<track>` elements in Chromium, Firefox and
WebKit, and compares each browser's `VTTCue`/`VTTRegion` objects with ours. Each known
difference is listed in `apps/web/e2e/native-deviations.ts` with what triggers it and a minimal
example; the examples are tested, so an entry that is wrong or that a browser fixes fails. Any
other difference fails too, and arrives with a minimized reproduction. On every minimal case
our result matches the WPT reference parser.

Chromium has no `lineAlign`, `positionAlign` or regions, so those are not compared there.

| Input (minimal example)                                     | Spec (and MicroVTT) |      Chromium       |   Firefox   |      WebKit      | Exported files? |
| ----------------------------------------------------------- | ------------------- | :-----------------: | :---------: | :--------------: | :-------------: |
| `line:0,end`: any line or position with an alignment suffix | line 0, aligned end |       ignored       |             |                  |     **yes**     |
| a line of only spaces in cue text (YouTube auto-captions)   | part of the text    |                     |  ends cue   |                  |     **yes**     |
| cue id starting with `STYLE` before the first cue           | id kept             |       dropped       |   dropped   |     dropped      |     **yes**     |
| cue id starting with `NOTE` or `REGION`                     | id kept             |                     |   dropped   | `REGION` dropped |     **yes**     |
| `NOTE` whose first line is `STYLE`, before the first cue    | a comment           |    next id wrong    |             |                  |     **yes**     |
| a `REGION` block after header text or a comment             | region defined      |                     |   ignored   |                  |     **yes**     |
| `REGION` lines in the header (an older draft)               | ignored             |                     |   defined   |     defined      |       no        |
| a `REGION` block ended by a timing line, no blank line      | region defined      |                     |             |     ignored      |       no        |
| `region:r line:1` (line, size or vertical with a region)    | no region           |                     |   keeps r   |     keeps r      |       no        |
| `region:r region:zz` (unknown id later)                     | no region           |                     |   keeps r   |                  |       no        |
| `line:19,` (invalid alignment)                              | setting rejected    |                     |   line 19   |                  |       no        |
| `line:-83%,end` (invalid position, valid alignment)         | setting rejected    |                     | aligned end |                  |       no        |
| `size:6.%`, `line:1.`, `line:-.5`                           | setting rejected    |      accepted       |  accepted   |                  |       no        |
| form feed between settings                                  | a separator         |       not one       |             |     not one      |       no        |
| timing line after two lines of a block, or in the header    | block ends; no id   | previous line is id |    same     |       same       |       no        |

Browsers that fail a WPT file-parsing test (Chromium: `settings-line`, `settings-position`) are
reported as annotations on the test run. "Exported files" marks valid output MicroVTT may write: Chromium-based players lose
non-default line and position alignments, Firefox truncates cues at whitespace-only lines and
loses regions after the leading comment that holds preserved header text, and ids starting
with a block keyword are dropped. Export writes the spec form; its player-compatibility options
(below) avoid the deviations marked there, and tests check each option against the browsers.

### Other players

The same comparison runs against parsers outside browsers, on our fixtures, the feature
catalogue's examples (`packages/core/src/features.ts`) and exported fuzz documents:

- **ffmpeg** (libavformat 6.1, which mpv and many media servers and converters read subtitles with):
  `packages/core/test/players/ffmpeg.test.ts` passes each input through `ffmpeg -c copy -f
webvtt` and parses the result. CI installs ffmpeg.
- **video.js** (its parser, `videojs-vtt.js` 0.15) and **Shaka Player** (5.2, `VttTextParser`):
  `apps/web/e2e/players.e2e.ts`, in Chromium. hls.js keeps its parser internal, so it is not
  covered. Shaka's cues have their own shape, so only what they share with `VTTCue` is compared
  (text as plain text).

Every difference must match a documented deviation, each with a tested minimal example, as for
browsers.

| Input (minimal example)                                  | Spec (and MicroVTT) |        ffmpeg        |  video.js   |            Shaka Player            | Export option             |
| -------------------------------------------------------- | ------------------- | :------------------: | :---------: | :--------------------------------: | ------------------------- |
| a STYLE or REGION block                                  | read                | **no cues after it** |             |                                    | remove (lossy)            |
| a REGION block                                           | region defined      |                      |   ignored   |              ignored               |                           |
| cue id starting with `NOTE` (`NOTE 1`, `NOTES`)          | id kept             |     cue dropped      | cue dropped |  `NOTE` or `NOTE …`: cue dropped   | remove keyword ids        |
| cue id `STYLE` or `REGION`                               | id kept             |                      |             |            cue dropped             | remove keyword ids        |
| two cues with the same times and text                    | both shown          |     one dropped      |             |                                    |                           |
| `position:90%,line-right` (or `line-left`)               | aligned line-right  |                      |   ignored   |                                    |                           |
| a line of only spaces, or spaces at the ends of the text | part of the text    |                      |             |              trimmed               | trim (lossy)              |
| `<lang fi>…</lang>`                                      | a language span     |                      |             | **whole cue's tags shown as text** | remove lang spans (lossy) |
| `&eacute;` (named references but a few)                  | é                   |                      |             |          shown as written          | write characters          |

### Player-compatibility export options

`packages/core/src/compat.ts`, offered in the export dialog only when they would change the
file. Each keeps the output conforming; tests check that each removes the deviations it
targets in the player concerned, and that the lossless ones keep every cue, setting and cue
text tree.

| Option                                         | Default | Changes for conforming players                  |
| ---------------------------------------------- | :-----: | ----------------------------------------------- |
| Remove cue ids starting with NOTE/STYLE/REGION |   on    | the ids (and `::cue(#id)` styles that use them) |
| Write REGION blocks first in the header        |   on    | nothing                                         |
| Write characters for named references          |   on    | nothing (only how the text is written)          |
| Trim whitespace lines and cue-text ends        |   off   | layout: a blank-looking line takes a row        |
| Remove `<lang>` spans                          |   off   | language-dependent rendering                    |
| Remove STYLE and REGION blocks                 |   off   | styles and regions                              |

The validator also warns (`cue-id-keyword`) about cue ids that start with a block keyword: they
are valid, but every player tested misreads them.

### YouTube

YouTube's caption processing cannot be run locally, so `docs/YOUTUBE-TEST.md` describes a manual
check with generated test files and records the results (2026-10-07, web player). YouTube
keeps text markup, word timings, character references, line, position and alignment, and
overlapping cues. It ignores `size`, `vertical`, STYLE blocks and regions, shows ruby as
`base(annotation)`, and, like Firefox, ends a cue at a line of only spaces, losing the rest of
its text. YouTube Studio reports upload errors for REGION blocks, `region:` settings,
position/line alignment suffixes and the text left over after a space-only line.

YouTube's own WebVTT (as yt-dlp downloads it) does not conform: it writes `<c.>`, `<rt>` outside
`<ruby>`, and position alignments as an old draft's `middle`, which parsers reject with the
whole setting (MicroVTT reads it as `center`; see the divergence above) (`docs/YOUTUBE-TEST.md`, "What YouTube stored"; fixture
`youtube-reexport.vtt`).

`YOUTUBE` in `features.ts` holds these results. The export dialog lists the features a file
uses that YouTube does not keep or reports on upload (warnings only), and a button ticks the
export fixes that avoid them (`YOUTUBE_FIXES`: the default fixes plus "trim whitespace" and
"remove STYLE and REGION blocks").
