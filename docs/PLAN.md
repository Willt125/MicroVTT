# MicroVTT plan

## Goal

MicroVTT is an offline, in-browser WebVTT editor with these properties:

- **Primary use case: fixing YouTube auto-generated captions.** Auto-captions are badly wrong
  whenever the speaker doesn't enunciate clearly. The tool has to make it fast to import them,
  correct the text and timing, and export something clean, with a full editing suite rather than a
  bare text box. See "Primary workflow" below.

- **100% standards-compliant.** It meets the spec's _authoring tool_ and _conformance checker_
  requirements, and its preview renders according to the spec's own rendering rules (see
  `SPEC-NOTES.md`). We measure compliance with the vendored web-platform-tests suites plus our
  own spec-derived tests, so "compliant" is something CI checks rather than something we assert.
- **Fully offline.** It makes no network requests at runtime. It ships as a single
  self-contained `.html` file that works from `file://`, and later as a hosted PWA that can be
  installed and then works offline (Phase 7, once quality is there).
- **Import and export.** WebVTT is the primary format. It imports any `.vtt` the spec parser
  accepts, including invalid ones, and **every export is a conforming file**: problems are fixed on
  export and listed in an export report. SRT import and export come next, and SCC is a long-term goal.
- **Full spec, not just what YouTube uses.** Every WebVTT feature (regions, styling, ruby,
  voices, karaoke timestamps, chapters and metadata) is supported for editing, validation and
  export, for the players and viewers that support it.
- **Long videos.** It handles captions for any video YouTube allows, up to 12 hours (see "Sizing").
- **Cross-browser.** It supports current Chrome/Edge, Firefox and Safari (the last two major
  versions of each). Chromium-only APIs get fallbacks.

## Stack (decided)

| Concern           | Choice                                                                                                               | Why                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language          | **TypeScript 6** (strict)                                                                                            | TS 7 (native) is out, but `typescript-eslint` and `svelte-check` peer ranges stop at 6.x. Upgrade when they catch up.                                                                                            |
| Monorepo          | **pnpm workspaces**                                                                                                  | `packages/core` stays DOM-free and framework-free, so it can be tested in Node, run in a Worker, and be reused (CLI or library later).                                                                           |
| UI                | **Svelte 5** (runes) + **Vite 8**                                                                                    | Compiled with no virtual DOM, so runtime and bundle are small. Fine-grained reactivity suits a large, frequently updated cue list. No SvelteKit, because this is a client-only SPA with no routing or SSR needs. |
| Tests             | **Vitest 5** (unit, WPT harness, property tests with fast-check) + **Playwright** (e2e on Chromium, Firefox, WebKit) | Vitest shares Vite's transform pipeline. Playwright is the only practical way to cover all three engines.                                                                                                        |
| Lint and format   | ESLint 10 (flat config, typescript-eslint, eslint-plugin-svelte) + Prettier                                          | Biome's Svelte support is still partial.                                                                                                                                                                         |
| Offline packaging | `vite-plugin-pwa` (Workbox precache) and `vite-plugin-singlefile`                                                    | Two build targets from one codebase, added in Phase 7.                                                                                                                                                           |
| CI                | GitHub Actions                                                                                                       | lint → typecheck → test → build. Playwright cross-browser runs join in Phase 3.                                                                                                                                  |
| Runtime deps      | Minimal and audited. The core has zero runtime deps. The HTML entity table is generated at build time.               | Offline, auditable, small.                                                                                                                                                                                       |

Alternatives considered: React (larger runtime, coarse re-rendering of big lists without extra
memoization work), SolidJS (good fit, but a smaller ecosystem for editor widgets), and vanilla TS
(too much hand-rolled state management for this much UI). The core/UI split keeps the framework
choice cheap to revisit until Phase 3.

## Architecture

```
packages/core            DOM-free, zero deps, runs in Worker or Node
  timestamp              collect/format timestamps (done: seed module)
  decode                 bytes → string per UTF-8 decode; streaming; remembers BOM/line endings
  source                 source map: every block/cue/setting keeps its span for diagnostics
  parse                  spec §6 parser → model + CST (incremental, chunk-fed)
  cuetext                spec §6.4 cue text tokenizer/tree builder + entity table
  model                  Document { header, styles[], regions[], cues[], comments[] }
  validate               spec §4 syntax checks → Diagnostic[] (code, severity, range, spec link)
  repair                 export-time fixes for rules the model alone can't guarantee; fix report
  serialize              canonical, always-conforming output; streaming
  edit                   pure operations: shift/scale, split/merge, renumber IDs, sort, etc.
  autocaption            detect + de-roll + re-segment YouTube auto-captions, keeping word timings
  convert/*              SRT ↔ VTT next; SCC (CEA-608) long-term
apps/web                 Svelte 5 SPA
  worker                 import/parse/validate/serialize off the main thread
  store                  document state, undo/redo (command log), autosave to OPFS; waveform-peak cache
  ui                     virtualized cue table, cue editor, settings inspectors, timeline/waveform
  media                  playback via object URLs; streamed WebCodecs waveform peaks
  render                 spec §7 renderer for the preview overlay; native <track> comparison mode
tests/wpt                vendored WPT webvtt suites (BSD-3), driven by core tests
```

Key decisions:

