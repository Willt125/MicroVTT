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

### Older drafts (for reading legacy files)

Every W3C publication of WebVTT, used to decide what old files meant (Phase 4d). Not normative.

| Draft                                                                    | What it has that the current spec does not                                                                                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [2014-11-13 FPWD](https://www.w3.org/TR/2014/WD-webvtt1-20141113/)       | `middle` for text, line and position alignment; position alignment `start`/`end` = the box's left/right side; metadata headers (`Name: value` lines after `WEBVTT`); `Region:` headers with `=` settings |
| [2015-12-08 WD](https://www.w3.org/TR/2015/WD-webvtt1-20151208/)         | `center` replaces `middle`; position alignment still `start`/`center`/`end` (`start` = left side); metadata headers and `Region:` headers; STYLE blocks arrive                                           |
| [2017-07-13 WD](https://www.w3.org/TR/2017/WD-webvtt1-20170713/) onwards | The current shape: REGION blocks, `line-left`/`center`/`line-right`, no metadata headers                                                                                                                 |

Later publications: [2017-08-08 WD](https://www.w3.org/TR/2017/WD-webvtt1-20170808/),
[2018-05-10 CR](https://www.w3.org/TR/2018/CR-webvtt1-20180510/),
[2019-04-04 CR](https://www.w3.org/TR/2019/CR-webvtt1-20190404/),
[2026-05-20 CRD](https://www.w3.org/TR/2026/CRD-webvtt1-20260520/). None of them has the
single-letter settings (`A:`, `T:`, …), which predate the W3C drafts (WHATWG HTML, 2010–11).

So YouTube's `Kind:`/`Language:` lines, `X-TIMESTAMP-MAP=…` (HLS) and `Region:` lines were
conforming metadata headers under the 2014–15 drafts, and YouTube's `,middle` is 2014 syntax.

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

**Deliberate divergences, on import only (Phase 4d):** the editor reads what older drafts and
other tools wrote as it was meant, where the spec's parser ignores it. YouTube still writes
`position:X%,middle`, SRT habits end up in `.vtt` files, and old files predate the current
syntax; editing such files is MicroVTT's main use, so dropping what they say would lose it.

| Input                                                                             | The spec's parser                  | MicroVTT's import                                                             | Diagnostic                 |
| --------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| `align:middle`, `line:…,middle`, `position:…,start\|middle\|end` (2014–15 drafts) | ignores the setting                | the current name                                                              | `cue-setting-legacy`       |
| `A:middle`, `T:10%`, `L:-1`, `S:50%`, `D:vertical` (2010–11 drafts)               | ignores the setting                | the current setting                                                           | `cue-setting-legacy`       |
| `position:110%`, `size:-5%`                                                       | ignores the setting                | clamped to 0–100% (a guess)                                                   | `cue-setting-out-of-range` |
| `00:00:01,000`, `0:01.5`, `00:01.50` (SRT, other digit counts)                    | drops the cue                      | the time meant                                                                | `timestamp-legacy`         |
| `Region: id=r width=40%` header lines (2014–15)                                   | ignores them                       | REGION blocks                                                                 | `region-header-legacy`     |
| `<br>`                                                                            | drops the tag (words run together) | a line break                                                                  | `cue-text-legacy-tag`      |
| `<font color="yellow">`, `color="#ff8800"`                                        | drops the tag                      | `<c.yellow>` (a default colour class), or a generated class with a STYLE rule | `cue-text-legacy-tag`      |
| bytes that are not UTF-8                                                          | turns letters into `�`             | the legacy encoding the text reads best in, or a chosen one; UTF-16 BOM kept  | `file-encoding`            |

The validator reports each one, and export writes the current form, so output still conforms.
The parser itself stays exactly the spec's algorithm unless asked
(`parse(text, { legacyValues: true })`; `importDocument` asks), so the WPT and browser
comparisons are unaffected. The single-letter settings are mapped from secondary sources
(no W3C draft has them, and the 2010–11 WHATWG text could not be fetched here); `D:`, `L:`,
`T:` and `A:` agree across those sources, `S:` (size) less firmly.

Two recoveries change what conforming players show, so they are offered in the problems panel
("Can be fixed") instead of applied: joining text that follows a blank line inside a caption
to that caption, and moving a STYLE or REGION block that comes after the first cue to the
header (reconnecting the cues that named that region). One export option writes
non-conforming output on request: header lines (`X-TIMESTAMP-MAP=…` for HLS, `Kind:`,
`Language:`) kept under `WEBVTT`, as the 2014–15 drafts' metadata headers.

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
- _Encoding detection is outside the WebVTT spec._ The editor applies it only to files that are
  not valid UTF-8 (which a conforming parser would read with U+FFFD in place of letters): it
  tries the legacy encodings and keeps the one whose text contains the most common words of a
  language that encoding is used for, Windows-1252 if none does. It says so in a banner, the
  user can choose another, and export always writes UTF-8.

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

### Renderer, spec §7 "Rendering" and §8 "CSS extensions"

Core computes what needs no layout (`render.ts`: computed line, position and position
alignment, box size and offsets, region boxes, active cues in text track cue order;
`cue-css.ts`: style sheets rewritten for the renderer's DOM). The DOM part is
`apps/web/src/lib/render/renderer.ts`.

- §7.1 processing model, §7.2 processing cue settings (snap-to-lines stepping and switching
  direction; for percentage lines, the closest free position on both axes, the higher and then
  the more leftward winning a tie), §7.3 obtaining CSS boxes, §7.4 applying CSS properties,
  regions (6vh lines, anchors, moved down by the height their cues leave unused).
- `::cue`, `::cue(selector)`, `::cue-region`, `::cue-region(#id)`, `:past` and `:future`, with
  only the properties §8 allows for each; `:past`/`:future` rules lose the sizing ones.
  `::cue()` arguments match internal nodes, not text, so `::cue(:future)` reaches only timed
  text inside a span (`<c>`, `<i>`, …); the editor offers to wrap bare timed text in `<c>`.
  Selectors in `::cue()` match the cue and its nodes only (WebVTT names; other type selectors
  match nothing; node objects are in the empty namespace). A page-level prefix in a STYLE
  block applies only if it matches §7.3's hypothetical element (`*`, `*|*`, `|*`, `:not()` of
  something else). `@import` and non-`data:` URLs in STYLE blocks are dropped.
- The default colour classes (`.white` … `.black`, `.bg_white` … `.bg_black`, §5) are
  presentational hints: below every style sheet, the later class winning.

Interpretations where the spec leaves a gap or disagrees with browsers (and WPT):

- **Negative snap-to-lines lines.** §7.2 measures them from the "maximum dimension", which it
  does not define. We use the full height (or width) minus the box's extent less one line step,
  so that line −1 puts the last line at the bottom and a wrapped cue grows upwards, as browsers
  and WPT do.
- **Vertical cues** count lines from the right (`rl`) or left (`lr`), and `line: auto` is the
  first line on that side, as browsers and WPT do; read literally, the spec's steps start on the
  opposite side.
- **No clipping.** The cue box does not clip its text (the spec does not ask for it). Regions do
  (§7.4, `overflow: hidden`).
- **Cascade.** STYLE blocks come after the page's style sheets (§8), and win over the page's
  `!important` rules even inside cascade layers, as WPT expects: the renderer puts their normal
  declarations in a layer after the page's and their `!important` ones in a layer before it.
- **Broken CSS.** A value left open at the end of a STYLE block (an unterminated `url(` or
  string) is closed as the end of a style sheet closes it, and each sheet is its own `<style>`,
  so one block cannot spill into the next.
- **Scroll-up regions** show their latest lines (older ones are pushed out of the region's
  top), and move them up with the spec's transition (`top`, 0.433s). The renderer rebuilds the
  cue boxes when the set of cues changes, so it measures where the lines still showing were,
  starts every line that far down (a new line from below the region's clipped edge) and lets them
  slide up. It does so only while playing on (the time moved forward by at most 2 s since the
  last drawing), not when seeking, resizing or editing, and not for viewers who prefer reduced
  motion.
- **Controls.** The browser's renderer moves captions above the video's controls while they
  show; the spec renderer does not (the controls are not part of the video's rendering area).

WPT's rendering reftests (`tests/wpt/rendering`) run against the renderer in Chromium, Firefox
and WebKit in CI (`apps/web/e2e/wpt-rendering.e2e.ts`; locally Chromium only, unless
`WPT_ALL_BROWSERS=1`; `WPT_REPORT=1` logs each result, and for unexpected failures where the
pixels differ). Where a reference contradicts the spec, the test is
listed with its reason in `wpt-rendering-expectations.ts`. The main groups: references that
wrap greedily where §7.4 balances lines, clip the cue box, leave out the background of regions
or ruby text, place vertical cues at the bottom, ignore the region's unused height, or follow
tentative proposals (5vmin font size, w3c/webvtt#529 and #530); and a few broken references
(two tracks with no blank lines, so their STYLE block is part of a NOTE; animation references
copied from the bold test).

Firefox and WebKit differ from Chromium in a few stated ways, recorded per browser
(`BROWSER_ADJUSTED`, `PASSES_IN`):

- **Firefox line boxes.** A line of 9px Ahem with `line-height: normal` (the spec's) is 10px
  tall in Firefox, not 9px. References that set `line-height: 1` match with it; references
  that place a line one font size (9px) away, where the spec counts line boxes, are 1px off.
- **Rounding.** One row of pixels where two line boxes meet (Firefox and WebKit), the 0.2px
  region row rounded across the whole row (WebKit), and the outline the references imitate
  with a border (WebKit, at 2× scale).
- **Chromium-only failures.** WebKit breaks lines at U+2028 and lays out hanging white space
  inside styled objects as those references expect, so they pass there.
- **A renderer bug they found:** Firefox reports one line of mixed-direction text as one box
  per direction run, and snap-to-lines took the line pitch from the second box (0), leaving
  such cues at the top of the video. The pitch now comes from the next line's box.

### SubRip (.srt), which has no spec

MicroVTT also edits SubRip natively (Phase 6b, `packages/core/src/srt/`). There is no
specification, so its rules are what players commonly read, and are documented as such:

- A file is blocks separated by blank lines: a number, a timing line
  `HH:MM:SS,mmm --> HH:MM:SS,mmm`, then text. Import also takes what players take: no number,
  no blank line before the next block, a full stop for the comma, missing hours, one-digit
  fields, and box coordinates after the times (`X1:… Y2:…`, from DVD rips), which are dropped.
- Cue text markup is HTML-like tags (`<b>`, `<i>`, `<u>`, `<s>`, `<font color/face/size>`) and
  override blocks borrowed from ASS: `{\an1}`–`{\an9}` place the cue (numeric keypad layout),
  `{\i1}` … `{\i0}` and the like toggle a style. There are no character references: `&amp;`
  is shown as typed.
- There is no set encoding. Import detects it as for WebVTT; export writes UTF-8 unless the
  file's own encoding is chosen and every character fits.
- WebVTT ↔ SubRip: `{\anN}` maps to `line` (top, middle at 50%, bottom) and `align`
  (left, centre, right), and back; `<font color>` maps to colour classes (the default ones, or
  a generated class with a STYLE rule), and back. What the other format cannot hold is listed
  on export.

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

### All players at a glance

The measurements above and the YouTube upload test (web player and mobile app,
`docs/YOUTUBE-TEST.md`) in one table. ✓ means the player behaves as the spec says; text says
what it does instead; · means not tested; † marks a divergence that can affect a valid file
MicroVTT exports. ffmpeg, video.js and Shaka were compared only on valid files, so the rows about
invalid input are untested for them.

The last column says which draft, if any, the divergences match (see "Older drafts" above):
"none" means they conform to no version from the 2014 First Public Working Draft to the current
Candidate Recommendation Draft.

| Input                                                                              | Spec                  | Chromium                  | Firefox                                 | WebKit                                              | ffmpeg                      | video.js                          | Shaka                                 | YouTube                                               | Divergences match                                                                                         |
| ---------------------------------------------------------------------------------- | --------------------- | ------------------------- | --------------------------------------- | --------------------------------------------------- | --------------------------- | --------------------------------- | ------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Blocks**                                                                         |                       |                           |                                         |                                                     |                             |                                   |                                       |                                                       |                                                                                                           |
| STYLE block                                                                        | style sheet           | ✓                         | ✓                                       | ✓                                                   | **reads no cues after it**† | ✓                                 | ✓                                     | accepted; ignored                                     | ffmpeg: none. YouTube: 2014 (STYLE came in 2015)                                                          |
| REGION block                                                                       | region defined        | no regions at all         | ignored after header text or a comment† | ignored if a timing line follows with no blank line | **reads no cues after it**† | ignored                           | ignored                               | upload error; ignored                                 | Chromium, ffmpeg, Firefox, WebKit: none. video.js, Shaka, YouTube: 2014–15 (regions from `Region:` lines) |
| `Region:` header line                                                              | ignored               | ✓                         | defines a region                        | defines a region                                    | ·                           | ·                                 | ·                                     | ·                                                     | 2014–15                                                                                                   |
| Timing line after two text lines, or in the header                                 | block ends, no id     | previous line taken as id | same                                    | same                                                | ·                           | ·                                 | ·                                     | ·                                                     | none                                                                                                      |
| NOTE whose first line is `STYLE`, before the first cue                             | a comment             | next cue's id wrong†      | ✓                                       | ✓                                                   | ·                           | ·                                 | ·                                     | ·                                                     | none                                                                                                      |
| **Cue ids and cues**                                                               |                       |                           |                                         |                                                     |                             |                                   |                                       |                                                       |                                                                                                           |
| Id starting with `NOTE`                                                            | id kept               | ✓                         | id dropped†                             | ✓                                                   | cue dropped†                | cue dropped†                      | cue dropped (`NOTE`, `NOTE …`)†       | ·                                                     | none                                                                                                      |
| Id starting with `STYLE`                                                           | id kept               | id dropped†               | id dropped†                             | id dropped†                                         | ✓                           | ✓                                 | cue dropped (exactly `STYLE`)†        | ·                                                     | none                                                                                                      |
| Id starting with `REGION`                                                          | id kept               | ✓                         | id dropped†                             | id dropped†                                         | ✓                           | ✓                                 | cue dropped (exactly `REGION`)†       | ·                                                     | none                                                                                                      |
| Two cues with the same times and text                                              | both shown            | ✓                         | ✓                                       | ✓                                                   | one dropped†                | ✓                                 | ✓                                     | ·                                                     | none                                                                                                      |
| **Settings**                                                                       |                       |                           |                                         |                                                     |                             |                                   |                                       |                                                       |                                                                                                           |
| Alignment suffix (`line:0,end`, `position:90%,line-right`)                         | aligned as written    | whole setting ignored†    | ✓                                       | ✓                                                   | ✓                           | `line-left`/`line-right` ignored† | ✓                                     | upload error; shown right on web; stored as `middle`† | Chromium: none. video.js: 2014–15 (`start`/`end`). YouTube: 2014 (`middle`)                               |
| Invalid suffix (`line:19,`) or invalid value with a valid suffix (`line:-83%,end`) | setting rejected      | ✓                         | kept / suffix applied                   | ✓                                                   | ·                           | ·                                 | ·                                     | ·                                                     | none                                                                                                      |
| Malformed numbers (`size:6.%`, `line:-.5`)                                         | rejected              | accepted                  | accepted                                | ✓                                                   | ·                           | ·                                 | ·                                     | ·                                                     | 2014, loosely (its percentage parser only "interprets as a real number")                                  |
| Form feed between settings                                                         | a separator           | not a separator           | ✓                                       | not a separator                                     | ·                           | ·                                 | ·                                     | ·                                                     | none                                                                                                      |
| `region:` together with `line`/`size`/`vertical`                                   | no region             | (no regions)              | keeps the region                        | keeps the region                                    | ·                           | ·                                 | ·                                     | ·                                                     | 2014's algorithm (not its prose)                                                                          |
| `region:r region:zz` (unknown id second)                                           | no region             | (no regions)              | keeps `r`                               | ✓                                                   | ·                           | ·                                 | ·                                     | ·                                                     | none                                                                                                      |
| `size:`                                                                            | box width             | ✓                         | ✓                                       | ✓                                                   | ✓                           | ✓                                 | `size:0%` treated as default†         | ignored†                                              | none                                                                                                      |
| `vertical:`                                                                        | vertical text         | ✓                         | ✓                                       | ✓                                                   | ✓                           | ✓                                 | ✓                                     | ignored†                                              | none                                                                                                      |
| `position:`, `align:`                                                              | as written            | ✓                         | ✓                                       | ✓                                                   | ✓                           | ✓                                 | ✓                                     | web ✓; mobile ignores both†                           | none                                                                                                      |
| **Cue text**                                                                       |                       |                           |                                         |                                                     |                             |                                   |                                       |                                                       |                                                                                                           |
| Line of only spaces                                                                | part of the text      | ✓                         | **ends the cue**†                       | ✓                                                   | ✓                           | ✓                                 | trimmed†                              | **ends the cue; rest lost**, upload error†            | none                                                                                                      |
| Spaces at the start or end of the text                                             | kept                  | ✓                         | ✓                                       | ✓                                                   | ✓                           | ✓                                 | trimmed†                              | ·                                                     | none                                                                                                      |
| `<lang>` span                                                                      | language span         | ✓                         | ✓                                       | ✓                                                   | ✓                           | ✓                                 | **all the cue's tags shown as text**† | ✓                                                     | none                                                                                                      |
| Named references such as `&eacute;`                                                | é                     | ✓                         | ✓                                       | ✓                                                   | ✓                           | ✓                                 | shown as written†                     | ✓                                                     | 2014 (six escapes only)                                                                                   |
| `<b>`, `<u>`                                                                       | bold, underline       | ✓                         | ✓                                       | ✓                                                   | ✓                           | ✓                                 | ✓                                     | web ✓; mobile shows only italic†                      | none                                                                                                      |
| Ruby                                                                               | annotation above      | ✓                         | ✓                                       | ✓                                                   | ✓                           | ✓                                 | ✓                                     | shown as `漢字(kanji)`†                               | none                                                                                                      |
| Word timings                                                                       | revealed word by word | ✓                         | not styled (no `:past`/`:future`)\*     | ✓                                                   | ✓                           | ✓                                 | ✓                                     | ✓                                                     | none                                                                                                      |

\* From MDN's compatibility data, not measured by us. Chromium's lack of regions and of line and
position alignment is also MDN data, which the parser comparison confirms.

Roughly half the divergences match an older draft (mostly 2014–15 regions and setting names);
the rest conform to no version. REGION blocks arrived in 2017, so how a player mishandles them
matches no draft, while ignoring them altogether matches 2014–15. Single-letter settings, `<br>`
and `<font>` (read on import, see "Older drafts") come from WHATWG's 2010–11 text, not from any
W3C draft.

How export handles the † rows:

- **Fixed by the options on by default:** removing cue ids that start with a keyword (every id
  row), writing REGION blocks first (Firefox's REGION after a comment), and writing characters
  for named references (Shaka's `&eacute;`).
- **Fixed by opt-in options**, because they change what conforming players show: trimming
  whitespace lines (Firefox, Shaka and YouTube), removing `<lang>` spans (Shaka), and removing
  STYLE and REGION blocks (ffmpeg).
- **No export fix:** Chromium's ignored alignment suffixes, ffmpeg's dropped duplicates, Shaka's
  `size:0%`, and the YouTube rendering rows (left to YouTube by decision; see PLAN.md).
