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
  sources: [NETFLIX_GENERAL, NETFLIX_EN_US],
  notChecked: [
    'Accuracy and completeness against the audio, italics use, numbers, punctuation style and quotations (judgement, or need the audio).',
    'Frame gaps and shot changes: in Netflix’s separate timing guidelines, which were not supplied.',
    'The Netflix glyph list: a separate document, not supplied.',
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

export const BBC_SUBTITLES: Ruleset = {
  id: 'bbc',
  name: 'BBC',
  description:
    'The BBC Subtitle Guidelines for landscape video. Line length uses the broadcast (Teletext) limit; online, lines are limited by width, which is about the same at the BBC’s font size.',
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
  BBC_SUBTITLES,
  WCAG,
];