1. **Export always conforms. Parsed values live in the model, fixes run at export.** Export runs
   three steps: _repair_ (the fixes the model can't guarantee by construction, see `SPEC-NOTES.md`),
   then _serialize_ canonically from the model, then _re-validate_. Re-validation must report zero
   errors, and CI enforces that as an invariant, not a hope. Every change repair makes is listed in
   the export report. Things the parser silently discards (junk lines, invalid settings) are
   reported as import diagnostics, so nothing disappears without the user seeing it. Source spans
   are kept for jump-to-error, not for byte-exact re-emission.
2. **Parse ≠ validate.** The parser follows §6 exactly, as the WPT tests require. The validator
   checks §4 syntax on the CST. They never share leniency logic.
3. **Integer milliseconds** for all times. Conversion to float seconds happens only at the VTTCue boundary.
4. **Cue text stays a string in the model.** It is tokenized into a tree lazily, for
   validation, rendering, and the rich editor. That keeps memory per cue low.
5. **Everything heavy runs in a Worker.** The main thread only receives the visible window of
   rows plus summary data.

## Sizing

The requirement started as roughly the 85th percentile of YouTube video lengths. Caption files
are small compared with the media, so we size for YouTube's maximum upload length of **12 hours**
and cover every video; the percentiles matter only for the media side.

**Video lengths** (tubestats.io's duration table, read off its cumulative column; percentiles
inside a power-of-two bucket are interpolated, so treat them as rough):

| Percentile | Length          | Auto-caption cues at 3.6k/h |
| ---------- | --------------- | --------------------------- |
| 50th       | about 4 min     | about 250                   |
| 85th       | about 30 min    | about 1.8k                  |
| 99th       | about 2.3–4.5 h | about 8k–16k                |
| Maximum    | 12 h (upload)   | about 44k                   |

That table counts all videos, not the ones people caption. Long videos (podcasts, lectures,
streams) are probably over-represented among caption fixes, so the long tail still drives the
design. About 0.3% of videos are listed at 9–18 h, past the upload limit (likely live-stream
archives or data quirks); they get the same treatment as 12 h.

**Measured** from ten real auto-caption files (`yt-dlp`): seven English speech-recognition
tracks (`en-orig`) from 5m48s to 4h18m29s, and three Finnish machine translations (`fi`).

| Sample   | Cues           | Size              | Per hour                  |
| -------- | -------------- | ----------------- | ------------------------- |
| 5m48s    | 289            | 48 KB             | 2,969 cues, 497 KB        |
| 9m21s    | 545            | 89 KB             | 3,499 cues, 573 KB        |
| 11m09s   | 619            | 101 KB            | 3,332 cues, 541 KB        |
| 13m39s   | 825            | 130 KB            | 3,628 cues, 574 KB        |
| 15m06s   | 887            | 143 KB            | 3,526 cues, 570 KB        |
| 48m33s   | 2,427          | 358 KB            | 2,997 cues, 442 KB        |
| 4h18m29s | 12,263         | 2.0 MB            | 2,846 cues, 470 KB        |
| **12 h** | **34k to 44k** | **5.3 to 6.9 MB** | extrapolated, YouTube max |

Fast talkers (political commentary) reach about 3.6k cues and 574 KB per hour. Translated tracks
are 5–15% smaller. About half of the cues are 10 ms hand-off cues, so after the de-roll cleanup a
12 h document holds roughly 22k caption lines at most.

What this means for implementation:

- **The `.vtt` side is modest.** 60k cues is well within what plain JS objects, a Worker parser and
  a virtualized table handle. We drop the struct-of-arrays storage and OPFS text spill-over from
  the earlier plan: complexity with no payoff at this size.
- **Design targets:** smooth editing at **≤ 100k cues** (more than 2× the measured 12 h worst case).
  Import, validation and export keep working, just slower, up to **≤ 50 MB**. Above that we warn
  but still try.
- **The real scaling problem is the media.** A 12 h video is gigabytes, and decoding its audio into
  one buffer for a waveform is impossible (12 h of 44.1 kHz float audio is several GB).
  - Playback always goes through an object URL, so the file is never read into memory.
  - Waveform peaks are computed _streamingly_: WebCodecs `AudioDecoder` plus a demuxer for
    MP4/WebM in a Worker, reduced to a few hundred peaks per second and cached in OPFS per file.
  - Where streamed decoding isn't available, long media gets no waveform, only the timeline and
    playback. This is detected by feature (`AudioDecoder` exists and `isConfigSupported()` accepts
    the file's audio codec), never by browser version. Short media can still use `decodeAudioData`
    under a duration cap (to be set by measurement in Phase 5). Since 85% of videos are under
    about 30 minutes, that fallback may cover most real use, but `decodeAudioData` holds the
    whole decoded file in memory (30 min of 48 kHz stereo is about 700 MB as float samples), so
    the cap has to be measured, not assumed.
- Import: `File.stream()` → `TextDecoderStream` → incremental parser in a Worker, with progress
  and cancellation.
- Export: chunked serialization to a `Blob` (or `FileSystemWritableFileStream` in Chromium).

## Primary workflow: fixing YouTube auto-captions

1. **Get the inputs.** MicroVTT is offline, so it doesn't fetch from YouTube. The user downloads
   the auto-captions (`.vtt`) and, optionally, the video or audio, for example with
   `yt-dlp --write-auto-subs --sub-format vtt`, or uses YouTube Studio's caption download for
   their own videos.
2. **Import.** The file parses with the spec parser like any other. MicroVTT then detects the
   auto-caption pattern (the `Kind:`/`Language:` header lines, `align:start position:0%`, rolling
   duplicated lines, per-word `<timestamp><c>` tags) and offers a **cleanup**:
   - _De-roll_: collapse the rolling duplicate cues into one cue per sentence or phrase.
   - Keep per-word timings internally, so text edits keep accurate timing and splits can land on
     word boundaries.
   - Re-segment by the user's rules (max characters per line, max 2 lines, min and max duration,
     sentence boundaries).
   - _Translated tracks_ (`Language:` other than the original, e.g. YouTube's `.fi`
     auto-translation): their word timestamps are **interpolated**, evenly spaced across each line,
     not taken from the audio. MicroVTT detects this and treats them as approximate: no word-snap,
     and re-segmentation uses cue boundaries only.
   - _Review markers_: YouTube's censored-word marker `[ __ ]` (written as `[&nbsp;__&nbsp;]` in
     English tracks) and sound tags like `[music]` are flagged as items to review, since a censored
     word is something the user will usually want to restore or confirm.
   - _Whitespace cleanup_ (offered, not forced): collapse double spaces and remove the doubled
     U+200B zero-width spaces seen in translated tracks. U+200B is legitimate word-separating text
     in some scripts (Thai, Khmer…), so it is never stripped without the user choosing to.
3. **Edit.** Correct text while the media plays: loop the current cue, slow playback, step word by
   word, and find/replace for names and terms the recognizer consistently gets wrong (with a saved
   glossary). Timing tools include drag on the waveform and snapping to word timings.
4. **Export.** Export a conforming, full-spec `.vtt`. Full-spec output is always the default and
   is never silently reduced, because other players and viewers support features YouTube doesn't. A
   "YouTube upload" check is an optional, warnings-only lint that lists features YouTube is likely
   to drop. It never strips anything. Which features YouTube actually honors needs testing
   against real uploads before we hard-code that list.

Conformance note: the auto-caption header (`WEBVTT` followed directly by `Kind: captions` and
`Language: en` lines) parses fine but is **not conforming syntax**. Export moves those lines into a
`NOTE` block, which conforms and keeps the information. See `SPEC-NOTES.md`.

The auto-caption format is documented from three real samples in `SPEC-NOTES.md`. YouTube has
changed it before, so the detector should key on structure rather than exact strings.

## Phased roadmap

Each phase ends green in CI with its acceptance criteria met.

### Phase 0: Repository and research (this change)

- [x] Gather sources: spec ED (pinned), WPT suites (vendored), MDN compat data.
- [x] Monorepo scaffold, TS/Svelte/Vite/Vitest/ESLint/Prettier, CI workflow.
- [x] Seed module (`timestamp`) with tests to prove the pipeline.
- [x] Measure real auto-caption samples (see Sizing).
- [x] Decide the open questions (see Decisions log).

### Phase 1: Core parser (spec §6) (done)

- [x] Decoder, incremental file parser, region settings, cue timings and settings, cue text
      tokenizer and tree builder, HTML entity table, chapter-title extraction.
- [x] WPT harness: all `file-parsing/*.test`, the invalid-signature `*.vtt` files and every
      `cue-text-parsing/*.dat` case run in Vitest (127 tests).
- **Accept:**
  - [x] 100% of the vendored WPT parsing tests pass.
  - [x] Differential fuzzing shows no divergences. The bar changed from "no divergences against
        `reference-parser.py`": that parser has known deviations from the spec, so it is patched
        at load time with spec-cited fixes (see `SPEC-NOTES.md`, "Test corpus") and compared
        against. 200k generated documents across four seeds agree. CI runs 3k per push.
  - [x] Parse benchmarks are recorded (`docs/BENCHMARKS.md`). A 12 h worst-case auto-caption file
        parses in about 0.1 s.

### Phase 2: Model, validator, serializer (done)

- [x] Document model (`document.ts`): title, head (regions, style sheets, comments) and body
      (cues and comments) with source ranges. Text the parser discards is kept as comments.
- [x] Validator (`validate.ts`, `cuetext-check.ts`, `css.ts`, `bcp47.ts`): 47 stable codes, each
      with a severity, a spec link and its export fix (`docs/DIAGNOSTICS.md`, generated).
      File types: captions (default), chapters, metadata, any.
- [x] Repair (`repair.ts`), canonical serializer (`serialize.ts`), export with report
      (`export.ts`). Edit operations (`edit.ts`): shift, scale, split, merge, sort, renumber, and
      `updateCue` with VTTCue attribute semantics.
