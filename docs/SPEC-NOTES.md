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
- The setter semantics should match the `VTTCue`/`VTTRegion` IDL (§9), as tested by
  `tests/wpt/api/`, so the model can be mirrored into native `VTTCue` objects.

### Serializer (`core/serialize`)

Not specified by the spec beyond "must generate conforming files". Our rules:

- Strict mode: always output `WEBVTT`, a blank line, STYLE and REGION blocks, then cues sorted by
  start time, with LF terminators by default and settings in canonical order. Escape `&`, `<`, `>` in
  text spans and annotations. Never emit `-->` inside payloads (escape the `>` as `&gt;`).
  Optional hours in timestamps.
- Property tests: `parse(serialize(doc))` is equivalent to `doc` for any doc.

### Repair (`core/repair`): export-time fixes

Most conformance comes free from serializing the model, because the parser only stores valid
values: invalid or duplicate settings are already gone, the cue-text tree builder has already fixed
misnesting and closed open spans, and timestamps are re-formatted. These rules need an active fix,
and each applied fix goes into the export report:

| Rule (§4)                                                                              | Fix                                                                                                            |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Text after the signature line before the first blank line (e.g. `Kind:`/`Language:`)   | Move into a `NOTE` block                                                                                       |
| Cue start times not non-decreasing                                                     | Stable sort by start time                                                                                      |
| Cue end ≤ start                                                                        | Needs judgment. The default is decided in Phase 2, and the editor flags it before export                       |
| Duplicate cue IDs                                                                      | Add a numeric suffix (`id-2`, …), keeping the IDs unique                                                       |
| `-->` in payload or NOTE text                                                          | Escape as `--&gt;` (payload) or break the sequence (NOTE)                                                      |
| Cue timestamp not strictly increasing, or outside (start, end)                         | Drop that timestamp tag and keep the text                                                                      |
| Cue region reference to an undefined region, region with no `id`, duplicate region ids | Drop the reference, drop the region, drop earlier duplicates (cues bind to the last region with that id, §6.3) |
| `<lang>` with an invalid BCP 47 tag                                                    | Unwrap the span and keep its content                                                                           |
| STYLE block CSS that doesn't parse, or uses properties outside §8                      | Drop the offending rules or declarations                                                                       |
| File-type rules (§4.6), e.g. overlapping chapter cues                                  | Only when the user picks a strict file type. Otherwise the file is treated as captions                         |

Anything the parser discards on import (junk lines, invalid settings, STYLE/REGION blocks that
appear after the first cue) is reported at import time, because by export it no longer exists.

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

## Test corpus

- `tests/wpt/file-parsing/*.test`: 38 parser tests. The format is title, metadata, JS
  assertions over `cues`, then `===`, then the VTT body (Python escapes such as `\x00` and `\r`). We will
  run them in Vitest with a small shim that exposes our parse output through
  VTTCue-shaped objects and evaluates `assert_equals` and similar assertions.
- `tests/wpt/file-parsing/*.vtt`: files with invalid signatures, all of which must be rejected.
- `tests/wpt/cue-text-parsing/*.dat`: 78 cue-text tree tests in html5lib `#data` / `#document-fragment` format.
- `tests/wpt/api/`: VTTCue/VTTRegion setter semantics, for the model.
- Our own fixtures and property-based tests (fast-check) cover validator diagnostics, repair (any input exports with zero errors),
  and large-file performance.
