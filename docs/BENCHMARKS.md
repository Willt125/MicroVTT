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

Recorded 2026-10-06, Node v22.22.0 (V8) in the development container:

| Input                          |     Size |    Cues |    Parse | Throughput | Cue text (all cues) | Retained heap |
| ------------------------------ | -------: | ------: | -------: | ---------: | ------------------: | ------------: |
| synthetic 10 min               |  0.10 MB |     606 |   3.5 ms |    28 MB/s |              3.2 ms |        0.3 MB |
| synthetic 1 h                  |  0.60 MB |   3,636 |   8.4 ms |    71 MB/s |             10.4 ms |        1.8 MB |
| synthetic 12 h                 |  7.19 MB |  43,632 | 100.3 ms |    72 MB/s |            141.8 ms |       14.4 MB |
| synthetic 100k cues            | 16.47 MB | 100,000 | 246.1 ms |    67 MB/s |            323.5 ms |       28.6 MB |
| synthetic 50 MB                | 50.08 MB | 304,000 | 744.2 ms |    67 MB/s |           1094.3 ms |      100.3 MB |
| real autocaption-05m48s.vtt    |  0.05 MB |     289 |   0.9 ms |    55 MB/s |              2.0 ms |        0.1 MB |
| real autocaption-09m21s.fi.vtt |  0.08 MB |     541 |   1.4 ms |    58 MB/s |              1.3 ms |        0.3 MB |
| real autocaption-09m21s.vtt    |  0.09 MB |     545 |   1.3 ms |    67 MB/s |              1.7 ms |        0.2 MB |
| real autocaption-11m09s.fi.vtt |  0.09 MB |     607 |   4.1 ms |    22 MB/s |              1.3 ms |        0.3 MB |
| real autocaption-11m09s.vtt    |  0.10 MB |     619 |   1.3 ms |    78 MB/s |              1.8 ms |        0.3 MB |
| real autocaption-13m39s.vtt    |  0.13 MB |     825 |   1.6 ms |    82 MB/s |              2.1 ms |        0.4 MB |
| real autocaption-15m06s.fi.vtt |  0.13 MB |     872 |   2.0 ms |    64 MB/s |              2.1 ms |        0.5 MB |
| real autocaption-15m06s.vtt    |  0.14 MB |     887 |   3.0 ms |    47 MB/s |              4.2 ms |        0.4 MB |
| real autocaption-48m33s.vtt    |  0.36 MB |   2,427 |   8.2 ms |    44 MB/s |              5.6 ms |        1.1 MB |
| real autocaption-4h18m29s.vtt  |  2.02 MB |  12,263 |  25.0 ms |    81 MB/s |             35.9 ms |        4.0 MB |

Takeaways:

- **Fast enough for 12 hours:** the worst-case 12 h file parses in about 0.1 s, and building
  every cue's word tree takes about 0.15 s more. Both run in a Worker, so the UI stays responsive.
- **Linear scaling:** throughput is steady at roughly 65–80 MB/s from 1 h up to 50 MB.
- **Memory is modest:** retained memory is about 2× the file size (14 MB for 12 h).
- **Browsers will differ:** these are V8 numbers. Firefox and Safari need measuring in Phase 3,
  once the import path runs in a Worker in real browsers.
