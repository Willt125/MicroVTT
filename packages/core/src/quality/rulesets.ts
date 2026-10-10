/**
 * Built-in rulesets. Each threshold here was read from the guide edition named in its sources
 * (copies were supplied by the owner on 2026-10-10); sections are cited per rule. Rules
 * without a source are MicroVTT's own. To add a guide, add a ruleset (see
 * docs/QUALITY-RULES.md).
 */
import type { GuideSource, Ruleset } from './types.ts';

const NETFLIX_GENERAL: GuideSource = {
  id: 'netflix-general',
  title: 'Netflix Timed Text Style Guide: General Requirements',
  edition: 'revised 2022-10-07',
  url: 'https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617',
};
const NETFLIX_EN_US: GuideSource = {
  id: 'netflix-en-us',
  title: 'Netflix English (USA) Timed Text Style Guide',
  edition: '2025-12-19',
  url: 'https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977',
};
const NETFLIX_TIMING: GuideSource = {
  id: 'netflix-timing',
  title: 'Netflix Timed Text Style Guide: Subtitle Timing Guidelines',
  edition: 'revised 2025-07-04',
};
const NETFLIX_TEMPLATES: GuideSource = {
  id: 'netflix-templates',
  title: 'Netflix Timed Text Style Guide: Subtitle Templates',
  edition: 'as supplied 2026-10-10',
};
const NETFLIX_FI: GuideSource = {
  id: 'netflix-fi',
  title: 'Netflix Finnish Timed Text Style Guide',
  edition: '2025-12-19',
};
const KOTUS: GuideSource = {
  id: 'kotus',
  title: 'Kotus: Lyhenneluettelo; Valtionhallinnon nimet ja niiden lyhenteet',
  edition: 'as supplied 2026-10-10',
  url: 'https://www.kotus.fi/',
};
const NETFLIX_GLYPHS: GuideSource = {
  id: 'netflix-glyphs',
  title: 'Netflix Glyph List (NGL2)',
  edition: 'version 2, as supplied 2026-10-10',
};
const BBC: GuideSource = {
  id: 'bbc',
  title: 'BBC Subtitle Guidelines',
  edition: 'March 2026',
  url: 'https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/',
};
const WCAG_22: GuideSource = {
  id: 'wcag22',
  title: 'Web Content Accessibility Guidelines (WCAG) 2.2',
  edition: 'W3C Recommendation, 12 December 2024',
  url: 'https://www.w3.org/TR/WCAG22/',
};

/** Loose defaults that ordinary captions (YouTube's included) should pass. */
export const LITE: Ruleset = {
  id: 'lite',
  name: 'Basic checks',
  description:
    'A few loose checks that ordinary captions should pass: nothing unreadably short or fast, no empty cues, nothing overlapping by accident.',
  sources: [],
  notChecked: [],
  rules: {
    'empty-cue': { severity: 'warning' },
    'min-duration': { severity: 'warning', params: { minMs: 500 } },
    'max-duration': { severity: 'info', params: { maxMs: 10000 } },
    'chars-per-second': { severity: 'warning', params: { max: 25 } },
    'line-length': { severity: 'info', params: { max: 50 } },
    'max-lines': { severity: 'info', params: { max: 3 } },
    overlap: { severity: 'info' },
    'min-gap': { severity: 'info', params: { minMs: 80 } },
  },
};