- **Accept:**
  - [x] Every diagnostic code has a failing and a passing fixture; the passing one has no
        diagnostics at all.
  - [x] Property tests: zero export errors for generated documents, random garbage and
        API-built documents with hostile values; export is idempotent; `parse(serialize(doc))`
        equals `doc` after repair; cue text repair keeps the readable text. 2k cases each in CI,
        3 × 20k locally.
  - [x] All ten real auto-caption samples export with zero diagnostics.
  - The plan said "VTTCue-compatible setter semantics (WPT `api/` tests)". Those WPT tests
    exercise the browser's text-track machinery (`<video>`, `<track>`, `addCue`, async loading),
    not a value model, so they cannot run against `@microvtt/core`. The model follows the IDL's
    value domains instead (unit-tested); mirroring it into native `VTTCue` objects is checked in
    real browsers in Phase 3.

### Phase 3: Editor UI MVP

Split into three PRs, each usable on its own.

**3a: editor shell (done)**

- [x] Plain layout: toolbar, cue table and cue editor, problems panel on the side (stacks on
      narrow screens).
- [x] Theme selector: System plus six MIT-licensed themes (GitHub Light, Solarized Light,
      Catppuccin Latte, Dracula, One Dark, Nord). A test checks WCAG AA for every theme.
- [x] Open via picker or drag-and-drop. Parsing, live validation and export run in a Web Worker.
- [x] Virtualized cue table (fixed-height rows; about 23 rows in the DOM at any size) with
      keyboard navigation. Cue editor for times, id, text and settings via `updateCue`.
- [x] Undo/redo (typing within 1 s is one step), add, delete.
- [x] Problems panel: live diagnostics linked to cues, plus what the file had when opened.
- [x] Export dialog: options, a preview of every change repair will make, then download.
- **Measured in headless Chromium** (12 h worst case, 43.6k cues): opens in about 0.9–1.3 s,
  first validation in about 0.5 s, a scroll jump redraws within one frame, typing reaches the
  screen in the next frame, export preview in about 1.3 s.

**3b: media and productivity (done)**

- [x] Load a local audio or video file (button or drop); play it with the document as captions
      through the browser's own renderer (`<track>` fed the exported file). Audio files get a
      caption area too. Loop the selected cue; playback speed 0.25–2×.
- [x] "Sync list": playback selects the cue being played, and selecting a cue seeks to it (not
      while you are typing in the cue editor).
- [x] Keyboard-first timing: set start/end at the playhead (`[` `]`), skip (J/L, Shift for 5 s),
      play/pause (Space/K), new cue at the playhead (N), nudge times with ↑/↓ in a time field,
      previous/next cue with Alt+↑/↓. Every single-key shortcut also works with Alt while typing.
      `?` lists them all.
- [x] Split (S: at the text cursor, and at the playhead if it is inside the cue) and merge with
      the next cue (M). Splitting never cuts a tag or character reference and closes/reopens
      elements open at the split (core `splitCue`).
