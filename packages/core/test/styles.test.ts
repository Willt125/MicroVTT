/** STYLE blocks: adding, changing and deleting them, and the styles editor's checks. */
import { describe, expect, it } from 'vitest';
import type { VttDocument } from '../src/index.ts';
import {
  NEW_STYLE_SHEET,
  addStyle,
  createCue,
  createDocument,
  cueSelectors,
  deleteStyle,
  exportDocument,
  ruleTemplates,
  styleSheetProblems,
  updateStyle,
} from '../src/index.ts';

const withHead = (head: VttDocument['head']): VttDocument => ({ ...createDocument(), head });

describe('STYLE block operations', () => {
  it('adds after the last STYLE block, or at the end of the header', () => {
    const empty = addStyle(createDocument());
    expect(empty.index).toBe(0);
    expect(empty.document.head).toEqual([{ type: 'style', css: NEW_STYLE_SHEET }]);
    const region = { type: 'region', id: 'r' } as unknown as VttDocument['head'][number];
    const doc = withHead([{ type: 'style', css: 'a' }, region]);
    const added = addStyle(doc, 'b');
    expect(added.index).toBe(1);
    expect(added.document.head.map((h) => h.type)).toEqual(['style', 'style', 'region']);
    expect(doc.head).toHaveLength(2); // Unchanged.
    expect(addStyle(withHead([region])).index).toBe(1);
  });

  it('updates and deletes by header index, and refuses what is not a STYLE block', () => {
    const doc = withHead([{ type: 'style', css: 'a' }]);
    expect(updateStyle(doc, 0, 'b').head).toEqual([{ type: 'style', css: 'b' }]);
    expect(deleteStyle(doc, 0).head).toEqual([]);
    expect(() => updateStyle(doc, 1, 'b')).toThrow(RangeError);
    expect(() => deleteStyle(doc, -1)).toThrow(RangeError);
  });
});

describe('style sheet problems', () => {
  it('is clean for a good sheet', () => {
    expect(
      styleSheetProblems('::cue {\n  color: yellow;\n}\n::cue(.loud) { font-weight: bold }'),
    ).toEqual([]);
  });

  it('reports validator problems with their line', () => {
    const problems = styleSheetProblems(
      '::cue { color: red }\np { color: red }\n::cue { margin: 0 }\n::cue {',
    );
    expect(problems.map((p) => [p.code, p.line])).toEqual([
      ['style-selector', 2],
      ['style-property-ignored', 3],
      ['style-css-syntax', 4],
    ]);
    expect(problems[0]?.severity).toBeDefined();
  });

  it('warns about blank lines and "-->", which export repairs', () => {
    const css = '::cue {\n\n  color: red; /* --> */\n}\n\n';
    expect(styleSheetProblems(css).map((p) => [p.code, p.line])).toEqual([
      ['style-blank-line', 2],
      ['style-arrow', 3],
    ]);
    const exported = exportDocument(withHead([{ type: 'style', css }])).text;
    expect(exported).toContain('STYLE\n::cue {\n  color: red; /* --\\> */\n}');
  });
});

describe('selectors from cue text', () => {
  const doc: VttDocument = {
    ...createDocument(),
    body: [
      createCue(0, 1, '<c.loud.red>a</c> <c.loud>b</c>'),
      createCue(1, 2, '<v Bob>hi</v> <lang fr>oui</lang> <v.x Ann "Q">yo</v>'),
      createCue(2, 3, '<c.loud>c</c> plain'),
    ],
  };

  it('counts the cues using each class, voice and language', () => {
    const s = cueSelectors(doc);
    expect(Object.fromEntries(s.classes)).toEqual({ loud: 2, red: 1, x: 1 });
    expect(Object.fromEntries(s.voices)).toEqual({ Bob: 1, 'Ann "Q"': 1 });
    expect(Object.fromEntries(s.languages)).toEqual({ fr: 1 });
  });

  it('offers rule templates for them, each a valid rule', () => {
    const templates = ruleTemplates(cueSelectors(doc));
    const labels = templates.map((t) => t.label);
    expect(labels.slice(0, 5)).toEqual([
      'Every cue',
      'Italic text (<i>)',
      'Bold text (<b>)',
      'Text still to be spoken (karaoke)',
      'Every region',
    ]);
    expect(labels.slice(5)).toEqual([
      'Class .loud',
      'Class .red',
      'Class .x',
      'Voice Ann "Q"',
      'Voice Bob',
      'Language fr',
    ]);
    expect(templates.find((t) => t.label === 'Voice Ann "Q"')?.css).toBe(
      '::cue(v[voice="Ann \\"Q\\""]) {\n  color: cyan;\n}',
    );
    for (const t of templates) expect(styleSheetProblems(t.css)).toEqual([]);
  });
});
