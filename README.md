# MicroVTT

An offline, fully-featured, in-browser WebVTT editor.

Status: early development. See [docs/PLAN.md](docs/PLAN.md) for the roadmap and
[docs/SPEC-NOTES.md](docs/SPEC-NOTES.md) for the spec digest.

## Layout

| Path            | Contents                                                                            |
| --------------- | ----------------------------------------------------------------------------------- |
| `packages/core` | DOM-free WebVTT parser, validator, serializer and model (zero runtime deps)         |
| `apps/web`      | Svelte 5 + Vite editor UI                                                           |
| `tests/wpt`     | Vendored web-platform-tests WebVTT suites (3-Clause BSD)                            |
| `scripts/`      | `sync-wpt.sh` (refresh tests), `sync-spec.sh` (check out spec source into `.spec/`) |

## Development

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm dev         # run the editor
pnpm test        # unit + conformance tests
pnpm typecheck
pnpm lint
pnpm build
```