- [x] Find and replace (Ctrl/Cmd+F): match case, whole word (Unicode-aware), regular
      expressions with `$1`/`$<name>`; the current match is shown in context; replace all is one
      undo step. It searches the raw text, so a phrase split by word-timing tags doesn't match
      (Phase 4's cleanup removes most of those).
- [x] Paste WebVTT text anywhere outside a text field to open it.
- [x] Autosave to OPFS 1.5 s after an edit (from the worker, with synchronous access handles,
      which all three engines support); offered for restore on the start screen; cleared when the
      file is saved.
- [x] Save in place where the File System Access API exists (Chromium): files opened through the
      picker or dropped can be saved back; "Save as…" otherwise. Elsewhere saving downloads.
- **Measured in headless Chromium** (12 h worst case, 43.6k cues, with a video open): no long
  tasks when media loads, typing stays in step, autosave lands within about 2 s of the last
  keystroke, restore takes about 0.7 s, and find over all cues takes 50–100 ms.

**3c: cross-browser tests (done)**

- [x] Playwright e2e (`pnpm e2e`, `apps/web/e2e/`) against the production build: opening,
      editing with live validation and undo, keyboard navigation, split/merge, nudging, export
      and download, find/replace, paste, the shortcuts dialog, autosave and restore across a
      reload, and media (caption preview, seek on select, follow, loop, timing at the playhead)
      with a WAV generated in the test.
- [x] Native parser comparison (`native.e2e.ts`): the WPT file-parsing inputs, our fixtures and
      150 seeded fuzz documents (as generated and after export) are loaded into real `<track>`
      elements and every `VTTCue`/`VTTRegion` attribute the browser implements is compared with
      ours. A difference on a WPT input counts as the browser's when the browser fails that WPT
      test; any other difference must match a documented deviation (see `SPEC-NOTES.md`).
- [x] CI: one job per browser (Chromium, Firefox, WebKit), uploading traces on failure.
- [x] Green on Chromium, Firefox and WebKit. Firefox and WebKit cannot be downloaded in the
      development sandbox, so their differences are minimized inside the browser in CI and
      reported with a reproduction. 16 browser deviations are documented, each with a tested
      example; none turned out to be ours.

### Phase 4: Auto-caption cleanup (primary use case)

- Auto-caption detection, de-roll, word-timing preservation, rule-based re-segmentation,
  glossary-driven find/replace, and the "YouTube-safe" export profile.
- **Accept:** cleanup of each real sample fixture yields a conforming file with no lost words, and
  every cue's timing stays within its source words' timing.

Split into three PRs:

**4a: cleanup engine in core (done)** (`packages/core/src/autocaption.ts`)

- [x] Detection by structure: consecutive cues repeating a line (roll-up), plus evenly spaced word
      timestamps for machine translations (approximate timings). Language from the preserved
      `Language:` header line.
- [x] De-roll: the new line of each growing cue, as word groups with their timestamps (a group
      lasts until the next one); hand-off cues skipped. Out-of-order or out-of-range timestamps
      (the 2 known in 38k words) join the word before.
- [x] Segmentation chosen as a whole (dynamic programming over break points) rather than greedily:
      hard limits are line length (42), lines per cue (2), maximum duration (7 s), and breaks at
      every speaker change (`>>`) and after silences over 1.5 s; costs favour ending cues at
      sentence ends, then clause punctuation, and penalize cues under 1 s, faster than 20
      characters per second, or starting with punctuation alone. A whole sound-tag line
      (`[Music]`) gets a cue of its own. The last word before a pause is held for at most 2 s
      (a word otherwise lasts until the next one, so music or silence stretched cues to 14 s).
      Lines are balanced, preferring punctuation. Translated tracks break only between YouTube's
      lines and at sentence ends within them by default (their word times are guesses); breaking
      between words is an option.
- [x] Output: word timings kept as timestamp tags (default for speech recognition, off for
      translations), cue settings reset to defaults (YouTube's `align:start position:0%` kept
      on request), notes kept in place, head unchanged. Optional whitespace cleanup: collapse
      repeated spaces, remove doubled U+200B.
- [x] Review markers: censored-word markers and sound tags, found anywhere in a document.
- [x] **Accepted** on all 10 real samples (a test that runs where they are present): conforming,
      no word lost or reordered, cues in order without overlaps, each cue starting and ending on
      its own words' times, timestamps inside their cue. 12,263 cues (4h18m) become about 3,700
      in about 0.9 s.

**4b: cleanup in the editor (done)**

- [x] Detection runs on import (in the worker); a detected file gets a banner offering cleanup.
      "Clean up…" in the toolbar works on any file (it says when there is nothing to de-roll).
- [x] Cleanup dialog: every segmentation and output option, with a live preview (cue count and
      the first cues) computed in the worker; Apply is one undo step.
- [x] "To review" in the side panel: censored-word markers and sound tags, found with each
      background validation, each linked to its cue.
- [x] Glossary: find → replace corrections applied to the whole file at once (one undo step),
      saved in this browser, editable as `find => replace` text. Matching is whole-word and
      case-insensitive by default, and spaces match across word-timing tags, so corrections
      still apply after cleanup keeps word timings. The find bar has the same option
      ("Across timings", on by default).

**4c: export for YouTube and other players (done)**

- [x] Feature catalogue (`packages/core/src/features.ts`): 21 WebVTT features, each with a
      counter and a minimal example whose caption says what a viewer should see.
- [x] Parser comparison beyond browsers, on fixtures, the catalogue's examples and exported fuzz
      documents: ffmpeg/libavformat (unit test; CI installs ffmpeg), video.js's `videojs-vtt.js`
      and Shaka Player's `VttTextParser` (Chromium e2e). hls.js has no public parser API, so it
      is not covered. Deviations are documented with tested minimal examples
      (`SPEC-NOTES.md`, "Other players").
- [x] Player-compatibility export options (`packages/core/src/compat.ts`), shown in the export
      dialog only when they would change the file, each tested against the players it targets:
      remove cue ids starting with NOTE/STYLE/REGION, write REGION blocks first, write
      characters for named references (on by default; viewers see the same), and trim
      whitespace lines, remove `<lang>` spans, remove STYLE/REGION blocks (off; lossy). With
      every option on, ffmpeg and Shaka read exported fuzz documents exactly as we do (bar
      ffmpeg's removal of duplicate cues).
- [x] New warning `cue-id-keyword` for valid cue ids that every player tested misreads.
- [x] YouTube upload check: the export dialog lists the features a file uses that YouTube
      does not keep or reports on upload. Test files and instructions in `docs/YOUTUBE-TEST.md`.
- [x] YouTube results (owner, 2026-10-07, web player) recorded in `YOUTUBE`: size, vertical,
      regions and STYLE are dropped, ruby is shown as `base(annotation)`, and a space-only line
      ends the cue (the rest of its text is lost); REGION, `region:`, alignment suffixes and
      that leftover text are upload errors. The export dialog's YouTube list now shows only
      those, with a button that ticks the fixes avoiding them.
- [x] YouTube mobile app (owner, 2026-10-07): as the web player, but it also ignores bold,
      underline, `position` and `align`. Recorded in `docs/YOUTUBE-TEST.md` only.
- [ ] Not yet checked: YouTube TV apps.

### Phase 4d: Legacy and malformed input (done)

The editor should open what other tools and older drafts wrote, not only current WebVTT. Every
recovery lives in the import's legacy mode (`importDocument`; `parse` stays spec-exact), gets
its own diagnostic so the problems panel says what was reinterpreted, and export writes
conforming WebVTT. Several pieces (encoding fallback, comma timestamps, `<font>`) are shared
with SRT import (Phase 8), so this can move next to it if that comes first.

Automatic on import:

- [x] Lenient timestamps: `,` as the decimal separator (SRT habit), fewer or more than 3
      fraction digits, one-digit minute or second fields (parsers drop the whole cue).
- [x] `<br>` becomes a line break (parsers drop it, running the words on each side
      together).
- [x] Encoding fallback: bytes that are not valid UTF-8 are decoded as Windows-1252 with a
      warning, instead of turning into U+FFFD (which cannot be undone). An encoding choice on
      import for other code pages.
- [x] Old-draft `Region: id=… width=…` header lines (2014–15 drafts, `=` settings) become
      REGION blocks (vtt.js, Shaka, Firefox and WebKit still honour them).
- [x] Old alignment names (`middle`; position `start`/`end`): done in 4c, and checked against
      the 2014 and 2015 drafts (`SPEC-NOTES.md`, "Older drafts").
- [x] Single-letter cue settings from 2010–11 (`D:`, `L:`, `T:`, `S:`, `A:`) become their
      current names. They are in no W3C draft (all checked, 2014 onwards), and the WHATWG text
      of the time could not be fetched here, so the mapping follows secondary sources (`S:` is
      the least certain); worth checking against an archived WHATWG copy.
- [x] Out-of-range percentages (`position:110%`) are clamped to 0–100% (reported as a guess,
      since parsers drop them).
- [x] `<font color>`: a colour matching one of the spec's default colour classes becomes
      that class (`<c.yellow>`); any other becomes a generated class with a STYLE rule. Other
      `<font>` attributes are dropped and reported.

Fixes to apply from the problems panel (they change what conforming players show):

- [x] Text after a blank line inside a caption (a text-only block right after a cue): join it
      to the cue.
- [x] STYLE or REGION blocks after the first cue: move them to the header.

Export option (owner decision, 2026-10-07):

- [x] Keep `X-TIMESTAMP-MAP` (HLS segment timing) under the `WEBVTT` line, where HLS needs it.
      By default it is written as a NOTE comment, which loses its meaning. It was a valid metadata header
      in the 2014–15 drafts but is not in the current spec, so this is the one export that does
      not conform: off by default, offered only when the file has header lines, and labelled.
      It keeps every header line (`Kind:` and `Language:` too, as YouTube writes them).

### Phase 5: Timeline and productivity

- Canvas timeline with a streamed waveform (WebCodecs, cached peaks), drag to retime, snapping
  (word timings, cue edges), global shift and scale (resync), frame stepping, reading-speed and
  line-length QC checks (configurable, separate from conformance diagnostics), and bulk operations.
- **Accept:** a 12 h media file shows a waveform (where `AudioDecoder` exists) without memory
  growing in proportion to the media's length.

Split into three PRs:

**5a: waveform and timeline view (done)**

- [x] Peaks in a worker: Mediabunny (MPL-2.0; reads MP4/MOV, WebM/MKV, MP3, WAV, Ogg, FLAC
      from the `File` in chunks) feeding WebCodecs `AudioDecoder`, reduced to min/max peaks as
      the audio streams past, so decoded audio never accumulates.
- [x] Fine peaks stored in OPFS per file (name, size, modified time); only a coarse overview
      stays in memory, and a view reads just the range it shows. Reopening the file reuses them.
- [x] Fallback without WebCodecs (or for a codec it cannot decode): `decodeAudioData` at a low
      sample rate under a duration cap set by measurement (10 minutes: it costs about 45 MB per
      minute of stereo, see `BENCHMARKS.md`); above the cap, no waveform.
- [x] Canvas timeline under the player: waveform, cue blocks (selected one highlighted), the
      playhead; zoom (whole file to a few seconds), scroll, click to seek and select.
- [x] **Accepted:** browser memory grows by about 220 MB whether the media is 1 h or 12 h
      (12 h computes in about 3 minutes); `BENCHMARKS.md`, and an opt-in test to repeat it.

**5b: timing tools (done)**

- [x] Drag a cue's edges, or whole cues, on the timeline; the selected cues move together, as
      one undo step, and cues are kept in start order afterwards (the selection follows them).
- [x] Snapping to the edges of other cues, word timings and the playhead, within 8 px, with a
      guide where it snapped; Alt drags without snapping.
- [x] Frame stepping (`,` and `.`, or the buttons) at the video's frame rate, measured from the
      file by Mediabunny (its first 120 packets, rounded to a common rate within 0.5%) or
      chosen by the user; frame starts are rounded up to whole ms, so seeking shows that frame.
- [x] Multiple selection in the list (Ctrl/⌘-click, Shift-click, Ctrl/⌘+A) and on the
      timeline; delete and merge (consecutive cues) work on it.
- [x] Timing dialog for all or the selected cues: shift (or move the first cue to the
      playhead), two-point resync, and frame-rate change (for example 25 to 23.976 fps). Word
      timings move with their cues. Core: `resyncCues`, `syncMap`, `sortCuesMapped`.

**5c: quality checks (style and accessibility rules) (done)**: rules from subtitle style
guides and accessibility guidance, kept apart from the format's errors and warnings: their own
panel, grouped by rule, never shown as conformance problems, and never blocking export. Details
in `docs/QUALITY-RULES.md`.

- [x] A rule engine in `packages/core/src/quality/`. Each rule has an id, a category (timing,
      reading speed, layout, text, accessibility) and numeric settings. Each ruleset entry has
      a severity and cites its guide and section, with the edition read. Fixes are data, applied
      by the editor as one undo step each (or "Fix all" per rule).
- [x] Basic checks, on by default: empty cues, duration, characters per second, line length,
      lines, overlaps and very short gaps, loose enough that ordinary captions pass. Lengths are
      counted in graphemes of the text a viewer reads. Checks wait until auto-captions are
      cleaned up ("Check anyway" runs them).
- [x] Rulesets: Netflix English (USA), adult and children's (General Requirements of
      2022-10-07, English guide of 2025-12-19, timing guidelines of 2025-07-04); Netflix English
      templates, adult and children's; BBC (March 2026); WCAG 2.2 (W3C Recommendation
      of 2024-12-12), limited to what a caption file can show. Each threshold was read from the
      supplied copies, and a test pins them.