const netflix = (children: boolean): Ruleset => ({
  id: children ? 'netflix-en-us-children' : 'netflix-en-us',
  name: children ? 'Netflix English (USA), children’s' : 'Netflix English (USA)',
  description: `Netflix’s general requirements and English (USA) guide, ${children ? 'children’s programs (17 characters per second)' : 'adult programs (20 characters per second)'}. Rules marked SDH apply to subtitles for the deaf and hard of hearing.`,
  language: 'en',
  sources: [NETFLIX_GENERAL, NETFLIX_EN_US, NETFLIX_TIMING, NETFLIX_GLYPHS],
  notChecked: [
    'Accuracy and completeness against the audio, italics use, numbers, punctuation style and quotations (judgement, or need the audio).',
    'Timing to the audio and to shot changes (need the audio and the picture).',
  ],
  rules: {
    'empty-cue': { severity: 'warning' },
    'min-duration': {
      severity: 'warning',
      params: { minMs: 5000 / 6 },
      source: 'netflix-general',
      section: '1. Duration (5/6 second)',
    },
    'max-duration': {
      severity: 'warning',
      params: { maxMs: 7000 },
      source: 'netflix-general',
      section: '1. Duration',
    },
    'frame-gaps': {
      severity: 'warning',
      params: { frames: 2, closeBelowMs: 500 },
      source: 'netflix-timing',
      section: '5: Gaps between subtitles',
    },
    'max-lines': {
      severity: 'warning',
      params: { max: 2 },
      source: 'netflix-general',
      section: '4. Line Treatment',
    },
    'line-length': {
      severity: 'warning',
      params: { max: 42 },
      source: 'netflix-en-us',
      section: 'I.2 / II.3 Character Limitation',
    },
    'chars-per-second': {
      severity: 'warning',
      params: { max: children ? 17 : 20 },
      source: 'netflix-en-us',
      section: 'I.14 / II.17 Reading Speed Limits',
    },
    'line-shape': {
      severity: 'info',
      params: { maxChars: 42 },
      source: 'netflix-en-us',
      section: 'I.10 / II.13 Line Treatment',
    },
    'single-line': {
      severity: 'info',
      params: { maxChars: 42 },
      source: 'netflix-en-us',
      section: 'I.10 / II.13 Line Treatment',
    },
    'line-break-words': {
      severity: 'info',
      source: 'netflix-general',
      section: '4. Line Treatment',
    },
    centred: { severity: 'info', source: 'netflix-general', section: '5. Positioning' },
    'ellipsis-character': {
      severity: 'warning',
      source: 'netflix-en-us',
      section: 'I.3 / II.5 Continuity',
    },
    'double-space': {
      severity: 'warning',
      source: 'netflix-en-us',
      section: 'I.12 / II.15 Punctuation',
    },
    'dash-characters': {
      severity: 'warning',
      source: 'netflix-en-us',
      section: 'I.12 / II.15 Punctuation',
    },
    'speaker-hyphen': {
      severity: 'warning',
      source: 'netflix-en-us',
      section: 'I.6 / II.8 Dual Speakers',
    },
    'glyph-list': {
      severity: 'warning',
      source: 'netflix-glyphs',
      section: 'General Requirements 3. Glyph List',
    },
    'okay-spelling': {
      severity: 'info',
      source: 'netflix-en-us',
      section: 'I.17 / II.21 Special Instructions',
    },
    'lowercase-labels': {
      severity: 'info',
      source: 'netflix-en-us',
      section: 'I.16 Speaker ID / Sound Effects (SDH)',
    },
    'lyrics-notes': { severity: 'info', source: 'netflix-en-us', section: 'I.15 Songs (SDH)' },
  },
});

export const NETFLIX_EN_US_ADULT = netflix(false);
export const NETFLIX_EN_US_CHILDREN = netflix(true);

/** English subtitle templates: the master files translators work from. */
const netflixTemplate = (children: boolean): Ruleset => ({
  id: children ? 'netflix-template-en-children' : 'netflix-template-en',
  name: children ? 'Netflix English template, children’s' : 'Netflix English template',
  description: `Netflix’s rules for English subtitle templates (the files translations are made from), with the timing guidelines: ${children ? 'children’s programs, 15' : 'adult programs, 17'} characters per second, and text kept on one line whenever it fits.`,
  language: 'en',
  sources: [NETFLIX_TEMPLATES, NETFLIX_TIMING, NETFLIX_EN_US, NETFLIX_GLYPHS],
  notChecked: [
    'Coverage, annotations, forced narratives and segmentation (judgement).',
    'Timing to the audio and to shot changes (need the audio and the picture).',
  ],
  rules: {
    'empty-cue': { severity: 'warning' },
    'min-duration': {
      severity: 'warning',
      params: { minMs: 5000 / 6 },
      source: 'netflix-templates',
      section: '12. Duration (5/6 second)',
    },
    'max-duration': {
      severity: 'warning',
      params: { maxMs: 7000 },
      source: 'netflix-templates',
      section: '12. Duration',
    },
    'frame-gaps': {
      severity: 'warning',
      params: { frames: 2, closeBelowMs: 500 },
      source: 'netflix-timing',
      section: '5: Gaps between subtitles',
    },
    'max-lines': {
      severity: 'warning',
      params: { max: 2 },
      source: 'netflix-templates',
      section: '17. Line Treatment',
    },
    'line-length': {
      severity: 'warning',
      params: { max: 42 },
      source: 'netflix-templates',
      section: '5. Character Limitation',
    },
    'single-line': {
      severity: 'warning',
      params: { maxChars: 42 },
      source: 'netflix-templates',
      section: '17. Line Treatment (always one line unless over the limit)',
    },
    'chars-per-second': {
      severity: 'warning',
      params: { max: children ? 15 : 17 },
      source: 'netflix-templates',
      section: '23. Reading Speed Limits (English templates)',
    },
    'line-shape': {
      severity: 'info',
      params: { maxChars: 42 },
      source: 'netflix-templates',
      section: '17. Line Treatment (bottom-heavy)',
    },
    'line-break-words': {
      severity: 'info',
      source: 'netflix-templates',
      section: '17. Line Treatment',
    },
    centred: { severity: 'info', source: 'netflix-templates', section: '21. Positioning' },
    'double-space': {
      severity: 'warning',
      source: 'netflix-templates',
      section: '22. Punctuation',
    },
    'speaker-hyphen': {
      severity: 'warning',
      source: 'netflix-templates',
      section: '11. Dual Speaker Subtitles',
    },
    'ellipsis-character': {
      severity: 'warning',
      source: 'netflix-en-us',
      section: 'II.5 Continuity (the English guide applies to English templates)',
    },
    'dash-characters': {
      severity: 'warning',
      source: 'netflix-en-us',
      section: 'II.15 Punctuation',
    },
    'glyph-list': {
      severity: 'warning',
      source: 'netflix-glyphs',
      section: 'Templates 16. Glyph List (version 2)',
    },
  },
});

