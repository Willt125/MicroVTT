# MicroVTT

An offline, fully-featured, in-browser WebVTT editor.

Status: early development. The editor opens, validates, edits and exports WebVTT files entirely
in the browser (`pnpm dev`, then open the printed URL), and times cues against a local audio or
video file with keyboard shortcuts (press `?` in the app), on a timeline with the media's waveform
(streamed, so even 12-hour files draw without loading them into memory) where cues can be dragged
and snapped, stepping by video frames. Many cues can be shifted or resynced at once. Style and
accessibility checks follow a chosen guide (Netflix, BBC, WCAG 2.2, or loose defaults; see
[docs/QUALITY-RULES.md](docs/QUALITY-RULES.md)). YouTube auto-captions are detected
and can be cleaned up into readable cues (de-rolled and re-segmented, keeping word timings), with
a glossary for recurring corrections. Files written to older drafts or by other tools (SRT-style times, `<br>`, `<font>`, old
settings, non-UTF-8 encodings) open as they were meant. Export can work around players that
misread valid files
(browsers, ffmpeg, video.js, Shaka Player) and lists what YouTube may not keep. Autosave keeps
unsaved work in the browser. See [docs/PLAN.md](docs/PLAN.md) for the roadmap and
[docs/SPEC-NOTES.md](docs/SPEC-NOTES.md) for the spec digest, and
[docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md) for every conformance check and its export fix.

## Layout

| Path            | Contents                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `packages/core` | DOM-free WebVTT parser, validator, repair, serializer, document model and edit operations (zero runtime deps)     |
| `apps/web`      | Svelte 5 + Vite editor UI (cue table, media player, find/replace, problems panel, autosave, export, themes)       |
| `tests/wpt`     | Vendored web-platform-tests WebVTT suites (3-Clause BSD)                                                          |
| `scripts/`      | `sync-wpt.sh` (refresh tests), `sync-spec.sh` (check out spec source into `.spec/`), doc and test-file generators |

## Development

Requires Node 22+ (24 recommended, see `.nvmrc`) and pnpm 11.

```sh
pnpm install
pnpm dev         # run the editor
pnpm test        # unit + conformance tests
pnpm e2e         # browser tests (Playwright; run `pnpm --filter @microvtt/web exec playwright install` once)
pnpm typecheck
pnpm lint
pnpm build
pnpm bench       # parser benchmarks (see docs/BENCHMARKS.md)
pnpm fuzz        # long differential/streaming fuzz run (CI runs a short one)
```

### Editor setup (VS Code)

Open the repository folder and accept the recommended extensions (Svelte, ESLint, Prettier,
EditorConfig, Vitest, Playwright). The workspace settings use the repo's TypeScript, format with
Prettier and fix ESLint problems on save, and leave whitespace to `.editorconfig`, which keeps the
byte-exact test fixtures untouched. Vendored and generated files (`tests/wpt/`,
`docs/DIAGNOSTICS.md`, `docs/youtube-test*.vtt`) open read-only: change their sources and
regenerate. Tasks (`Terminal → Run Task`) cover dev, test, e2e, typecheck, lint, build and a
CI-order check; the debugger can launch the editor in Chrome or debug the open test file.