- [x] Users can switch rules off and change settings per ruleset (Rules… dialog), kept in the
      browser, with a reset to the guide's values. New guides are added as rulesets (see
      `QUALITY-RULES.md`).
- [x] Netflix's Subtitle Timing Guidelines (2025-07-04): frame gaps (exactly 2 frames, or at
      least half a second) at the video's frame rate; and English subtitle templates (17/15
      characters per second, one line whenever it fits).
- [x] The Netflix Glyph List (version 2), generated into core as code-point ranges.
- [x] Netflix Finnish (subtitles and SDH, adult and children's; guide of 2025-12-19), with
      Kotus abbreviations and state body names.
- [ ] Later: shot-change timing (needs shot detection); more Netflix languages; the DCMP
      Captioning Key and FCC caption-quality rules; checks for speaker identification and sound
      descriptions.
- **Note on WCAG:** WCAG requires captions (1.2.2, 1.2.4) but sets few measurable values for
  them. The WCAG ruleset checks contrast of colours set in STYLE blocks (1.4.3), and says that
  passing it does not make captions accessible.

### Ongoing: text in any language and script

The editor should handle non-English and non-Latin text well: pick up language hints on import,
and process and render each script correctly. Done alongside the phases, not as one PR.

Done (2026-10-10):

- [x] Auto-caption cleanup keeps empty gaps between timed words empty, and joins caption lines
      without a space between Chinese or Japanese text (`script.ts`). Whitespace tidying (double
      spaces, doubled U+200B, which YouTube's machine translations carry) is on by default; a
      single U+200B between Thai or Khmer words is kept.
- [x] Lengths in graphemes in cleanup and the quality rules.
- [x] Sentence and clause ends in cleanup know CJK, Arabic and Devanagari punctuation, and
      closing brackets of any script. Rewrap breaks unspaced scripts at `Intl.Segmenter` word
      boundaries, keeping punctuation and Japanese hiragana endings with their word; Join adds no
      space between Chinese or Japanese lines. Words per minute counts segmenter words there.
- [x] `dir="auto"` on cue text in the editor, the table, the find bar and the cleanup preview.
      Invisible characters in a cue (direction marks, isolates, embeddings, zero-width
      characters) are listed under the text field and can be removed; an Insert mark menu adds
      RLM, LRM, ALM, an isolate around the selection, ZWSP or ZWNJ.
- [x] Language hints on import (`language.ts`): YouTube's `Language:` header, `<lang>` around
      every cue, or a registered language code in the file name (`talk.fi.vtt`,
      `talk.en-orig.vtt`). The hint sets `lang` on the text fields; a Language field shows where
      it came from and takes any BCP 47 tag; it is kept with autosaves.
- [x] Without a hint, a guess, offered in a banner and applied only if accepted. It is made only
      when one script dominates and the script (kana, Hangul, Thai, Hebrew, Greek…),
      distinguishing letters (Ukrainian, Persian, Urdu, Kazakh…) or common function words (Latin
      script, Devanagari) point clearly to one language. Close pairs (Danish and Norwegian, Czech
      and Slovak) and minority Turkic Cyrillic get no guess. Simplified and traditional Chinese
      are told apart by common characters.
- [x] Rulesets name their language; a mismatch with the text's language is pointed out in the
      Style and accessibility panel, with the fitting ruleset offered (Finnish today).
- [x] Find matches NFC and NFD forms of a plain query, and whole-word search treats combining
      marks as part of the word.
- [x] Encodings: Windows-1257, Windows-1258, KOI8-R, KOI8-U and EUC-JP added. A file that is not
      UTF-8 is read in the legacy encoding whose text has the most common words of its languages,
      not always Windows-1252.
- [x] Fixtures in Japanese, Chinese, Korean, Arabic, Hebrew, Hindi and Thai
      (`packages/core/test/fixtures/multilingual/`) through import, validation, export, language
      hints, split and every ruleset; e2e tests for the language field, the guess, direction marks,
      the ruleset suggestion and normalized find.

Still open:

- [x] Checked the cleanup on real YouTube Japanese and Korean machine translations (private
      fixtures). Fixed what they showed: lines held over for seconds above an empty line were read
      as new lines (doubled text); a line starting with the previous sentence's punctuation got a
      space before it; spaces after `。` and between Japanese characters were kept; lines and cues
      broke inside words split over timed pieces (`わから` + `ない`, Korean `헤드` + `라인`), and a
      pause in the source's timing could part them; untimed Japanese lines could not be wrapped.
      Translated tracks now also break at sentence ends inside YouTube's lines, which helped the
      Finnish translations too (no more first word of the next sentence left at a cue's end).
- [ ] Confirm the cleanup on a Chinese auto-caption file, and on a speech-recognition (not
      translated) Japanese one.
- [x] Netflix rulesets for Chinese (Simplified and Traditional), Japanese and Korean, with their
      SDH and children's variants: 16 characters per line for Chinese and Korean, 13 (vertical 11)
      for Japanese, half-width characters counting half in Japanese and Korean, and each guide's
      reading speed, punctuation, numbers and Latin-letter rules (`rules-cjk.ts`). Traditional
      Chinese text (`zh-TW`, `zh-Hant`) is offered the Traditional rules.
- [x] Auto-caption cleanup starts from the chosen style ruleset's line limits when it follows a
      guide for the text's language (with the user's changes; at most two lines), else from the
      language (13 for Japanese, 16 for Chinese and Korean, half-width counting half in Japanese
      and Korean), else 42; the dialog says where they came from. A caption line too long for
      one cue at those limits breaks between its words, an untimed one at estimated times; when
      choosing cues, punctuation no longer runs over the limit.
- [ ] Case-insensitive find follows JavaScript's simple case folding: Turkish `İ`/`ı` and German
      `ß`/`SS` do not match each other. Document in the help, or fold by the editor's language.
- [ ] Guess more Latin-script languages (Croatian, Serbian and Bosnian; Malay; Slovenian…), which
      need more than function words to tell apart.
- [ ] Optional, may be dropped: spell check beyond the browser's own. The browser checks
      with the dictionaries the user has, guided by `lang`; anything more means dictionaries
      fetched on demand (never bundled) and a license check per dictionary.

### Phase 6: Spec renderer and full feature coverage

**6a: spec renderer** (done 2026-10-11):

- [x] A renderer that follows §7 and §8: cue boxes from the settings, snap-to-lines placement,
      overlap avoidance for percentage lines, regions (6vh lines, anchors), vertical
      cues, the §7.4 defaults, and `::cue`, `::cue()`, `::cue-region` with `:past` and `:future`.
      Only the properties §8 allows are kept, and STYLE blocks apply to their own track and win
      over the page's rules. Layout math is in core (`render.ts`, `cue-css.ts`); the DOM part is
      `apps/web/src/lib/render/renderer.ts`.
- [x] Drawn over the picture in the media panel (fitted to the letterboxed video), by default;
      "Browser renderer" shows the browser's own instead, to compare. The choice is kept in the
      browser.
- [x] WPT's rendering reftests (vendored by `scripts/sync-wpt.sh`) run against it in Chromium:
      234 tests are drawn and compared pixel by pixel, and 19 that drive the media element are
      skipped. 167 match as they are. Where a reference contradicts the spec, the test is listed
      in `apps/web/e2e/wpt-rendering-expectations.ts` with its reason: 33 expected failures, and
      32 with one stated adjustment (such as a region drawn without its background) that must
      then match. Two more differ only between Chromium versions (sub-pixel rounding) and have
      a stated tolerance. See `SPEC-NOTES.md`.

Next, in this order (owner, 2026-10-11):

- **6b: format seam with SRT**, moved up from Phase 8 (see there), before the rich editor, so
  that the cue-text editor is built on the seam. Two PRs (owner, 2026-10-11):
  - [x] The seam, with no visible change. `packages/core/src/format/` describes each format
        (`SubtitleFormat`: name, extensions, MIME type, which cue settings it has, how its
        files are recognised) and its cue text (`TextDialect`: its markup as a pattern, the text
        a viewer reads, display text, italics, splitting, word timings). Splitting, merging and
        retiming, the quality rules (measuring and their fixes), find and the glossary, the cue
        table and timeline, split offsets, the cue editor's settings panel and file pickers go
        through it; the editor and autosave record the document's format. Tests run the shared
        code with a second, brace-tag dialect. WebVTT is the only format.
  - [x] SRT (2026-10-11), built on synthetic files (`packages/core/test/fixtures/srt/`)
        while real ones are gathered:
    - Import reads what players read: blocks with no number or no blank line before them,
      loose times (`0:00:01.5`, a full stop for the comma), box coordinates after the times, and
      legacy encodings (detected as for WebVTT). Lines it cannot read are left out and
      reported; codes `srt-…` in `DIAGNOSTICS.md`. SubRip files are recognised by their
      content first, so one named `.vtt` opens as SubRip.
    - Its dialect: `<b>` `<i>` `<u>` `<s>` `<font>` and brace blocks (`{\an8}`, `{\i1}`);
      `&` and a stray `<` are text. Splitting closes and reopens spans and keeps the position.
      The cue editor's one setting, Position, writes `{\an1}`–`{\an9}`. No cue ids.
    - Export keeps the file's line endings and BOM, numbers cues from 1, writes times
      HH:MM:SS,mmm, leaves out blank lines and "-->" in text (listed), and writes UTF-8, or
      the file's own encoding when chosen and every character fits (`encodeText`, checked by
      reading back).
    - Either format exports as the other (`srtToVtt`, `vttToSrt`), with a list of what was
      left out or flattened (strikethrough, voices, ruby, word timings, regions, styles other
      than colours…); colours become classes and a STYLE block, and `{\anN}` becomes line
      and alignment settings, and back. SubRip is previewed through its WebVTT conversion.
    - Auto-caption cleanup stays WebVTT-only (it writes WebVTT word timings).
  - [ ] Check the import against real SubRip files from the owner (kept in
        `tests/private-fixtures/`), and fix what they show.
- [x] **6c: cue settings and regions editors** (2026-10-11):
  - The cue editor's Settings panel has every WebVTT setting (line and its alignment, position
    and its alignment, alignment, size, writing direction, region), with values checked as they
    are typed. "Place" buttons set the cue at the top, in the middle or at the bottom, and
    "Reset all" removes every setting. A preview draws the selected cue with the spec renderer,
    with or without media. When several cues are selected, a change applies to all of them
    (one undo step) unless "Apply to all" is unticked. The summary lists the settings that differ
    from the defaults. SubRip keeps its one setting, Position.
  - A Regions dialog (from the Region setting's "Edit…") adds, changes and deletes regions: id,
    width, lines, region and viewport anchors, scroll. A frame shows where each region is.
    Renaming a region renames it in its cues; deleting one used by cues asks first and leaves
    them in no region. Values are checked as VTTRegion checks them. Core: `addRegion`,
    `updateRegion`, `deleteRegion`, `regionIdProblem`, `regionUse`, `CUE_PLACEMENTS`,
    `DEFAULT_CUE_SETTINGS`.
  - The spec renderer now measures boxes from its container's padding box, so a bordered
    container no longer pushes cues out of the area.
- [x] **6d: STYLE block editor** (2026-10-11):
  - A Styles dialog (toolbar "Styles…", WebVTT only: `SubtitleFormat.styleSheets`) lists the
    STYLE blocks with their rule counts, and adds, edits and deletes them. Typing in a block is
    one undo step. Problems show as you type, with their line (click to select it): CSS syntax,
    rules that select no cue, properties cues ignore, and the blank lines and `-->` that export
    removes. "Add a rule for" starts a rule for every cue, `i`, `b`, `:future`, `::cue-region`,
    and each class, voice and language the cues use, placed after the rule the caret is in. A
    preview draws the selected (or first) cue with the styles.
  - Core: `addStyle`, `updateStyle`, `deleteStyle`, `styleSheetProblems`, `cueSelectors`,
    `ruleTemplates`, `NEW_STYLE_SHEET`.
- [x] **6e: rich cue-text editing** (2026-10-11). The owner chose markup tools over a
      formatted (WYSIWYG) editor: the text field stays the source, so markup the tools do not touch
      is kept exactly as written.
  - A toolbar over the cue text: italic, bold, underline (Ctrl/⌘+I, B, U; strikethrough too in
    SubRip) turn a span on or off for the selection, taking just the selection out of a span it
    is in (`<i>a|b|c</i>` → `<i>a</i>b<i>c</i>`). WebVTT adds Class…, Voice…, Language… and
    Ruby…, with checked values and suggestions from what the file uses. Clear removes the spans
    in the selection (all of them with no selection), keeping word timings. A selection is grown
    so new markup never crosses a span, and never splits a tag, a character reference or a
    SubRip override block; ruby text stays directly inside its ruby.
  - A breadcrumb under the text lists the spans at the cursor (e.g. Voice Bob › Italic): click
    one to select its text, × to remove it (its text stays; ruby text goes with its ruby).
  - Word timing (WebVTT): the cue's timestamps, each with the word it starts, editable, with
    checks (inside the cue, after the one before); insert one at the cursor (at the playhead, or
    halfway between its neighbours without media); spread the cue over its words by their length;
    remove all; and tap timing: play the cue and tap (Space on the Tap button) as each word
    starts. Words are found with `Intl.Segmenter`, so unspaced scripts are timed by word too.
  - Core (`markup.ts`): `markupSpans`, `spansAt`, `wellFormedRange`, `wrapRange`, `unwrapRange`,
    `removeSpan`, `clearMarkup`, `spanTags`, `classProblem`, `languageProblem`,
    `timestampTags`, `setTimestamp`, `removeTimestamp(s)`, `insertTimestamp`,
    `timestampProblems`, `cueWords`, `timeWords`, `spreadWordTimes`.
- [x] **6f: chapters and metadata modes** (2026-10-11):
  - The file type (captions, chapters, metadata, any) is chosen in the toolbar ("Type", WebVTT
    only) as well as in Export, and the editor follows it. A file opens as captions; when its
    name says chapters or metadata, every payload is JSON, or its cues look like chapters (long,
    one-line titles that follow each other), a banner offers the other type. Opening another file
    resets the type; autosave keeps it.
  - Chapters and metadata get no markup tools, word timing, cue settings, caption overlay or
    style rules (those are for caption text). The validator's chapter rules apply as before.
  - Chapters: the cue field is the title; a Chapters panel shows the outline (nested chapters
    indented, crossing ones flagged), adds a chapter at the playhead (splitting the chapter
    there) or after the last one, makes the top-level chapters continuous (first from 0:00, the
    last to the media's end), imports a chapter list ("0:00 Intro" lines, time before or after
    the title) and copies the chapters out as one, with what YouTube would object to. The
    chapter at the playhead shows over the media.
  - Metadata: the payload field is monospace without spell check; a JSON payload is checked as
    you type, and Format / One line rewrite it with "-->" inside strings as "--\u003e". Blank
    lines and "-->" are flagged.
  - The side column scrolls when the media and panels do not fit, and each panel keeps a
    minimum height (with media open, panels could shrink to nothing under the timeline).
  - Core: `chapterOutline`, `splitChapterAt`, `makeChaptersContinuous`, `parseChapterList`,
    `chaptersFromList`, `chapterList`, `formatListTime`, `chapterTitleText` (`chapters.ts`);
    `looksLikeJson`, `jsonProblem`, `formatJson`, `metadataPayloadProblems`, `guessFileType`
    (`metadata.ts`).
- [x] **6g: scroll-up animation** (2026-10-11): lines in a `scroll:up` region slide up over
      0.433s as a new line comes in (§7.2), in the spec renderer, while playing on; not when seeking
      or for viewers who prefer reduced motion. See `SPEC-NOTES.md`.
- Renderer reference results on Firefox and WebKit: the WPT harness runs there with
  `WPT_ALL_BROWSERS=1`; their differences are still to be reviewed and recorded.

### Phase 7: Packaging, hosting and polish

- Single-file build. Hosted PWA (precache, install, file handling where supported), published
  once the owner is confident in quality. i18n-ready strings, an accessibility audit (keyboard and
  screen reader), dark mode, and a performance pass against the targets.

### Phase 8: Converters

- **Format seam** (with SRT; moved up to Phase 6b): split `packages/core` into what is common to every format (cue
  list, timing, undo, find, timeline, the 5c quality rules) and what each format supplies: its
  text dialect (parse markup, plain text, visible length, split at a position, tags skipped by
  find), its settings, its validator or linter, its serializer, and the cue editor's settings
  panel. Each format is then edited natively, not converted to WebVTT and back. Auto-caption
  cleanup and the export compatibility options stay WebVTT-only.
- **SRT** (done in Phase 6b): native editing on the seam, keeping SRT's own conventions (numbering, `<font>`,
  `{\an8}`). Import with encoding detection (SRT is often Windows-1252 or similar, unlike `.vtt`)
  and its common quirks (comma decimal separator); conversion to and from WebVTT with the features
  the other lacks flattened and a report of what was lost.
