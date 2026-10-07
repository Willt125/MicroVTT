/**
 * Fixes the user applies (Phase 4d), for text that parsers ignore but that import keeps as a
 * comment because it was probably meant otherwise. Unlike import's automatic recoveries, these
 * change what a conforming player shows, so they are offered rather than applied:
 *
 * - text after a blank line inside a caption (a block of text right after a cue): join it to
 *   that cue;
 * - a STYLE or REGION block after the first cue: move it to the header, where it takes effect
 *   (and reconnect the cues that referred to that region).
 */
import type { BodyItem, Cue, Note, VttDocument } from './document.ts';
import { importDocument } from './document.ts';

export type QuickFixKind = 'join-text' | 'move-to-header';

export interface QuickFix {
  /** The comment's index in `body`. */
  index: number;
  kind: QuickFixKind;
  /** What the fix does, for a button or a menu. */
  label: string;
}

const isCue = (item: BodyItem | undefined): item is Cue => item?.type === 'cue';

const linesOf = (note: Note): string[] => note.text.replace(/^\n/, '').split('\n');

/** The header item a late STYLE or REGION comment would become, if it is one. */
function headerItem(note: Note) {
  const lines = linesOf(note);
  if (!/^(?:STYLE|REGION)[ \t]*$/.test(lines[0] ?? '')) return null;
  const imported = importDocument(`WEBVTT\n\n${lines.join('\n')}\n`);
  const item = imported.document.head[0];
  return item && (item.type === 'style' || item.type === 'region') ? item : null;
}

/** The fixes this document offers, in body order. */
export function findQuickFixes(doc: VttDocument): QuickFix[] {
  const fixes: QuickFix[] = [];
  doc.body.forEach((item, index) => {
    if (item.type !== 'note' || item.preserved !== 'discarded') return;
    const header = headerItem(item);
    if (header) {
      fixes.push({
        index,
        kind: 'move-to-header',
        label: `Move this ${header.type === 'style' ? 'STYLE' : 'REGION'} block to the header`,
      });
    } else if (isCue(doc.body[index - 1]) && !/--\s?>/.test(item.text)) {
      fixes.push({ index, kind: 'join-text', label: 'Join this text to the cue above' });
    }
  });
  return fixes;
}

function relink(cue: Cue, region: string): Cue {
  const copy: Cue = { ...cue, region };
  delete copy.unresolvedRegion;
  return copy;
}

/** Applies the fix offered for `body[index]`; the document is returned unchanged if none is. */
export function applyQuickFix(doc: VttDocument, index: number): VttDocument {
  const fix = findQuickFixes(doc).find((f) => f.index === index);
  const note = doc.body[index];
  if (!fix || note?.type !== 'note') return doc;
  const body = doc.body.filter((_, i) => i !== index);

  if (fix.kind === 'join-text') {
    const cue = doc.body[index - 1] as Cue;
    body[index - 1] = { ...cue, text: `${cue.text}\n${linesOf(note).join('\n')}` };
    return { ...doc, body };
  }

  const item = headerItem(note);
  if (!item) return doc;
  // Cues that named this region lost it on import (it was not defined yet): give it back,
  // unless a setting takes the cue out of any region.
  const relinked =
    item.type === 'region' && item.id !== ''
      ? body.map((b) =>
          isCue(b) &&
          b.unresolvedRegion === item.id &&
          b.line === 'auto' &&
          b.size === 100 &&
          b.vertical === ''
            ? relink(b, item.id)
            : b,
        )
      : body;
  return { ...doc, head: [...doc.head, item], body: relinked };
}
