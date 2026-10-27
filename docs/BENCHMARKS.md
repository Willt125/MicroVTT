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

## Waveform (Phase 5a, headless Chromium)

Machine: 4-core Intel Xeon at 2.10 GHz (a cloud sandbox). Media from `scripts/long-media.sh`
(pink noise, mono Opus at 8 kbps). Memory is the resident memory of all browser processes,
sampled every 250 ms while the peaks are computed, from before the media is opened to the peak
(`apps/web/e2e/acceptance/waveform-memory.e2e.ts`, opt-in).

| Media | File size | Memory growth (peak) | Time to compute | Speed |
| ----- | --------: | -------------------: | --------------: | ----: |
| 1 h   |    3.5 MB |         118–207 MB\* |            16 s |  225× |
| 12 h  |     42 MB |               223 MB |           187 s |  230× |

\* Two runs; the variation is the browser's own (the decoder, the worker, the video element).

**Accepted:** memory does not grow with the media's length. Peaks are reduced from each decoded
chunk as it arrives and the chunk is released; the fine peaks (100 per second, 8.6 MB for 12 h)
are written to OPFS and read back a view at a time, and only a per-second overview (86 KB for
12 h) stays in memory. Reopening the same file reads the cached peaks: no decoding.

**The fallback is not streamed.** Where the browser cannot stream-decode a file (no WebCodecs
for its codec), `decodeAudioData` decodes it whole. Even when asked for 8 kHz it decodes at the
codec's own rate first, so its peak cost is large:

| Media (Opus)            | Memory growth (peak) |  Time |
| ----------------------- | -------------------: | ----: |
| 1 h mono, 16 kHz source |              1.39 GB | 8.9 s |
| 10 min stereo, 48 kHz   |               449 MB | 1.8 s |

About 45 MB per minute of stereo, so the fallback is capped at 10 minutes (about 450 MB at
worst); longer media without streamed decoding gets the timeline without a waveform.

## Shot detection (headless Chromium)

Same machine, no GPU, so video is decoded in software. Each frame is drawn 128 pixels wide and
scored (`apps/web/src/lib/shots`); memory does not grow with the video's length, as each frame
is released once scored.

| Video                             | Length | Time to find cuts | Speed |
| --------------------------------- | -----: | ----------------: | ----: |
| 1280×720, 24 fps, VP9 at 1 Mbit/s |   60 s |             8.8 s |  6.8× |

At that speed a two-hour film takes about 18 minutes; hardware decoding is faster. The video
was ffmpeg's `testsrc2`, which moves in every frame: no cuts were reported in it.

The single-file build grows by 55 KB (13 KB gzipped): detection runs in the media worker's code,
so Mediabunny is not built in twice.
