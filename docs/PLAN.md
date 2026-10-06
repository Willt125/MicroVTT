# MicroVTT plan

## Goal

MicroVTT is an offline, in-browser WebVTT editor with these properties:

- **100% standards-compliant.** It meets the spec's _authoring tool_ and _conformance checker_
  requirements, and its preview renders according to the spec's own rendering rules (see
  `SPEC-NOTES.md`). We measure compliance with the vendored web-platform-tests suites plus our
  own spec-derived tests, so "compliant" is something CI checks rather than something we assert.
- **Fully offline.** It makes no network requests at runtime. It can be installed as a PWA and also
  ships as a single self-contained `.html` file that works from `file://`.
- **Import and export.** It reads and writes `.vtt` losslessly. Converters for other formats
  (SRT first) come later.
- **Large files.** It stays responsive at 100k cues and keeps working up to the limits below.
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
| Offline packaging | `vite-plugin-pwa` (Workbox precache) and `vite-plugin-singlefile`                                                    | Two build targets from one codebase, added in Phase 6.                                                                                                                                                           |
| CI                | GitHub Actions                                                                                                       | lint → typecheck → test → build. Playwright cross-browser runs join in Phase 4.                                                                                                                                  |
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
  convert/*              SRT ↔ VTT first; others on demand
apps/web                 Svelte 5 SPA
  worker                 import/parse/validate/serialize off the main thread
  store                  document state, undo/redo (command log), autosave to OPFS
  ui                     virtualized cue table, cue editor, settings inspectors, timeline/waveform
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

## Large-file strategy and limits

- Import: `File.stream()` → `TextDecoderStream` → incremental parser in a Worker, with progress
  reporting and cancellation. The UI becomes usable as soon as the first chunk has been parsed.
- Storage: cues use struct-of-arrays (typed arrays for times and settings, a string table for text
  and IDs) once a document exceeds a threshold. Above a higher threshold, cue text spills to OPFS.
- UI: a virtualized table with constant DOM size. The timeline draws to a canvas. Waveform peaks
  are computed in a worker and cached.
- Export: chunked serialization to a `Blob` (or a `FileSystemWritableFileStream` in Chromium)
  without building one giant string.
- **Initial targets, to be confirmed by Phase 1 benchmarks:** smooth editing at ≤ 100k cues;
  import, validation and export of ≤ 1M cues or ≤ 200 MB. Above those limits we warn but still try.
  Media files are never read into memory. They play through object URLs.

## Phased roadmap

Each phase ends green in CI with its acceptance criteria met.

### Phase 0: Repository and research (this change)

- [x] Gather sources: spec ED (pinned), WPT suites (vendored), MDN compat data.
- [x] Monorepo scaffold, TS/Svelte/Vite/Vitest/ESLint/Prettier, CI workflow.
- [x] Seed module (`timestamp`) with tests to prove the pipeline.
- [ ] Decide the open questions below.

### Phase 1: Core parser (spec §6)

- Decoder, incremental file parser, region settings, cue timings and settings, cue text
  tokenizer and tree builder, HTML entity table, chapter-title extraction.
- WPT harness: run all `file-parsing/*.test` and `cue-text-parsing/*.dat` in Vitest.
- **Accept:** 100% of the vendored WPT parsing tests pass. Differential fuzzing against
  `reference-parser.py` shows no divergences. Parse benchmarks are recorded for 10k, 100k and 1M cues.

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
- Media: load a local audio or video file and preview it with native `<track>`.
- Keyboard-first: set start/end at the playhead, nudge, step through cues.

### Phase 4: Spec renderer and full feature coverage

- §7 renderer overlay (positioning, snap-to-lines, regions, roll-up, `::cue` styling, `:past` and
  `:future`), plus a toggle to compare with native rendering.
- Editors for cue settings, regions and STYLE blocks. A rich cue-text editor for spans, voices,
  ruby, lang, and karaoke timestamps.
- Chapters and metadata file modes.
- Playwright e2e on Chromium, Firefox and WebKit. Renderer reference screenshots.

### Phase 5: Timeline and productivity

- Canvas timeline with waveform, drag to retime, snapping, global shift and scale (resync), frame
  stepping, reading-speed and line-length QC checks (configurable, separate from conformance
  diagnostics), and bulk operations.

### Phase 6: Offline packaging and polish

- PWA (precache, install, file handling where supported), single-file build, i18n-ready strings,
  accessibility audit (keyboard and screen reader), dark mode, performance pass against the targets.

### Phase 7: Converters

- SRT import and export (with encoding detection for non-UTF-8 SRT), then others by demand
  (SBV, TTML/IMSC subset, ASS/SSA text-only).

## Open questions for the owner

1. **Converters:** which formats beyond SRT matter, and how early?
2. **Distribution:** is a hosted PWA (for example on GitHub Pages) wanted in addition to the
   single-file build?
3. **Target limits:** are 100k cues for smooth editing and 1M cues / 200 MB as the hard ceiling acceptable?
4. **Non-conformant export:** should preserve mode be the default when editing an imported file
   (minimal diffs), or should strict mode be the default (always conforming)? The spec allows either.
   Strict is the safer default for a tool that advertises compliance.
