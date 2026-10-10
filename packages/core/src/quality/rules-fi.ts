/**
 * Rules for Finnish subtitles, from the Netflix Finnish Timed Text Style Guide and the Kotus
 * (Institute for the Languages of Finland) lists it refers to.
 */
import type { CueInfo, Emitted, RuleDefinition } from './rules.ts';

const plain = (info: CueInfo): string => info.lines.join('\n');
/** Cue text with no markup or references, where the raw text is what is read. */
const isPlain = (text: string): boolean => !/[<&]/.test(text);
/** A letter in any script (for word boundaries around Finnish words). */
const L = '\\p{L}';

/**
 * Abbreviations Kotus writes only with a full stop, common in dialogue, whose undotted form is
 * neither another abbreviation nor a word (Kotus lyhenneluettelo, read 2026-10-10; "ns.", "mm.",
 * "ml." and "n." are left out because without the stop they are units).
 */
const DOTTED = [
  'esim',
  'jne',
  'yms',
  'tms',
  'jms',
  'vrt',
  'ks',
  'ym',
  'ts',
  'pvm',
  'ko',
  'em',
  'nk',
  'huom',
  'eKr',
  'jKr',
];
const capitalized = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);
const DOTTED_FORMS = [...new Set([...DOTTED, ...DOTTED.map(capitalized)])];
const MISSING_STOP = new RegExp(`(?<![${L}.])(${DOTTED_FORMS.join('|')})(?![${L}.])`, 'gu');
/** "klo" (kello) is written without a full stop. */
const KLO_STOP = /(?<![\p{L}])([Kk]lo)\.(?=\s)/gu;

/**
 * Short names of Finnish state bodies that have one official form, not written in capitals
 * (Kotus: Valtionhallinnon nimet ja niiden lyhenteet, read 2026-10-10; names given with an
 * alternative such as "Ara ~ ARA" are left out).
 */
const AGENCY_NAMES = [
  'Fimea',
  'Findata',
  'Fiva',
  'Jotpa',
  'Karvi',
  'Kela',
  'Kotus',
  'Krimo',
  'Kuvi',
  'Luke',
  'Mela',
  'Meriturva',
  'Metsäkeskus',
  'Migri',
  'Palkeet',
  'Polamk',
  'Rise',
  'Sitra',
  'Syke',
  'Taike',
  'Traficom',
  'Tukes',
  'Valteri',
  'Valtori',
  'Valvira',
  'Varke',
];
const BY_CAPITALS = new Map(AGENCY_NAMES.map((n) => [n.toUpperCase(), n]));
/** A name in capitals, with any case ending (KELAan, KELA:n). */
const AGENCY_CAPS = new RegExp(
  `(?<![${L}])(${[...BY_CAPITALS.keys()].join('|')})(?::?(\\p{Ll}+))?(?![${L}])`,
  'gu',
);

/** "KELA:n" as "Kelan": the official form, with the case ending and without the colon. */
const officialForm = (match: string): string => {
  const [, name = '', ending = ''] = /^(\p{Lu}+):?(\p{Ll}*)$/u.exec(match) ?? [];
  return (BY_CAPITALS.get(name) ?? name) + ending;
};

/** Text after the last closing tags, so text can be added before them. */
const insertBeforeClosingTags = (raw: string, add: string): string => {
  const m = /(?:<\/[^>]*>|\s)*$/.exec(raw);
  const at = m ? m.index : raw.length;
  return raw.slice(0, at) + add + raw.slice(at);
};

