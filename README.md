# MicroVTT

An offline, fully-featured, in-browser WebVTT editor.

Status: early development. The editor opens, validates, edits and exports WebVTT files entirely
in the browser (`pnpm dev`, then open the printed URL); media playback and timing tools come next. See [docs/PLAN.md](docs/PLAN.md) for the roadmap and
[docs/SPEC-NOTES.md](docs/SPEC-NOTES.md) for the spec digest, and
[docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md) for every conformance check and its export fix.

## Layout

| Path            | Contents                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/core` | DOM-free WebVTT parser, validator, repair, serializer, document model and edit operations (zero runtime deps) |
| `apps/web`      | Svelte 5 + Vite editor UI (themes, cue table, problems panel, export)                                         |
| `tests/wpt`     | Vendored web-platform-tests WebVTT suites (3-Clause BSD)                                                      |
| `scripts/`      | `sync-wpt.sh` (refresh tests), `sync-spec.sh` (check out spec source into `.spec/`)                           |

## Development

Requires Node 22+ (24 recommended, see `.nvmrc`) and pnpm 11.

```sh
pnpm install
pnpm dev         # run the editor
pnpm test        # unit + conformance tests
pnpm typecheck
pnpm lint
pnpm build
pnpm bench       # parser benchmarks (see docs/BENCHMARKS.md)
pnpm fuzz        # long differential/streaming fuzz run (CI runs a short one)
```