- **ASS/SSA** (after SRT): lossless round-trip. Opening a file, editing timing and text, and
  saving changes nothing else: `[Script Info]`, styles, `[Fonts]`, `[Graphics]`, unknown
  sections, comment lines and field order are kept as found, and `{\...}` override blocks are
  kept byte for byte as opaque tokens (skipped by find and length, carried correctly by split and
  merge). Conversion to WebVTT maps what maps (`\i` `\b` `\u`, `\N`, actor to `<v>`, `\k` to
  timestamp tags, `\an` to settings, styles to `::cue` classes) and reports typesetting it drops.
  Out of scope: a styles editor, per-line layer/margin/effect editing beyond plain fields, an
  override-tag helper, and a libass preview; those belong in a dedicated ASS editor.
- **SCC** (long-term): Scenarist files carry CEA-608 byte pairs with 29.97 fps (drop-frame)
  timecode. Import needs a 608 decoder (pop-on, roll-up and paint-on modes, the 608 character
  set, 15 rows × 32 columns). Export is _constrained_: line breaking to 32 columns, character
  mapping, and timing that accounts for 608's two-bytes-per-frame bandwidth, so long captions have
  to be loaded early. The CTA-608 standard is paywalled, so the work will lean on open references and
  sample files: the owner suggests McPoodle's SCC format notes
  (<https://theneitherworld.com/mcpoodle/SCC_TOOLS/DOCS/SCC_FORMAT.HTML>), to be read and checked
  against sample files when the work starts. Expect this to be the largest converter.

## Decisions log

- **2026-10-06:** File-size target: the 85th percentile of YouTube video lengths, to be tuned. Caption
  files are cheap, so we size for YouTube's 12 h maximum (see Sizing). The hosted PWA is planned for
  after quality is established. Auto-caption cleanup and the timeline (Phases 4 and 5) come before the
  spec renderer (Phase 6), because they are the primary use case and YouTube ignores most
  positioning and styling anyway. Native `<track>` preview covers the time in between.

- **2026-10-06:** Three real auto-caption samples received (see Sizing and `SPEC-NOTES.md`). They
  stay local in the gitignored `tests/private-fixtures/` because they are third-party transcripts and
  the repo will eventually be public. A synthetic fixture with the same structure is committed.
- **2026-10-06:** Waveform for long media is feature-detected (`AudioDecoder` plus codec support),
  so Safari 26+ gets it. Older Safari gets the timeline without a waveform.
- **2026-10-06:** Seven more samples (four `en-orig`, three `fi` auto-translations). They raised the
  12 h estimate to about 44k cues / 7 MB, and showed that translated tracks have interpolated word
  timings (see Primary workflow).
- **2026-10-06:** The core library uses only erasable TypeScript syntax (`erasableSyntaxOnly`), so
  it runs directly in Node with no build step (benchmarks, a future CLI).
- **2026-10-06 (Phase 3a):** Themes: System, GitHub Light, Solarized Light, Catppuccin Latte,
  Dracula, One Dark, Nord (all MIT). System uses GitHub Light or Dracula. Where an official color
  fails WCAG AA in the role we use it for, it is shifted toward black or white by the smallest
  step that passes, keeping its hue; each adjustment is marked in `apps/web/src/lib/themes.ts`.
- **2026-10-06 (Phase 2):** Export decisions. A cue whose end is not after its start gets
  end = start + 1 ms. Text the parser ignores (header lines, stray blocks, STYLE/REGION after the
  first cue, cues with broken timings) is kept as a NOTE comment rather than dropped or moved.
  Values that cannot be written are converted to the setting that renders the same where one
  exists (`line` auto or out of range with `snapToLines` false → `line:100%`), otherwise
  dropped and reported. Overlapping chapters are trimmed to end where the next one starts.
- **2026-10-06 (Phase 2):** Validation scope. BCP 47 tags are checked for well-formedness, not
  against the IANA registry. STYLE blocks are checked at the CSS-syntax level plus §8's
  selector and property rules; property values are not validated.
- **2026-10-06:** Formats: WebVTT primary, SRT next, SCC long-term.
- **2026-10-06:** Export always fixes non-conforming or invalid input (no "keep errors as they were"
  mode). That removes the lossless CST: the model plus source spans is enough.

- **2026-10-06:** Video-length percentiles from tubestats.io (see Sizing): median about 4 min,
  85th percentile about 30 min, 99th about 2.3–4.5 h. The 12 h design target stands; the data
  matters for the waveform fallback's duration cap in Phase 5.
- **2026-10-06 (Phase 3b):** Shortcuts are single keys outside text fields (media-player
  conventions: Space/K, J/L) and the same physical keys with Alt anywhere; Alt shortcuts use
  `event.code` because Option changes the typed character on macOS.
- **2026-10-06 (Phase 3b):** The caption preview uses the browser's renderer until Phase 6.
  Browsers parse a track on the main thread (about 0.3 s for 12 h), so above 2,000 cues the
  preview holds only the cues from 1 minute before to 5 minutes after the playhead and follows it.
- **2026-10-06 (Phase 3b):** Autosave is one slot per browser profile (two files written in
  turn, so a crash mid-write keeps the previous save). Two tabs editing at once overwrite each
  other's autosave; the files themselves are unaffected. It stores the document model as JSON,
  not WebVTT text, so a restore is exact even for content export would repair.
- **2026-10-06 (Phase 3b):** Times from the media element are rounded to whole milliseconds
  before they reach the document (`currentTime × 1000` is rarely an integer).

- **2026-10-06 (Phase 3c):** The "mirror the model into native `VTTCue`" check compares parsers
  rather than constructing `VTTCue`s by hand: the same bytes go to the browser and to us. That
  also covers export, since exported fuzz documents are among the inputs. Known browser
  deviations are described by what triggers them (not by test-case name), so a new kind of
  difference still fails.
- **2026-10-06 (Phase 3c):** Every engine misreads some valid files we may export (see
  `SPEC-NOTES.md`): Chromium drops non-default line/position alignments, Firefox ends cues at
  whitespace-only lines and ignores regions after a comment, and all three drop some cue ids
  starting with block keywords. Export keeps writing the spec form. Working around browsers
  in the output (for example dropping whitespace-only lines, or writing preserved header text
  after the REGION blocks) is left for a possible "compatibility" export option; the
  whitespace-only lines also go away in Phase 4's auto-caption cleanup.

- **2026-10-07 (Phase 4a):** Cleanup acceptance is measured against the de-rolled lines, which
  are in turn checked against YouTube's own repetitions: every line YouTube re-shows in a hand-off
  cue appears in order among them. Neither repetition alone is a complete transcript (YouTube
  writes no hand-off after an untimed line followed by a screen clear), so no oracle simpler than
  the growing cues exists.
- **2026-10-07 (Phase 4a):** Cue times come only from word times: a cue starts at its first word
  group's start and ends at its last group's end (a group lasts until the next word, so YouTube's
  continuous roll-up timing carries over). Cues are never stretched into silence, so the
  acceptance criterion holds literally; holding short cues longer is left to the user.

- **2026-10-07 (Phase 4c):** Compatibility fixes run after repair, so they can rely on valid
  cue text and see the comment repair keeps for header text. Only fixes that leave what a
  conforming player shows unchanged are on by default; the rest change layout, language
  information or styling and stay opt-in, labelled as such. Duplicate cues (which ffmpeg drops)
  get no option: removing them would change what conforming players show.
- **2026-10-07 (Phase 4c):** YouTube's support table comes only from uploading the test file,
  not from memory or third-party reports. The YouTube fixes are not on by default, because
  trimming space-only lines and removing STYLE/REGION blocks change what conforming players
  show; the export dialog offers them in one click when a file needs them. A space-only line
  loses text on YouTube, so YouTube's own auto-caption downloads (which have one in most cues)
  may lose text when re-uploaded as they are; the auto-caption cleanup already removes them.

- **2026-10-07 (Phase 4c, owner):** Export for YouTube only aims at what YouTube Studio rejects
  on upload. How YouTube's players then draw what it accepted (ignored sizes, positions,
  styles, the mobile app's missing bold) is left to YouTube: the export dialog lists it as
  information, but no fix targets it. A test keeps every YouTube fix tied to an upload error.

- **2026-10-07 (Phase 4c, owner):** Diverge from the spec to recover old-draft setting names
  (`middle`, and `start`/`end` as position alignments) on import, because YouTube's own WebVTT
  uses them and YouTube captions are what MicroVTT will edit most. Only `importDocument` does
  it (`legacyValues`); `parse` stays spec-exact for the conformance and browser tests. The
  validator reports the old names and export writes the new ones, so output still conforms.

- **2026-10-07 (owner):** The editor should serve as many subtitle-editing uses as is
  reasonable, including updating files written to older drafts or by other tools, even though
  the owner's main use is YouTube. Recovering such input is planned as Phase 4d.

- **2026-10-07 (Phase 5a):** Media is demuxed with Mediabunny (MPL-2.0, used unmodified as a
  dependency of the web app; `packages/core` stays dependency-free). Writing MP4 and WebM/MKV
  demuxers ourselves was the alternative; Mediabunny also covers MP3, WAV, Ogg and FLAC, reads a
  `File` in chunks, and decodes PCM itself, so WAV gets a waveform even without WebCodecs.
- **2026-10-07 (Phase 5a):** The waveform is drawn scaled to the file's loudest point (at most
  16× gain), not the view's, so scrolling never rescales it and quiet recordings stay readable.
