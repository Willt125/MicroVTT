/**
 * Media playback state. The media itself never leaves the device: it is played from an object
 * URL. A `<video>` element plays audio too, which gives audio files a caption area.
 */

export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * What draws the captions: MicroVTT's renderer, which follows the WebVTT spec's rendering rules
 * (§7, §8) the same way in every browser, or the browser's own.
 */
export type CaptionRenderer = 'spec' | 'browser';

const RENDERER_KEY = 'microvtt.renderer';
/** `HTMLMediaElement.HAVE_METADATA`, without needing the DOM. */
const HAVE_METADATA = 1;

function loadRenderer(): CaptionRenderer {
  try {
    if (localStorage.getItem(RENDERER_KEY) === 'browser') return 'browser';
  } catch {
    // Storage can be unavailable; the default applies.
  }
  return 'spec';
}

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
  /** What draws the captions. */
  renderer = $state<CaptionRenderer>(loadRenderer());
  /** The frame rate for frame stepping: 'auto' (measured from the file) or a chosen rate. */
  fpsChoice = $state<number | 'auto'>('auto');
  /** True when the file has no video track. */
  isAudio = $state(false);
  error = $state<string | null>(null);
  /**
   * A seek asked for before the media's metadata loaded. The element should keep it as its
   * default playback start position, but WebKit sometimes starts at 0 regardless, so it is
   * applied again once the metadata is in.
   */
  private pendingMs: number | null = null;

  get hasMedia(): boolean {
    return this.url !== null;
  }

  load(file: File): void {
    this.unload();
    this.url = URL.createObjectURL(file);
    this.file = file;
    this.name = file.name;
    this.fpsChoice = 'auto';
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
    this.pendingMs = null;
  }

  /** The media's metadata loaded: its duration is known, and a seek asked for earlier applies. */
  metadataLoaded(media: HTMLMediaElement): void {
    this.durationMs = Number.isFinite(media.duration) ? media.duration * 1000 : 0;
    const pending = this.pendingMs;
    this.pendingMs = null;
    if (pending !== null && Math.round(media.currentTime * 1000) !== pending) this.seek(pending);
  }

  setRenderer(renderer: CaptionRenderer): void {
    this.renderer = renderer;
    try {
      localStorage.setItem(RENDERER_KEY, renderer);
    } catch {
      // Not persisted; the choice still applies for this session.
    }
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

  /**
   * Reads the playhead from the element, in whole milliseconds (document times are integers).
   * Not while a seek is in progress: `currentMs` already holds where it goes, and WebKit can
   * report the old position in events from earlier seeks, which would undo quick frame steps.
   */
  readTime(): void {
    if (this.element && !this.element.seeking)
      this.currentMs = Math.round(this.element.currentTime * 1000);
  }

  seek(ms: number): void {
    const media = this.element;
    if (!media) return;
    const max = this.durationMs > 0 ? this.durationMs : Infinity;
    const clamped = Math.round(Math.max(0, Math.min(max, ms)));
    media.currentTime = clamped / 1000;
    this.currentMs = clamped;
    this.pendingMs = media.readyState < HAVE_METADATA ? clamped : null;
  }

  skip(deltaMs: number): void {
    this.seek(this.currentMs + deltaMs);
  }

  pause(): void {
    this.element?.pause();
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.element) this.element.playbackRate = rate;
  }
}
