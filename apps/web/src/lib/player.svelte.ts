/**
 * Media playback state. The media itself never leaves the device: it is played from an object
 * URL. A `<video>` element plays audio too, which gives audio files a caption area.
 */

export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export class Player {
  url = $state<string | null>(null);
  /** The media file itself, for the waveform (read in chunks, never whole). */
  file = $state.raw<File | null>(null);
  name = $state('');
  element = $state.raw<HTMLVideoElement | null>(null);
  currentMs = $state(0);
  durationMs = $state(0);
  paused = $state(true);
  rate = $state(1);
  /** Repeat the selected cue. */
  loop = $state(false);
  /** Keep the cue list and the playhead together (select follows playback, and vice versa). */
  sync = $state(true);
  /** Show the document as captions over the media. */
  captions = $state(true);
  /** True when the file has no video track. */
  isAudio = $state(false);
  error = $state<string | null>(null);

  get hasMedia(): boolean {
    return this.url !== null;
  }

  load(file: File): void {
    this.unload();
    this.url = URL.createObjectURL(file);
    this.file = file;
    this.name = file.name;
  }

  unload(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.file = null;
    this.name = '';
    this.currentMs = 0;
    this.durationMs = 0;
    this.paused = true;
    this.isAudio = false;
    this.error = null;
  }

  toggle(): void {
    const media = this.element;
    if (!media) return;
    if (media.paused) {
      media.play().catch((error: Error) => {
        if (error.name !== 'AbortError') this.error = `Cannot play: ${error.message}`;
      });
    } else {
      media.pause();
    }
  }

  /** Reads the playhead from the element, in whole milliseconds (document times are integers). */
  readTime(): void {
    if (this.element) this.currentMs = Math.round(this.element.currentTime * 1000);
  }

  seek(ms: number): void {
    const media = this.element;
    if (!media) return;
    const max = this.durationMs > 0 ? this.durationMs : Infinity;
    const clamped = Math.round(Math.max(0, Math.min(max, ms)));
    media.currentTime = clamped / 1000;
    this.currentMs = clamped;
  }

  skip(deltaMs: number): void {
    this.seek(this.currentMs + deltaMs);
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.element) this.element.playbackRate = rate;
  }
}
