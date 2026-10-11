/** A document as the spec renderer's track: WebVTT as it is, other formats as their WebVTT conversion. */
import { srtToVtt, type Cue, type FormatId, type Region, type VttDocument } from '@microvtt/core';
import type { RenderTrack } from './renderer.ts';

export function renderTrackOf(
  doc: VttDocument,
  format: FormatId,
  language: string | null,
): RenderTrack {
  const vtt = format === 'srt' ? srtToVtt(doc).document : doc;
  return {
    cues: vtt.body.filter((item): item is Cue => item.type === 'cue'),
    regions: vtt.head.filter((item): item is Region => item.type === 'region'),
    styles: vtt.head.flatMap((item) => (item.type === 'style' ? [item.css] : [])),
    language: language ?? undefined,
  };
}