export const NETFLIX_TEMPLATE_EN = netflixTemplate(false);
export const NETFLIX_TEMPLATE_EN_CHILDREN = netflixTemplate(true);

/** Finnish subtitles, and subtitles for the deaf and hard of hearing (SDH). */
const netflixFinnish = (sdh: boolean, children: boolean): Ruleset => {
  const cps = sdh ? (children ? 17 : 20) : children ? 13 : 17;
  return {
    id: `netflix-fi${sdh ? '-sdh' : ''}${children ? '-children' : ''}`,
    name: `Netflix Finnish${sdh ? ' SDH' : ''}${children ? ', children’s' : ''}`,
    description: `Netflix’s Finnish guide with the general requirements and timing guidelines, ${sdh ? 'for subtitles for the deaf and hard of hearing' : 'for subtitles'}: ${children ? 'children’s' : 'adult'} programs, ${cps} characters per second. Abbreviations and the names of state bodies follow Kotus, which the guide refers to.`,
    language: 'fi',
    sources: [NETFLIX_FI, NETFLIX_GENERAL, NETFLIX_TIMING, NETFLIX_GLYPHS, KOTUS],
    notChecked: [
      'Condensing, merging and segmentation, italics, quotes and the rest of Kotus’s punctuation conventions (judgement).',
      'Spelled-out numbers (1–10, and at the start of a sentence).',
      'Timing to the audio and to shot changes (need the audio and the picture).',
    ],
    rules: {
      'empty-cue': { severity: 'warning' },
      'min-duration': {
        severity: 'warning',
        params: { minMs: 5000 / 6 },
        source: 'netflix-general',
        section: '1. Duration (5/6 second)',
      },
      'max-duration': {
        severity: 'warning',
        params: { maxMs: 7000 },
        source: 'netflix-general',
        section: '1. Duration',
      },
      'frame-gaps': {
        severity: 'warning',
        params: { frames: 2, closeBelowMs: 500 },
        source: 'netflix-timing',
        section: '5: Gaps between subtitles',
      },
      'max-lines': {
        severity: 'warning',
        params: { max: 2 },
        source: 'netflix-fi',
        section: '11. Line Treatment',
      },
      'line-length': {
        severity: 'warning',
        params: { max: 42 },
        source: 'netflix-fi',
        section: '2. Character Limitation',
      },
      'chars-per-second': {
        severity: 'warning',
        params: { max: cps },
        source: 'netflix-fi',
        section: sdh ? '20. SDH Guidelines (reading speed)' : '15. Reading Speed Limits',
      },
      'line-shape': {
        severity: 'info',
        params: { maxChars: 42 },
        source: 'netflix-fi',
        section: '11. Line Treatment',
      },
      centred: { severity: 'info', source: 'netflix-general', section: '5. Positioning' },
      'glyph-list': {
        severity: 'warning',
        source: 'netflix-glyphs',
        section: 'General Requirements 3. Glyph List',
      },
      'ellipsis-character': {
        severity: 'warning',
        source: 'netflix-fi',
        section: '4. Continuity',
      },
      'continuation-hyphen': {
        severity: 'info',
        source: 'netflix-fi',
        section: '4. Continuity',
      },
      'speaker-hyphen': {
        severity: 'warning',
        source: 'netflix-fi',
        section: '6. Dual Speakers',
      },
      'dual-speaker-second-line': {
        severity: 'warning',
        source: 'netflix-fi',
        section: '6. Dual Speakers',
      },
      'finnish-numbers': {
        severity: 'warning',
        source: 'netflix-fi',
        section: '12. Numbers',
      },
      'acronym-periods': {
        severity: 'warning',
        source: 'netflix-fi',
        section: '1. Abbreviations and Acronyms',
      },
      'finnish-abbreviations': {
        severity: 'info',
        source: 'kotus',
        section: 'Lyhenneluettelo (guide 1. Abbreviations and Acronyms)',
      },
      'agency-names': {
        severity: 'info',
        source: 'kotus',
        section: 'Valtionhallinnon nimet ja niiden lyhenteet',
      },
      'space-before-punctuation': {
        severity: 'warning',
        source: 'netflix-fi',
        section: '13. Punctuation (Kotus conventions)',
      },
      ...(sdh
        ? {
            'lowercase-labels': {
              severity: 'info' as const,
              source: 'netflix-fi',
              section: '20. SDH Guidelines',
            },
            'lyrics-notes': {
              severity: 'info' as const,
              source: 'netflix-fi',
              section: '20. SDH Guidelines',
            },
          }
        : {}),
    },
  };
};

