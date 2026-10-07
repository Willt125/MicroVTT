# Benchmarks

Parser performance on auto-caption-shaped input. Reproduce with `pnpm bench`. The script is
`packages/core/bench/parse.bench.ts`. Real samples are included when `tests/private-fixtures/`
is present.

- **Parse:** bytes → `ParseResult` through `WebVTTByteParser`, fed in 64 KiB chunks as
  `File.stream()` would deliver them. Best of 5 runs.
- **Cue text (all cues):** `parseCueText` on every cue, which is the word-timing tree the
  auto-caption cleanup will need. Best of 5 runs.
- **Retained heap:** heap growth after one parse, with the result kept alive.
- **Synthetic files:** they follow the measured YouTube structure (a growing cue plus a 10 ms
  hand-off cue per line) at the fast-speech rate. The "12 h" row reproduces the worst case in
  PLAN.md's sizing table: 43.6k cues, 7.2 MB.

Recorded 2026-10-06, Node v24.21.0 (V8) in the development container:

| Input                          |     Size |    Cues |    Parse | Throughput | Cue text (all cues) | Retained heap |
| ------------------------------ | -------: | ------: | -------: | ---------: | ------------------: | ------------: |
| synthetic 10 min               |  0.10 MB |     606 |   1.8 ms |    56 MB/s |              2.5 ms |        0.3 MB |
| synthetic 1 h                  |  0.60 MB |   3,636 |  12.5 ms |    48 MB/s |             11.4 ms |        1.8 MB |
| synthetic 12 h                 |  7.19 MB |  43,632 |  98.8 ms |    73 MB/s |            128.5 ms |       14.3 MB |
| synthetic 100k cues            | 16.47 MB | 100,000 | 265.9 ms |    62 MB/s |            336.8 ms |       32.9 MB |
| synthetic 50 MB                | 50.08 MB | 304,000 | 758.4 ms |    66 MB/s |            983.1 ms |      100.4 MB |
| real autocaption-05m48s.vtt    |  0.05 MB |     289 |   1.5 ms |    32 MB/s |              1.7 ms |        0.1 MB |
| real autocaption-09m21s.fi.vtt |  0.08 MB |     541 |   1.3 ms |    62 MB/s |              1.3 ms |        0.3 MB |
| real autocaption-09m21s.vtt    |  0.09 MB |     545 |   1.2 ms |    74 MB/s |              1.6 ms |        0.3 MB |
| real autocaption-11m09s.fi.vtt |  0.09 MB |     607 |   1.6 ms |    54 MB/s |              1.3 ms |        0.4 MB |
| real autocaption-11m09s.vtt    |  0.10 MB |     619 |   1.2 ms |    82 MB/s |              1.9 ms |        0.3 MB |
| real autocaption-13m39s.vtt    |  0.13 MB |     825 |   1.6 ms |    83 MB/s |              2.5 ms |        0.4 MB |
| real autocaption-15m06s.fi.vtt |  0.13 MB |     872 |   2.0 ms |    64 MB/s |              2.1 ms |        0.5 MB |
| real autocaption-15m06s.vtt    |  0.14 MB |     887 |   2.3 ms |    62 MB/s |              4.9 ms |        0.4 MB |
| real autocaption-48m33s.vtt    |  0.36 MB |   2,427 |   7.7 ms |    47 MB/s |             11.0 ms |        1.1 MB |
| real autocaption-4h18m29s.vtt  |  2.02 MB |  12,263 |  23.2 ms |    87 MB/s |             39.0 ms |        4.0 MB |

Validation (`validate`) and export (`exportDocument`: repair, serialize, then validate the
output) on the larger inputs, best of 3:

| Input                         |    Cues | Validate | Export (repair + serialize + re-validate) |
| ----------------------------- | ------: | -------: | ----------------------------------------: |
| synthetic 1 h                 |   3,636 |    36 ms |                                     55 ms |
| synthetic 12 h                |  43,632 |   376 ms |                                    733 ms |
| synthetic 100k cues           | 100,000 |   851 ms |                                   1527 ms |
| real autocaption-4h18m29s.vtt |  12,263 |   123 ms |                                    204 ms |

Takeaways:

- **Fast enough for 12 hours:** the worst-case 12 h file parses in about 0.1 s, and building
  every cue's word tree takes about 0.15 s more. Validating it takes about 0.4 s and a full export
  about 0.7 s. All of this runs in a Worker, so the UI stays responsive.
- **Linear scaling:** throughput is steady at roughly 65–80 MB/s from 1 h up to 50 MB.
- **Memory is modest:** retained memory is about 2× the file size (14 MB for 12 h).
- **Browsers will differ:** these are V8 numbers. Firefox and Safari need measuring in Phase 3,
  once the import path runs in a Worker in real browsers.

## Editor (headless Chromium, Phase 3b)

The worst-case 12 h synthetic file (43,632 cues) with a 1-minute WebM open in the player, measured
with Playwright and a `longtask` observer:

| Step                                  | Result                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| Open media, build the caption preview | no long tasks (the preview holds about 300 cues)        |
| Type 18 characters, 40 ms apart       | 0.9 s (the typing itself is 0.72 s)                     |
| Autosave after the last keystroke     | about 2.2 s (1.5 s delay), one long task of about 0.2 s |
| Restore after a reload                | offer in about 0.3 s, document back in about 0.7 s      |
| Find "the" over every cue             | 50–100 ms, 77,351 matches                               |

The remaining 0.2 s task is most likely the validation round trip (copying the document to the
worker and taking the results back), which predates 3b; it is not profiled yet. Before the
preview was limited to a window around the playhead, every preview refresh cost about 0.3 s on
the main thread while Chromium parsed the full track.

## Auto-caption cleanup (Phase 4a, Node)

`cleanupAutoCaptions` on the real samples (detection, de-roll and segmentation together):

| Sample   | Cues in | Cues out |  Words | Time    |
| -------- | ------: | -------: | -----: | ------- |
| 5m48s    |     289 |       90 |    909 | ~50 ms  |
| 48m33s   |   2,427 |      786 |  6,905 | ~110 ms |
| 4h18m29s |  12,263 |    3,686 | 38,589 | ~0.9 s  |

Segmentation is most of it (the dynamic program re-checks line wrapping for each candidate cue).
It runs in the worker, so the UI stays responsive.
