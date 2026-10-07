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
      Lines are balanced, preferring punctuation. Translated tracks break only between YouTube's lines by default (their word
      times are guesses); breaking between words is an option.
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

### Phase 5: Timeline and productivity

- Canvas timeline with a streamed waveform (WebCodecs, cached peaks), drag to retime, snapping
  (word timings, cue edges), global shift and scale (resync), frame stepping, reading-speed and
  line-length QC checks (configurable, separate from conformance diagnostics), and bulk operations.
- **Accept:** a 12 h media file shows a waveform (where `AudioDecoder` exists) without memory
  growing in proportion to the media's length.

### Phase 6: Spec renderer and full feature coverage

- §7 renderer overlay (positioning, snap-to-lines, regions, roll-up, `::cue` styling, `:past` and
  `:future`), plus a toggle to compare with native rendering.
- Editors for cue settings, regions and STYLE blocks. A rich cue-text editor for spans, voices,
  ruby, lang, and karaoke timestamps.
- Chapters and metadata file modes.
- Renderer reference screenshots on Chromium, Firefox and WebKit.

### Phase 7: Packaging, hosting and polish

- Single-file build. Hosted PWA (precache, install, file handling where supported), published
  once the owner is confident in quality. i18n-ready strings, an accessibility audit (keyboard and
  screen reader), dark mode, and a performance pass against the targets.

### Phase 8: Converters

- **SRT** (next): import with encoding detection (SRT is often Windows-1252 or similar, unlike `.vtt`)
  and its common quirks (comma decimal separator, `<font>` tags, numbering); export with the
  WebVTT-only features flattened and a report of what was lost.
- **SCC** (long-term): Scenarist files carry CEA-608 byte pairs with 29.97 fps (drop-frame)
  timecode. Import needs a 608 decoder (pop-on, roll-up and paint-on modes, the 608 character
  set, 15 rows × 32 columns). Export is _constrained_: line breaking to 32 columns, character
  mapping, and timing that accounts for 608's two-bytes-per-frame bandwidth, so long captions have
  to be loaded early. The CTA-608 standard is paywalled, so the work will lean on open references and
  sample files. Expect this to be the largest converter.

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

## Open questions for the owner

None at the moment.
