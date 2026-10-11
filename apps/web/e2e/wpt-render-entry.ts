/**
 * Bundled for the WPT rendering harness (wpt-rendering.e2e.ts): renders WebVTT files, parsed
 * by the spec's parser alone (none of the editor's repairs on import), with the spec renderer.
 */
import { parse, type Cue, type Region } from '@microvtt/core';
import { CueRenderer, type RenderTrack } from '../src/lib/render/renderer.ts';

function trackOf({ text, language }: { text: string; language?: string | undefined }): RenderTrack {
  const parsed = parse(text);
  const regions: Region[] = parsed.regions.map(({ range: _range, ...r }) => ({
    type: 'region',
    ...r,
  }));
  const cues: Cue[] = parsed.cues.map(({ range: _range, pauseOnExit: _pause, region, ...c }) => ({
    type: 'cue',
    ...c,
    region: region?.id ?? null,
  }));
  return { cues, regions, styles: parsed.stylesheets.map((s) => s.css), language };
}

declare global {
  interface Window {
    renderWpt: (
      tracks: { text: string; language?: string | undefined }[],
      pageCss: string,
      timeMs: number,
      adjustment: string,
    ) => void;
  }
}

window.renderWpt = (tracks, pageCss, timeMs, adjustment) => {
  const video = document.getElementById('video') as HTMLElement;
  // An adjustment to the rendering itself (see ADJUSTED in wpt-rendering-expectations.ts).
  if (adjustment)
    document.head.append(
      Object.assign(document.createElement('style'), { textContent: adjustment }),
    );
  new CueRenderer(video).render(tracks.map(trackOf), timeMs, { pageCss });
};