- **2026-10-07 (Phase 5a):** The `decodeAudioData` fallback is capped at 10 minutes, set by
  measurement: it decodes at the codec's own rate whatever rate is asked for (1.39 GB for an hour
  of mono Opus in Chromium).

- **2026-10-08 (owner):** The editor should handle arbitrary non-English and non-Latin scripts:
  pick up language hints on import, and process and render them correctly. The text fields'
  language changes only on an explicit marker; a confident guess without one leads to a
  question, never a silent switch. Spell check beyond the browser's own is welcome if it stays
  small and unintrusive, but may be dropped.

- **2026-10-10 (owner):** Style and accessibility rules (Netflix, BBC, WCAG and the like) are
  their own category, independent of the format's errors and warnings, with a lite default set
  and stricter profiles to switch on. Planned as Phase 5c.

- **2026-10-10 (owner):** Phase 8 builds a format seam with SRT, so each format is edited
  natively. ASS/SSA gets lossless round-trip support (everything not edited is kept as found);
  a styles editor, typesetting tools and a libass preview are left to a dedicated ASS editor.

- **2026-10-10 (Phase 5b):** Timeline drags keep the document in start order (sorting after
  each move, the selection following the cues), since an out-of-order cue is a conformance
  error. A shift that would put a cue before 0 is reduced, not clamped per cue, so cues keep
  their lengths and spacing.
