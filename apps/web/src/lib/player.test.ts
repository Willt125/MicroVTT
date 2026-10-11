import { describe, expect, it } from 'vitest';
import { Player } from './player.svelte.ts';

/** A media element as far as seeking goes: WebKit can drop a seek made before metadata. */
function fakeMedia(): HTMLVideoElement {
  return { readyState: 0, currentTime: 0, duration: NaN } as unknown as HTMLVideoElement;
}

describe('seeking', () => {
  it('seeks again once the metadata loads when an earlier seek was dropped', () => {
    const player = new Player();
    const media = fakeMedia();
    player.element = media;
    player.seek(1000);
    expect(player.currentMs).toBe(1000);
    // The browser started at 0 anyway.
    Object.assign(media, { readyState: 1, currentTime: 0, duration: 20 });
    player.metadataLoaded(media);
    expect(media.currentTime).toBe(1);
    expect(player.currentMs).toBe(1000);
    expect(player.durationMs).toBe(20_000);
  });

  it('clamps a pending seek to the duration, and forgets it after one use', () => {
    const player = new Player();
    const media = fakeMedia();
    player.element = media;
    player.seek(90_000);
    Object.assign(media, { readyState: 1, currentTime: 0, duration: 20 });
    player.metadataLoaded(media);
    expect(media.currentTime).toBe(20);
    media.currentTime = 5;
    player.metadataLoaded(media);
    expect(media.currentTime).toBe(5);
  });

  it('does not hold a seek made once the metadata is in', () => {
    const player = new Player();
    const media = fakeMedia();
    Object.assign(media, { readyState: 1, duration: 20 });
    player.element = media;
    player.seek(3000);
    media.currentTime = 7;
    player.metadataLoaded(media);
    expect(media.currentTime).toBe(7);
  });
});