export const NETFLIX_FI_ADULT = netflixFinnish(false, false);
export const NETFLIX_FI_CHILDREN = netflixFinnish(false, true);
export const NETFLIX_FI_SDH = netflixFinnish(true, false);
export const NETFLIX_FI_SDH_CHILDREN = netflixFinnish(true, true);

export const BBC_SUBTITLES: Ruleset = {
  id: 'bbc',
  name: 'BBC',
  description:
    'The BBC Subtitle Guidelines for landscape video. Line length uses the broadcast (Teletext) limit; online, lines are limited by width, which is about the same at the BBC’s font size.',
  language: 'en',
  sources: [BBC],
  notChecked: [
    'Editing, synchronisation with speech and shot changes (need the audio and picture).',
    'Speaker identification, sound labels and song markings (judgement).',
    'Online line length by width (depends on the font and the video’s shape).',
  ],
  rules: {
    'empty-cue': { severity: 'warning' },
    'line-length': {
      severity: 'warning',
      params: { max: 37 },
      source: 'bbc',
      section: '3.1 Line length',
    },
    'max-lines': {
      severity: 'warning',
      params: { max: 2 },
      source: 'bbc',
      section: '3.3 Number of lines',
    },
    'words-per-minute': {
      severity: 'warning',
      params: { max: 180 },
      source: 'bbc',
      section: '4 Timing (160–180 words per minute)',
    },
    'min-gap': {
      severity: 'warning',
      params: { minMs: 1000 },
      source: 'bbc',
      section: '4.5 Gaps',
    },
    'line-break-words': {
      severity: 'info',
      source: 'bbc',
      section: '3.4 Break at natural points',
    },
    'bbc-characters': {
      severity: 'info',
      source: 'bbc',
      section: '9.3 Supported characters',
    },
    'bbc-colours': { severity: 'info', source: 'bbc', section: '8 Colours' },
  },
};

export const WCAG: Ruleset = {
  id: 'wcag22',
  name: 'WCAG 2.2',
  description:
    'What WCAG 2.2 sets that a caption file can show: the contrast of colours its style sheets choose (1.4.3, level AA; set 7:1 for 1.4.6, AAA). Passing does not make captions accessible on its own.',
  sources: [WCAG_22],
  notChecked: [
    '1.2.2 / 1.2.4: that captions exist for all the audio, including non-speech sounds (needs the media).',
    '2.3.1: flashing (a property of the video).',
    '3.1.2: language of parts is checked as part of the format (<lang> tags).',
  ],
  rules: {
    contrast: {
      severity: 'warning',
      params: { min: 4.5 },
      source: 'wcag22',
      section: '1.4.3 Contrast (Minimum)',
    },
  },
};

/** Every built-in ruleset, in the order offered. */
export const RULESETS: readonly Ruleset[] = [
  LITE,
  NETFLIX_EN_US_ADULT,
  NETFLIX_EN_US_CHILDREN,
  NETFLIX_TEMPLATE_EN,
  NETFLIX_TEMPLATE_EN_CHILDREN,
  NETFLIX_FI_ADULT,
  NETFLIX_FI_CHILDREN,
  NETFLIX_FI_SDH,
  NETFLIX_FI_SDH_CHILDREN,
  BBC_SUBTITLES,
  WCAG,
];
