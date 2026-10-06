# Private fixtures

Real-world files used for local benchmarks and manual testing. Everything here except this README
is gitignored, because these files are third-party content and the repository will be public.

Tests that use them must skip cleanly when they are absent, as they are in CI.

Expected local files (YouTube auto-captions downloaded with `yt-dlp`, `.auto.en-orig.vtt`):

| File                       | Duration | Size        | Cues   |
| -------------------------- | -------- | ----------- | ------ |
| `autocaption-05m48s.vtt`   | 5m48s    | 48,430 B    | 289    |
| `autocaption-48m33s.vtt`   | 48m33s   | 358,145 B   | 2,427  |
| `autocaption-4h18m29s.vtt` | 4h18m29s | 2,024,901 B | 12,263 |

The structure these files share is documented in `docs/SPEC-NOTES.md` ("Auto-caption input")
and reproduced synthetically in `packages/core/test/fixtures/autocaption-sample.vtt`.