export const FINNISH_RULES: RuleDefinition[] = [
  {
    id: 'dual-speaker-second-line',
    category: 'text',
    title: 'Dual-speaker hyphen on the second line only',
    description: 'In a two-speaker cue, only the second speaker’s line starts with a hyphen.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (info.lines.length !== 2 || !info.lines.every((l) => /^\s*-/.test(l))) return;
      emit({
        index: info.index,
        message: 'Both lines start with a hyphen; only the second speaker’s line takes one.',
        fix: {
          label: 'Remove the first hyphen',
          change: {
            kind: 'text',
            text: info.cue.text.replace(/^((?:<[^>\n]*>)*)\s*-\s*/, '$1'),
          },
        },
      });
    },
  },
  {
    id: 'continuation-hyphen',
    category: 'text',
    title: 'Continuation hyphen',
    description:
      'A cue ending with no punctuation, followed by another: a sentence that continues in the next cue ends with “ -”.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (!info.next) return;
      const text = plain(info).trim();
      // Lyrics take no end punctuation.
      if (text === '' || text.includes('♪') || !/[\p{L}\p{N}]$/u.test(text)) return;
      const out: Emitted = {
        index: info.index,
        message:
          'Ends with no punctuation. If the sentence continues in the next cue, end with “ -”.',
        fix: {
          label: 'Add “ -”',
          change: { kind: 'text', text: insertBeforeClosingTags(info.cue.text, ' -') },
        },
      };
      emit(out);
    },
  },
  {
    id: 'space-before-punctuation',
    category: 'text',
    title: 'Space before punctuation',
    description:
      'A space before a full stop, comma, question or exclamation mark, colon, semicolon or ellipsis.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (!/[^\S\n]+[.,!?:;…](?=\s|$)/m.test(plain(info))) return;
      emit({
        index: info.index,
        message: 'A space before punctuation.',
        fix: {
          label: 'Remove the space',
          change: {
            kind: 'text',
            text: info.cue.text.replace(/[^\S\n]+([.,!?:;…])(?=\s|$|<)/gm, '$1'),
          },
        },
      });
    },
  },
  {
    id: 'finnish-numbers',
    category: 'text',
    title: 'Number formats (Finnish)',
    description:
      'Thousands separated by a comma (use a space), times with a colon (use a full stop) and decimals with a point (use a comma).',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      const thousands = /(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,])/g;
      const times = /(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g;
      // Two digits after a point could be a time ("7.45"); one, or three or more, are decimals.
      const decimals = /(?<![\d.,])(\d+)\.(\d|\d{3,})(?![\d.])/g;
      const found: string[] = [];
      if (thousands.test(text)) found.push('thousands with a comma (10 000, not 10,000)');
      if (times.test(text)) found.push('a time with a colon (7.45, not 7:45)');
      if (decimals.test(text)) found.push('a decimal point (1,5, not 1.5)');
      if (found.length === 0) return;
      const fixed = info.cue.text
        .replace(thousands, (m) => m.replace(/,/g, ' '))
        .replace(times, '$1.$2')
        .replace(decimals, '$1,$2');
      emit({
        index: info.index,
        message: `Contains ${found.join('; ')}.`,
        ...(isPlain(info.cue.text) && fixed !== info.cue.text
          ? { fix: { label: 'Use Finnish formats', change: { kind: 'text', text: fixed } } }
          : {}),
      });
    },
  },
  {
    id: 'acronym-periods',
    category: 'text',
    title: 'Acronyms without full stops',
    description:
      'Acronyms written with full stops between the letters (U.S.A.); initials before a name are left alone.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const pattern = /(?<![\p{L}.])((?:\p{Lu}\.){2,})(?!\p{Lu})(?! ?\p{Lu}\p{Ll})/gu;
      const text = plain(info);
      const hits = [...text.matchAll(pattern)].map((m) => m[1] as string);
      if (hits.length === 0) return;
      emit({
        index: info.index,
        message: `${hits.join(', ')}: acronyms are written without full stops.`,
        fix: {
          label: 'Remove the full stops',
          change: {
            kind: 'text',
            text: info.cue.text.replace(pattern, (m) => m.replace(/\./g, '')),
          },
        },
      });
    },
  },
  {
    id: 'finnish-abbreviations',
    category: 'text',
    title: 'Abbreviations (Kotus)',
    description:
      'Common abbreviations without their full stop (esim., jne., vrt. …), or “klo” with one, as Kotus writes them.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      const missing = [...new Set([...text.matchAll(MISSING_STOP)].map((m) => m[1] as string))];
      const klo = KLO_STOP.test(text);
      KLO_STOP.lastIndex = 0;
      if (missing.length === 0 && !klo) return;
      const parts = [
        ...(missing.length > 0
          ? [`${missing.map((w) => `${w}.`).join(', ')} take a full stop`]
          : []),
        ...(klo ? ['“klo” takes none'] : []),
      ];
      emit({
        index: info.index,
        message: `${parts.join('; ')}.`,
        fix: {
          label: 'Fix abbreviations',
          change: {
            kind: 'text',
            text: info.cue.text.replace(MISSING_STOP, '$1.').replace(KLO_STOP, '$1'),
          },
        },
      });
    },
  },
  {
    id: 'agency-names',
    category: 'text',
    title: 'State body names (Kotus)',
    description:
      'Short names of Finnish state bodies written in capitals that Kotus writes otherwise (Kela, not KELA); all-capital cues (forced narratives) are left alone.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      if (!/\p{Ll}/u.test(text)) return;
      const hits = [...new Set([...text.matchAll(AGENCY_CAPS)].map((m) => m[0]))];
      if (hits.length === 0) return;
      emit({
        index: info.index,
        message: `${hits.map((h) => `${h} → ${officialForm(h)}`).join(', ')}.`,
        fix: {
          label: 'Use the official forms',
          change: {
            kind: 'text',
            text: info.cue.text.replace(AGENCY_CAPS, (m) => officialForm(m)),
          },
        },
      });
    },
  },
];