- **2026-10-10 (Phase 5c):** One ruleset is active at a time (the guides disagree on ellipses,
  labels and gaps). Characters per second count spaces and punctuation but not line breaks; the
  guides do not define it. Style checks wait while a file looks like uncleaned auto-captions,
  since nearly every rolling cue fails them.
- **2026-10-10 (owner):** The 5c profiles target WCAG 2.2, the Netflix Timed Text Style Guide
  of 2025-12-19 and the BBC Subtitle Guidelines of March 2026, each limited to what the editor
  can reasonably detect.

- **2026-10-11 (owner):** The SRT format seam comes before the rich cue-text editor (Phase 6b).
- **2026-10-11 (owner):** SRT in two PRs, seam first. SRT saves keep the file's line endings and
  BOM, renumber, and write UTF-8 (the original encoding when every character fits). Its editable
  markup is `<b>` `<i>` `<u>` `<font color>` and `{\an1}`–`{\an9}`; other brace blocks are kept
  as found. The preview converts SRT to WebVTT for the spec renderer.
- **2026-10-11 (owner):** Chapters mode converts to and from chapter lists ("0:00 Intro");
  metadata mode understands JSON payloads; the file type is guessed on open and offered, never
  switched without asking.
- **2026-10-11 (owner):** Rich cue-text editing is markup tools over the raw text field (with a
  breadcrumb of the spans at the cursor), not a formatted editor. Word timing includes editing,
  spreading and tap timing in the same PR.
- **2026-10-11 (Phase 6a):** The spec renderer is the default preview: it draws the same in
  every browser and follows the spec where browsers differ. Where WPT's references contradict the
  spec, the spec wins, and each case is listed with its reason.

## Open questions for the owner

None at the moment.
