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

const NETFLIX_ZH_HANS: GuideSource = {
  id: 'netflix-zh-hans',
  title: 'Netflix Chinese (Simplified) Timed Text Style Guide',
  edition: '2025-07-04',
};
const NETFLIX_ZH_HANT: GuideSource = {
  id: 'netflix-zh-hant',
  title: 'Netflix Chinese (Traditional) Timed Text Style Guide',
  edition: '2025-12-19',
};
const NETFLIX_KO: GuideSource = {
  id: 'netflix-ko',
  title: 'Netflix Korean Timed Text Style Guide',
  edition: '2025-07-07',
};
const NETFLIX_JA: GuideSource = {
  id: 'netflix-ja',
  title: 'Netflix Japanese Timed Text Style Guide',
  edition: '2025-12-19',
};
const NETFLIX_JA_IMSC: GuideSource = {
  id: 'netflix-ja-imsc',
  title: 'Netflix Japanese IMSC 1.1 Creation Guide',
  edition: 'as supplied 2026-10-10',
};

/** Netflix's general timing requirements, which every language's guide builds on. */
const netflixTiming = (
  minMs = 5000 / 6,
  minSource = 'netflix-general',
  minSection = '1. Duration (5/6 second)',
): Ruleset['rules'] => ({
  'empty-cue': { severity: 'warning' },
  'min-duration': {
    severity: 'warning',
    params: { minMs },
    source: minSource,
    section: minSection,
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
});

const variantName = (sdh: boolean, children: boolean): string =>
  `${sdh ? ' SDH' : ''}${children ? ', children’s' : ''}`;
const variantId = (sdh: boolean, children: boolean): string =>
  `${sdh ? '-sdh' : ''}${children ? '-children' : ''}`;

/** Chinese subtitles, Simplified (PRC) or Traditional, and SDH. */
const netflixChinese = (traditional: boolean, sdh: boolean, children: boolean): Ruleset => {
  const guide = traditional ? 'netflix-zh-hant' : 'netflix-zh-hans';
  const cps = sdh ? (children ? 9 : 11) : children ? 7 : 9;
  const chars = sdh ? 18 : 16;
  const sec = (hans: string, hant: string): string => (traditional ? hant : hans);
  const sdhSec = (hans: string, hant: string): string => (traditional ? hant : `${hans} (SDH)`);
  return {
    id: `netflix-zh-${traditional ? 'hant' : 'hans'}${variantId(sdh, children)}`,
    name: `Netflix Chinese (${traditional ? 'Traditional' : 'Simplified'})${variantName(sdh, children)}`,
    description: `Netflix’s ${traditional ? 'Traditional' : 'Simplified'} Chinese guide with the general requirements and timing guidelines, ${sdh ? 'for subtitles for the deaf and hard of hearing' : 'for subtitles'}: ${children ? 'children’s' : 'adult'} programs, ${chars} characters per line and ${cps} characters per second.`,
    language: traditional ? 'zh-Hant' : 'zh-Hans',
    sources: [
      traditional ? NETFLIX_ZH_HANT : NETFLIX_ZH_HANS,
      NETFLIX_GENERAL,
      NETFLIX_TIMING,
      NETFLIX_GLYPHS,
    ],
    notChecked: [
      'Names, nicknames and interpuncts in foreign names; titles in 《》 (judgement, and the approved translations).',
      'Ellipses for pauses and interruptions, and the rest of continuity (judgement).',
      'Spelled-out numbers 1–10, money, times and dates (judgement).',
      'Forced narratives in parentheses, positioning, and timing to the audio and to shot changes (need the picture and the audio).',
    ],
    rules: {
      ...netflixTiming(),
      'max-lines': {
        severity: 'warning',
        params: { max: sdh ? 3 : 2 },
        source: guide,
        section: sdh
          ? sdhSec('19. SDH Guidelines', 'II.4. Line Treatment')
          : sec('10. Line Treatment', 'I.10. Line Treatment'),
      },
      'line-length': {
        severity: 'warning',
        params: { max: chars },
        source: guide,
        section: sdh
          ? sdhSec('19. SDH Guidelines', 'II.2. Character Limit')
          : sec('1. Character Limitation', 'I.1. Character Limitation'),
      },
      'chars-per-second': {
        severity: 'warning',
        params: { max: cps },
        source: guide,
        section: sdh
          ? sdhSec('19. SDH Guidelines', 'II.3. Reading Speed Limit')
          : sec('14. Reading Speed Limits', 'I.14. Reading Speed Limits'),
      },
      'single-line': {
        severity: 'info',
        params: { maxChars: chars },
        source: guide,
        section: sec('10. Line Treatment', 'I.10. Line Treatment'),
      },
      'line-shape': {
        severity: 'info',
        params: { maxChars: chars },
        source: guide,
        section: sec('10. Line Treatment', 'I.10. Line Treatment'),
      },
      centred: { severity: 'info', source: 'netflix-general', section: '5. Positioning' },
      'glyph-list': {
        severity: 'warning',
        source: 'netflix-glyphs',
        section: 'General Requirements 3. Glyph List',
      },
      [traditional ? 'zh-hant-punctuation' : 'zh-hans-punctuation']: {
        severity: 'warning',
        source: guide,
        section: sec('12. Punctuation; 13. Quotes', 'I.12. Punctuation; I.13. Quotations'),
      },
      'ellipsis-character': {
        severity: 'warning',
        source: guide,
        section: sec('12. Punctuation (U+2026)', 'I.12. Punctuation (U+2026)'),
      },
      'zh-numbers': {
        severity: 'warning',
        source: guide,
        section: sec('11. Numbers', 'I.11. Numbers'),
      },
      'no-italics': {
        severity: 'warning',
        source: guide,
        section: sec('9. Italics', 'I.9. Italics'),
      },
      'speaker-hyphen': {
        severity: 'warning',
        params: { space: 0 },
        source: guide,
        section: sec('5. Dual Speakers', 'I.5. Dual Speakers'),
      },
      ...(sdh
        ? {
            'lyrics-notes': {
              severity: 'info' as const,
              params: { space: traditional ? 0 : 1 },
              source: guide,
              section: sdhSec('19. SDH Guidelines', 'II.8. Songs'),
            },
          }
        : {}),
    },
  };
};

export const NETFLIX_ZH_HANS_ADULT = netflixChinese(false, false, false);
export const NETFLIX_ZH_HANS_CHILDREN = netflixChinese(false, false, true);
export const NETFLIX_ZH_HANS_SDH = netflixChinese(false, true, false);
export const NETFLIX_ZH_HANS_SDH_CHILDREN = netflixChinese(false, true, true);
export const NETFLIX_ZH_HANT_ADULT = netflixChinese(true, false, false);
export const NETFLIX_ZH_HANT_CHILDREN = netflixChinese(true, false, true);
export const NETFLIX_ZH_HANT_SDH = netflixChinese(true, true, false);
export const NETFLIX_ZH_HANT_SDH_CHILDREN = netflixChinese(true, true, true);

/** Korean subtitles and SDH. Latin letters, spaces and punctuation count as half a character. */
const netflixKorean = (sdh: boolean, children: boolean): Ruleset => {
  const cps = sdh ? (children ? 11 : 14) : children ? 9 : 12;
  const sec = (regular: string, forSdh: string): string => (sdh ? forSdh : regular);
  return {
    id: `netflix-ko${variantId(sdh, children)}`,
    name: `Netflix Korean${variantName(sdh, children)}`,
    description: `Netflix’s Korean guide with the general requirements and timing guidelines, ${sdh ? 'for subtitles for the deaf and hard of hearing' : 'for subtitles'}: ${children ? 'children’s' : 'adult'} programs, 16 characters per line and ${cps} characters per second, Latin letters, spaces and punctuation counting as half a character.`,
    language: 'ko',
    sources: [NETFLIX_KO, NETFLIX_GENERAL, NETFLIX_TIMING, NETFLIX_GLYPHS],
    notChecked: [
      'Transliteration of names, honorifics, and the treatment of quotes and forced narratives (judgement).',
      'Ellipses for pauses and interruptions (judgement).',
      'Exceptions to one line when it fits: three or more punctuation marks, or a quotation (judgement).',
      'Timing to the audio and to shot changes (need the audio and the picture).',
    ],
    rules: {
      ...netflixTiming(),
      'max-lines': {
        severity: 'warning',
        params: { max: 2 },
        source: 'netflix-ko',
        section: sec('I.11. Line Treatment', 'II.4 Line Treatment'),
      },
      'line-length': {
        severity: 'warning',
        params: { max: 16, halfWidth: 0.5 },
        source: 'netflix-ko',
        section: sec('I.2. Character Limitation', 'II.2. Character Limitation'),
      },
      'chars-per-second': {
        severity: 'warning',
        params: { max: cps, halfWidth: 0.5 },
        source: 'netflix-ko',
        section: sec('I.15. Reading Speed Limits', 'II.3. Reading Speed Limit'),
      },
      'single-line': {
        severity: 'info',
        params: { maxChars: 16, halfWidth: 0.5 },
        source: 'netflix-ko',
        section: sec('I.11. Line Treatment', 'II.4 Line Treatment'),
      },
      'line-shape': {
        severity: 'info',
        params: { maxChars: 16, halfWidth: 0.5 },
        source: 'netflix-ko',
        section: 'I.11. Line Treatment',
      },
      centred: { severity: 'info', source: 'netflix-general', section: '5. Positioning' },
      'glyph-list': {
        severity: 'warning',
        source: 'netflix-glyphs',
        section: 'General Requirements 3. Glyph List',
      },
      'ko-punctuation': { severity: 'warning', source: 'netflix-ko', section: 'I.13. Punctuation' },
      'ellipsis-character': {
        severity: 'warning',
        source: 'netflix-ko',
        section: 'I.4. Continuity',
      },
      'acronym-periods': { severity: 'warning', source: 'netflix-ko', section: 'I.1. Acronyms' },
      'no-italics': { severity: 'warning', source: 'netflix-ko', section: 'I.10. Italics' },
      'speaker-hyphen': {
        severity: 'warning',
        params: { space: 1 },
        source: 'netflix-ko',
        section: 'I.6. Dual Speakers',
      },
      ...(sdh
        ? {
            'lyrics-notes': {
              severity: 'info' as const,
              params: { space: 1 },
              source: 'netflix-ko',
              section: 'II.7 Songs and Music',
            },
          }
        : {}),
    },
  };
};

export const NETFLIX_KO_ADULT = netflixKorean(false, false);
export const NETFLIX_KO_CHILDREN = netflixKorean(false, true);
export const NETFLIX_KO_SDH = netflixKorean(true, false);
export const NETFLIX_KO_SDH_CHILDREN = netflixKorean(true, true);

/**
 * Japanese subtitles and SDH: 13 characters per horizontal line (16 for SDH), 11 per vertical
 * line, half-width characters counting as half.
 */
const netflixJapanese = (sdh: boolean): Ruleset => {
  const sec = (regular: string, forSdh: string): string => (sdh ? forSdh : regular);
  const chars = sdh ? 16 : 13;
  const cps = sdh ? 7 : 4;
  return {
    id: `netflix-ja${sdh ? '-sdh' : ''}`,
    name: `Netflix Japanese${sdh ? ' SDH' : ''}`,
    description: `Netflix’s Japanese guide with the general requirements and timing guidelines, ${sdh ? 'for subtitles for the deaf and hard of hearing' : 'for subtitles'}: ${chars} characters per horizontal line and 11 per vertical line, half-width characters counting as half, and ${cps} characters per second.`,
    language: 'ja',
    sources: [NETFLIX_JA, NETFLIX_JA_IMSC, NETFLIX_GENERAL, NETFLIX_TIMING, NETFLIX_GLYPHS],
    notChecked: [
      'Netflix takes Japanese subtitles only as IMSC 1.1 (TTML), not WebVTT (I.1); the Japanese IMSC 1.1 Creation Guide sets its attributes.',
      'Ruby and bouten placement, vertical positioning and kumi-moji (tate-chū-yoko) numbers in vertical cues.',
      'Italics for forced narratives, voices through devices, narration and lyrics; two-em dashes for continuity and the three-dot leader; chidori lyrics (judgement).',
      'Kanji for children’s content, names, and timing to the audio and to shot changes.',
    ],
    rules: {
      ...(sdh ? netflixTiming() : netflixTiming(500, 'netflix-ja', 'I.9. Duration (0.5 second)')),
      'max-lines': {
        severity: 'warning',
        params: { max: 2 },
        source: 'netflix-ja',
        section: sec('I.14. Line Limitation', 'II.13. Line Limitation'),
      },
      'line-length': {
        severity: 'warning',
        params: { max: chars, maxVertical: 11, halfWidth: 0.5 },
        source: 'netflix-ja',
        section: sec('I.5. Character Limitation', 'II.6. Character Limitation'),
      },
      'chars-per-second': {
        severity: 'warning',
        params: { max: cps, halfWidth: 0.5 },
        source: 'netflix-ja',
        section: sec('I.19. Reading Speed Limits', 'II.18. Reading Speed Limits'),
      },
      'glyph-list': {
        severity: 'warning',
        source: 'netflix-glyphs',
        section: 'General Requirements 3. Glyph List',
      },
      'ja-punctuation': {
        severity: 'warning',
        source: 'netflix-ja',
        section: sec(
          'I.17. Punctuation; I.12. Foreign Dialogue',
          'II.16. Punctuation; II.11. Foreign Dialogue',
        ),
      },
      'ja-numbers': {
        severity: 'warning',
        source: 'netflix-ja',
        section: sec('I.15. Numbers', 'II.14. Numbers'),
      },
      'ja-latin': {
        severity: 'info',
        source: 'netflix-ja',
        section: sec(
          'I.2. Acronyms & Latin Alphabet Characters',
          'II.3. Acronyms & Latin Alphabet Characters',
        ),
      },
      ...(sdh
        ? {}
        : {
            // Allowed in SDH (II.6).
            'half-width-katakana': {
              severity: 'warning' as const,
              source: 'netflix-ja',
              section: 'I.5. Character Limitation (II.6 allows it in SDH only)',
            },
          }),
    },
  };
};

export const NETFLIX_JA_ADULT = netflixJapanese(false);
export const NETFLIX_JA_SDH = netflixJapanese(true);

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
  NETFLIX_ZH_HANS_ADULT,
  NETFLIX_ZH_HANS_CHILDREN,
  NETFLIX_ZH_HANS_SDH,
  NETFLIX_ZH_HANS_SDH_CHILDREN,
  NETFLIX_ZH_HANT_ADULT,
  NETFLIX_ZH_HANT_CHILDREN,
  NETFLIX_ZH_HANT_SDH,
  NETFLIX_ZH_HANT_SDH_CHILDREN,
  NETFLIX_JA_ADULT,
  NETFLIX_JA_SDH,
  NETFLIX_KO_ADULT,
  NETFLIX_KO_CHILDREN,
  NETFLIX_KO_SDH,
  NETFLIX_KO_SDH_CHILDREN,
  BBC_SUBTITLES,
  WCAG,
];
