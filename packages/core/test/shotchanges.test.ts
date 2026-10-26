/** Shot changes: reading lists from other tools, and the Netflix shot-change rule. */
import { describe, expect, it } from 'vitest';
import type { Cue, Ruleset, VttDocument } from '../src/index.ts';
import {
  NETFLIX_EN_US_ADULT,
  NETFLIX_FI_ADULT,
  applyQualityFixes,
  checkQuality,
  createCue,
  createDocument,
  formatShotChanges,
  parseShotChanges,
  shotChangesBetween,
  snapToFrame,
  toggleShotChange,
} from '../src/index.ts';

describe('reading shot-change lists', () => {
  it('reads Subtitle Edit lists (seconds, one per line)', () => {
    expect(parseShotChanges('12.345\n1.5\n\n1.5\n')).toEqual({ times: [1500, 12345], skipped: 0 });
  });

  it('reads the times in an ffmpeg scene-detection log, ignoring the rest', () => {
    const log = [
      'ffmpeg version 7.0.2 Copyright (c) 2000-2024 the FFmpeg developers',
      '[Parsed_showinfo_1 @ 0x5581] config in time_base: 1/25, frame_rate: 25/1',
      '[Parsed_showinfo_1 @ 0x5581] n:   0 pts:  50 pts_time:2       duration:1 checksum:00000000',
      '[Parsed_showinfo_1 @ 0x5581] n:   1 pts: 171 pts_time:6.84    duration:1 checksum:00000000',
      'frame=  300 fps=0.0 q=-0.0 Lsize=N/A time=00:00:12.00 bitrate=N/A speed= 120x',
    ].join('\n');
    expect(parseShotChanges(log)).toEqual({ times: [2000, 6840], skipped: 0 });
  });

  it('reads ffprobe output, default and CSV', () => {
    expect(parseShotChanges('[FRAME]\npts_time=3.003\n[/FRAME]\n').times).toEqual([3003]);
    expect(parseShotChanges('frame,4.004000\nframe,8.008000\n').times).toEqual([4004, 8008]);
  });

  it('reads timecodes, with milliseconds or with frames', () => {
    expect(parseShotChanges('00:00:01.500\n00:00:02,25\n01:02.5').times).toEqual([
      1500, 2250, 62500,
    ]);
    // Frames need the frame rate.
    const noRate = parseShotChanges('00:00:01:12\n');
    expect(noRate.times).toEqual([]);
    expect(noRate.problem).toMatch(/choose the frame rate/);
    expect(parseShotChanges('00:00:01:12\n', { fps: 24 }).times).toEqual([1500]);
    // Drop-frame: a minute in, frames 00 and 01 are skipped, so ;02 is the 1800th frame.
    expect(parseShotChanges('00:01:00;02\n', { fps: 30_000 / 1001 }).times).toEqual([60060]);
  });

  it('reads plain numbers in the unit chosen, and snaps to frames when the rate is known', () => {
    expect(parseShotChanges('1500\n', { unit: 'milliseconds' }).times).toEqual([1500]);
    expect(parseShotChanges('36\n', { unit: 'frames', fps: 24 }).times).toEqual([1500]);
    expect(parseShotChanges('36\n', { unit: 'frames' }).problem).toMatch(/frame rate/);
    // 1.51 s is nearest frame 38 at 25 fps (1.52 s).
    expect(parseShotChanges('1.51\n', { fps: 25 }).times).toEqual([1520]);
    expect(snapToFrame(1000, 30_000 / 1001)).toBe(1001);
  });

  it('counts lines it cannot read', () => {
    expect(parseShotChanges('Shot changes\n1.0\nabc\n-2\n# a comment\n')).toEqual({
      times: [1000],
      skipped: 3,
    });
  });

  it('writes lists Subtitle Edit reads, and reads them back', () => {
    const text = formatShotChanges([1500, 12345]);
    expect(text).toBe('1.500\n12.345\n');
    expect(parseShotChanges(text).times).toEqual([1500, 12345]);
  });

  it('marks a shot change, or takes off the one at the same place', () => {
    const times = toggleShotChange([1000, 3000], 2000, 20);
    expect(times).toEqual([1000, 2000, 3000]);
    expect(toggleShotChange(times, 2010, 20)).toEqual([1000, 3000]);
    expect(shotChangesBetween(times, 1000, 2500)).toEqual([1000, 2000]);
  });
});

