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
- **Import and export.** It reads and writes `.vtt` losslessly. Converters for other formats
  (SRT first) come later.
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
  cst                    lossless concrete syntax tree: blocks with source spans
  parse                  spec §6 parser → model + CST (incremental, chunk-fed)
  cuetext                spec §6.4 cue text tokenizer/tree builder + entity table
  model                  Document { header, styles[], regions[], cues[], comments[] }
  validate               spec §4 syntax checks → Diagnostic[] (code, severity, range, spec link)
  serialize              strict (always conforming) and preserve (round-trip) modes; streaming
  edit                   pure operations: shift/scale, split/merge, renumber IDs, sort, etc.
  autocaption            detect + de-roll + re-segment YouTube auto-captions, keeping word timings
  convert/*              SRT ↔ VTT first; others on demand
apps/web                 Svelte 5 SPA
  worker                 import/parse/validate/serialize off the main thread
  store                  document state, undo/redo (command log), autosave to OPFS; waveform-peak cache
  ui                     virtualized cue table, cue editor, settings inspectors, timeline/waveform
  media                  playback via object URLs; streamed WebCodecs waveform peaks
  render                 spec §7 renderer for the preview overlay; native <track> comparison mode
tests/wpt                vendored WPT webvtt suites (BSD-3), driven by core tests
```

Key decisions:

1. **Lossless CST under a semantic model.** Every block records its source span. Edits mark
   blocks dirty. Preserve-mode export re-emits clean blocks byte-for-byte and serializes dirty ones
   canonically. This is how we satisfy "may round-trip errors in unedited sections, must not
   claim conformance". The export dialog states whether the output is conformant.
2. **Parse ≠ validate.** The parser follows §6 exactly, as the WPT tests require. The validator
   checks §4 syntax on the CST. They never share leniency logic.
3. **Integer milliseconds** for all times. Conversion to float seconds happens only at the VTTCue boundary.
4. **Cue text stays a string in the model.** It is tokenized into a tree lazily, for
   validation, rendering, and the rich editor. That keeps memory per cue low.
5. **Everything heavy runs in a Worker.** The main thread only receives the visible window of
   rows plus summary data.

## Sizing

The requirement is to handle roughly the 85th percentile of YouTube video lengths, a number to
tune later. **We don't have a reliable source for that percentile, and it turns out not to matter
for the caption side.** Caption files are small compared with the media, so we can afford to size
for YouTube's maximum upload length of **12 hours** and cover every video.

**Measured** from three real auto-caption files (`yt-dlp`, `en-orig`):

| Sample   | Cues          | Timed words    | Size           | Per hour                  |
| -------- | ------------- | -------------- | -------------- | ------------------------- |
| 5m48s    | 289           | about 900      | 48 KB          | 2,969 cues, 497 KB        |
| 48m33s   | 2,427         | about 6.3k     | 358 KB         | 2,997 cues, 442 KB        |
| 4h18m29s | 12,263        | about 38k      | 2.0 MB         | 2,846 cues, 470 KB        |
| **12 h** | **about 36k** | **about 110k** | **about 6 MB** | extrapolated, YouTube max |

About half of the cues are 10 ms hand-off cues, so after the de-roll cleanup a 12 h document
holds roughly 18k caption lines. The earlier model (0.5–1 MB/h) was at the high end. Real files
come in at under 0.5 MB/h.

What this means for implementation:

- **The `.vtt` side is modest.** 60k cues is well within what plain JS objects, a Worker parser and
  a virtualized table handle. We drop the struct-of-arrays storage and OPFS text spill-over from
  the earlier plan: complexity with no payoff at this size.
- **Design targets:** smooth editing at **≤ 100k cues** (almost 3× the measured 12 h worst case).
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
    under a duration cap (to be set by measurement in Phase 5).
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
3. **Edit.** Correct text while the media plays: loop the current cue, slow playback, step word by
   word, and find/replace for names and terms the recognizer consistently gets wrong (with a saved
   glossary). Timing tools include drag on the waveform and snapping to word timings.
4. **Export.** Export a conforming, full-spec `.vtt`. Full-spec output is always the default and
   is never silently reduced, because other players and viewers support features YouTube doesn't. A
   "YouTube upload" check is an optional, warnings-only lint that lists features YouTube is likely
   to drop. It never strips anything. Which features YouTube actually honors needs testing
   against real uploads before we hard-code that list. SRT export arrives with the converters.

Conformance note: the auto-caption header (`WEBVTT` followed directly by `Kind: captions` and
`Language: en` lines) parses fine but is **not conforming syntax**, because the signature line must be
followed by a blank line. In strict export, MicroVTT moves those lines into a `NOTE` block, which is
conforming and keeps the information. Preserve mode keeps them as they are, with the output flagged
as non-conformant. See `SPEC-NOTES.md`.

The auto-caption format is documented from three real samples in `SPEC-NOTES.md`. YouTube has
changed it before, so the detector should key on structure rather than exact strings.

## Phased roadmap

Each phase ends green in CI with its acceptance criteria met.

### Phase 0: Repository and research (this change)

- [x] Gather sources: spec ED (pinned), WPT suites (vendored), MDN compat data.
- [x] Monorepo scaffold, TS/Svelte/Vite/Vitest/ESLint/Prettier, CI workflow.
- [x] Seed module (`timestamp`) with tests to prove the pipeline.
- [x] Measure real auto-caption samples (see Sizing).
- [ ] Decide the remaining open questions below.

### Phase 1: Core parser (spec §6)

- Decoder, incremental file parser, region settings, cue timings and settings, cue text
  tokenizer and tree builder, HTML entity table, chapter-title extraction.
- WPT harness: run all `file-parsing/*.test` and `cue-text-parsing/*.dat` in Vitest.
- **Accept:** 100% of the vendored WPT parsing tests pass. Differential fuzzing against
  `reference-parser.py` shows no divergences. Parse benchmarks are recorded for real and synthetic
  auto-caption files at 10 min, 1 h and 12 h (about 100k cues), confirming the sizing table.

### Phase 2: Model, validator, serializer

- Lossless CST, document model with VTTCue-compatible setter semantics (WPT `api/` tests).
- Validator covering every §4 rule, with stable diagnostic codes and spec links.
- Strict and preserve serializers. Edit operations.
- **Accept:** property tests for round-trip pass. Every syntax rule in §4 has a positive and a
  negative fixture. Exporting any parsed file in strict mode yields zero diagnostics.

### Phase 3: Editor UI MVP

- Open (picker, drag-and-drop, paste), virtualized cue table, inline time and text editing,
  add, delete, split and merge, undo/redo, find/replace, diagnostics panel with jump-to-error,
  export (download, plus in-place save in Chromium), autosave and restore from OPFS.
- Media: load a local audio or video file and preview it with native `<track>`. Loop the current
  cue and change the playback rate (essential for transcription work).
- Keyboard-first: set start/end at the playhead, nudge, step through cues.
- Playwright e2e on Chromium, Firefox and WebKit from here on.

### Phase 4: Auto-caption cleanup (primary use case)

- Auto-caption detection, de-roll, word-timing preservation, rule-based re-segmentation,
  glossary-driven find/replace, and the "YouTube-safe" export profile.
- **Accept:** cleanup of each real sample fixture yields a conforming file with no lost words, and
  every cue's timing stays within its source words' timing.

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

- SRT import and export (with encoding detection for non-UTF-8 SRT), then others by demand
  (SBV, TTML/IMSC subset, ASS/SSA text-only).

## Decisions log

- **2026-10-06:** File-size target: the 85th percentile of YouTube video lengths, to be tuned. Caption
  files are cheap, so we size for YouTube's 12 h maximum (see Sizing). The hosted PWA is planned for
  after quality is established. Auto-caption cleanup and the timeline (Phases 4 and 5) come before the
  spec renderer (Phase 6), because they are the primary use case and YouTube ignores most
  positioning and styling anyway. Native `<track>` preview covers the time in between.

- **2026-10-06:** Three real auto-caption samples received (see Sizing and `SPEC-NOTES.md`). They
  stay local in the gitignored `tests/private-fixtures/` because they are third-party transcripts and
  the repo will eventually be public. A synthetic fixture with the same structure is committed.
- **2026-10-06:** "No waveform for long video on Safari ≤ 26." Implemented as feature detection
  (above). Note: MDN data says Safari 26 _added_ `AudioDecoder`, so with feature detection Safari 26
  will get the streamed waveform if its decoder supports the file's codec. Pinning Safari 26 to
  "no waveform" would need user-agent sniffing. Not planned unless testing shows Safari 26's
  decoder misbehaves.

## Open questions for the owner

1. **Converters:** which formats beyond SRT matter, and how early? (YouTube accepts `.vtt`
   directly, so this may be low priority.)
2. **Non-conformant export:** should preserve mode be the default when editing an imported file
   (minimal diffs), or should strict mode be the default (always conforming)? The spec allows either.
   Strict is the safer default for a tool that advertises compliance.
