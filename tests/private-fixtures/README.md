# Private fixtures

Real-world files used for local benchmarks and manual testing. Everything here except this README
is gitignored, because these files are third-party content and the repository will be public.

Tests that use them must skip cleanly when they are absent, as they are in CI.

Expected local files: YouTube auto-captions downloaded with `yt-dlp`. Files without a language
suffix are `.auto.en-orig.vtt` (speech recognition). `.fi.vtt` files are YouTube's machine
translation of the same video (`.auto.fi.vtt`).

| File                        | Duration | Size        | Cues   |
| --------------------------- | -------- | ----------- | ------ |
| `autocaption-05m48s.vtt`    | 5m48s    | 48,430 B    | 289    |
| `autocaption-09m21s.vtt`    | 9m21s    | 89,182 B    | 545    |
| `autocaption-09m21s.fi.vtt` | 9m21s    | 81,940 B    | 541    |
| `autocaption-11m09s.vtt`    | 11m09s   | 100,561 B   | 619    |
| `autocaption-11m09s.fi.vtt` | 11m09s   | 88,516 B    | 607    |
| `autocaption-13m39s.vtt`    | 13m39s   | 130,471 B   | 825    |
| `autocaption-15m06s.vtt`    | 15m06s   | 143,269 B   | 887    |
| `autocaption-15m06s.fi.vtt` | 15m06s   | 129,168 B   | 872    |
| `autocaption-48m33s.vtt`    | 48m33s   | 358,145 B   | 2,427  |
| `autocaption-4h18m29s.vtt`  | 4h18m29s | 2,024,901 B | 12,263 |

The structure these files share is documented in `docs/SPEC-NOTES.md` ("Auto-caption input")
and reproduced synthetically in `packages/core/test/fixtures/autocaption-sample.vtt`.