describe('the shot-change rule (24 fps, a cut at 10 s)', () => {
  const only: Ruleset = {
    id: 'test',
    name: 'test',
    description: '',
    sources: [],
    notChecked: [],
    rules: { 'shot-changes': { severity: 'warning' } },
  };
  /** The first whole ms of a frame at 24 fps. */
  const f = (frame: number): number => Math.ceil((frame * 1000) / 24 - 1e-6);
  const doc = (...cues: Cue[]): VttDocument => ({ ...createDocument(), body: cues });
  const check = (d: VttDocument, shotChanges = [10_000], fps?: number) =>
    checkQuality(d, only, {}, { shotChanges, ...(fps ? { fps } : {}) });
  const one = (startMs: number, endMs: number) => check(doc(createCue(startMs, endMs, 'Hi')));

  it('needs shot changes', () => {
    expect(check(doc(createCue(f(243), 12_000, 'Hi')), [])).toEqual([]);
  });

  it('starts on the cut when the cue starts within half a second after it', () => {
    const [finding] = one(f(243), 12_000);
    expect(finding?.message).toBe('Starts 3 frames after a shot change; start on the cut.');
    expect(finding?.fix?.change).toEqual({ kind: 'times', startMs: 10_000, endMs: 12_000 });
    expect(one(10_000, 12_000)).toEqual([]);
    expect(one(f(252), 12_000)).toEqual([]);
  });

  it('starts on the cut, or half a second before it, when the cue starts just before it', () => {
    const [near] = one(f(236), 12_000);
    expect(near?.message).toMatch(
      /^Starts 4 frames before a shot change; start on the cut, or at least half a second \(12 frames\) before it\.$/,
    );
    expect(near?.fix?.change).toEqual({ kind: 'times', startMs: 10_000, endMs: 12_000 });
    // Nearer half a second before: brought forward.
    expect(one(f(230), 12_000)[0]?.fix?.change).toEqual({
      kind: 'times',
      startMs: f(228),
      endMs: 12_000,
    });
    expect(one(f(228), 12_000)).toEqual([]);
    // Unless the previous cue is in the way: then it moves to the cut.
    const crowded = check(doc(createCue(8000, 9550, 'Before'), createCue(f(230), 12_000, 'Hi')));
    expect(crowded.find((x) => x.index === 1)?.fix?.change).toEqual({
      kind: 'times',
      startMs: 10_000,
      endMs: 12_000,
    });
  });

  it('ends two frames before the cut when the cue ends within half a second of it', () => {
    const [finding] = one(8000, f(233));
    expect(finding?.message).toBe(
      'Ends 7 frames before a shot change; end 2 frames before the cut.',
    );
    expect(finding?.fix?.change).toEqual({ kind: 'times', startMs: 8000, endMs: f(238) });
    expect(one(8000, f(238))).toEqual([]);
    expect(one(8000, f(226))).toEqual([]);
  });

  it('ends two frames before the cut, or half a second after it, when the cue ends near it', () => {
    const [on] = one(8000, 10_000);
    expect(on?.message).toBe(
      'Ends on a shot change; end 2 frames before the cut, or at least half a second (12 frames) after it.',
    );
    expect(on?.fix?.change).toEqual({ kind: 'times', startMs: 8000, endMs: f(238) });
    expect(one(8000, f(245))[0]?.message).toMatch(/^Ends 5 frames after a shot change/);
    expect(one(8000, f(245))[0]?.fix?.change).toEqual({
      kind: 'times',
      startMs: 8000,
      endMs: f(238),
    });
    // Crossing by half a second or more is fine.
    expect(one(8000, f(252))).toEqual([]);
    // A cue that would be under half a second before the cut is extended past it instead.
    expect(one(f(228), f(243))[0]?.fix?.change).toEqual({
      kind: 'times',
      startMs: f(228),
      endMs: f(252),
    });
  });

  it('offers no fix when the next cue is in the way', () => {
    const [finding] = check(doc(createCue(8000, 9700, 'Hi'), createCue(9900, 12_000, 'Next')));
    expect(finding?.index).toBe(0);
    expect(finding?.message).toMatch(/Ends 7 frames before/);
    expect(finding?.fix).toBeUndefined();
  });

  it('fixes both edges at once, and counts frames at the video’s rate', () => {
    const both = check(doc(createCue(f(243), f(287), 'Hi')), [10_000, 12_000]);
    expect(both[0]?.fix?.change).toEqual({ kind: 'times', startMs: 10_000, endMs: f(286) });
    // At 25 fps two frames before 10 s is 9.92 s.
    expect(check(doc(createCue(8000, 10_000, 'Hi')), [10_000], 25)[0]?.fix?.change).toEqual({
      kind: 'times',
      startMs: 8000,
      endMs: 9920,
    });
    const fixed = applyQualityFixes(doc(createCue(f(243), 12_000, 'Hi')), one(f(243), 12_000));
    expect(check(fixed)).toEqual([]);
  });

  it('is in the Netflix rulesets', () => {
    for (const ruleset of [NETFLIX_EN_US_ADULT, NETFLIX_FI_ADULT]) {
      expect(ruleset.rules['shot-changes']).toMatchObject({ source: 'netflix-timing' });
    }
  });
});
