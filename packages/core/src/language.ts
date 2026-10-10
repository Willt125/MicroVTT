/**
 * The language of a document: explicit hints (a `Language:` header line, `<lang>` markup around
 * every cue, a language code in the file name) and, without one, a cautious guess from the text.
 */
import { isValidLanguageTag } from './bcp47.ts';
import { parseCueText, type CueNode } from './cuetext.ts';
import type { Cue, Note, VttDocument } from './document.ts';

export type LanguageHintSource = 'header' | 'markup' | 'file-name';

export interface LanguageHint {
  /** A BCP 47 tag. */
  tag: string;
  source: LanguageHintSource;
}

let names: Intl.DisplayNames | null | undefined;
/** The English name of a language tag, or null for a code no one has registered. */
export function languageName(tag: string): string | null {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
    } catch {
      names = null;
    }
  }
  if (!names) return null;
  try {
    return names.of(tag) ?? null;
  } catch {
    return null;
  }
}

const cuesOf = (doc: VttDocument): Cue[] =>
  doc.body.filter((item): item is Cue => item.type === 'cue');

/** The language of a `Language:` line kept from the file's header (YouTube writes one). */
function headerLanguage(doc: VttDocument): string | null {
  const header = doc.head.find(
    (item): item is Note => item.type === 'note' && item.preserved === 'header',
  );
  const tag = header ? /^Language:[ \t]*(\S+)/m.exec(header.text)?.[1] : undefined;
  return tag !== undefined && isValidLanguageTag(tag) ? tag : null;
}

/** The language when every cue's text is wrapped in one `<lang>` span, all the same. */
function markupLanguage(doc: VttDocument): string | null {
  let tag: string | null = null;
  for (const cue of cuesOf(doc)) {
    const nodes = parseCueText(cue.text).children.filter(
      (n: CueNode) => !(n.type === 'text' && n.value.trim() === ''),
    );
    const [only] = nodes;
    if (nodes.length !== 1 || only?.type !== 'lang' || !only.language) return null;
    if (tag !== null && only.language !== tag) return null;
    tag = only.language;
  }
  return tag !== null && isValidLanguageTag(tag) ? tag : null;
}

/**
 * A language code before the extension, as video downloaders name subtitle files
 * ("talk.fi.vtt", "talk.en-US.vtt", "talk.en-orig.vtt"). Only registered languages count, so
 * "notes.final.vtt" gives none.
 */
function fileNameLanguage(fileName: string): string | null {
  const m = /\.([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)\.[A-Za-z0-9]+$/.exec(fileName);
  if (!m) return null;
  const tag = (m[1] as string).replace(/_/g, '-').replace(/-orig$/i, '');
  const primary = tag.split('-')[0] as string;
  if (!isValidLanguageTag(tag) || languageName(primary) === null) return null;
  return tag;
}

/** The document's language from what the file says, if it says. */
export function languageHint(doc: VttDocument, fileName?: string): LanguageHint | null {
  const header = headerLanguage(doc);
  if (header) return { tag: header, source: 'header' };
  const markup = markupLanguage(doc);
  if (markup) return { tag: markup, source: 'markup' };
  const named = fileName ? fileNameLanguage(fileName) : null;
  if (named) return { tag: named, source: 'file-name' };
  return null;
}

/* ---------- Guessing ---------- */

/** Scripts that, on their own, name one language confidently enough to ask. */
const SINGLE_LANGUAGE_SCRIPTS: [RegExp, string][] = [
  [/\p{Script=Hangul}/u, 'ko'],
  [/\p{Script=Thai}/u, 'th'],
  [/\p{Script=Lao}/u, 'lo'],
  [/\p{Script=Khmer}/u, 'km'],
  [/\p{Script=Myanmar}/u, 'my'],
  [/\p{Script=Georgian}/u, 'ka'],
  [/\p{Script=Armenian}/u, 'hy'],
  [/\p{Script=Greek}/u, 'el'],
  [/\p{Script=Hebrew}/u, 'he'],
  [/\p{Script=Sinhala}/u, 'si'],
  [/\p{Script=Tamil}/u, 'ta'],
  [/\p{Script=Telugu}/u, 'te'],
  [/\p{Script=Kannada}/u, 'kn'],
  [/\p{Script=Malayalam}/u, 'ml'],
  [/\p{Script=Gujarati}/u, 'gu'],
  [/\p{Script=Gurmukhi}/u, 'pa'],
  [/\p{Script=Oriya}/u, 'or'],
];

/**
 * Letters that set one language apart from the others written in the same script, checked in
 * order: the first whose letters make up at least the given share of the script's letters wins.
 * A text that matches none gets no guess.
 */
const DISTINCT_LETTERS: Record<string, [RegExp, string, number][]> = {
  Arabic: [
    [/[ۇۈۋ]/gu, 'ug', 0.005],
    [/[ټډړښږځڅ]/gu, 'ps', 0.005],
    [/[ڕڵۆێ]/gu, 'ckb', 0.005],
    [/[ٹڈڑںے]/gu, 'ur', 0.005],
    [/[پچژگیک]/gu, 'fa', 0.01],
    [/[ةىيك]/gu, 'ar', 0.01],
  ],
  Cyrillic: [
    // Other Turkic and Tajik letters first, so those languages get no guess.
    [/[ҙҫҡҗӯӣҳҷ]/giu, '', 0.002],
    [/[ұ]/giu, 'kk', 0.002],
    [/[әңөү]/giu, '', 0.002],
    [/[ў]/giu, 'be', 0.002],
    [/[єїґ]/giu, 'uk', 0.002],
    [/[ђћ]/giu, 'sr', 0.002],
    [/[ѓќѕ]/giu, 'mk', 0.002],
    [/[ыэ]/giu, 'ru', 0.01],
    [/[ъ]/giu, 'bg', 0.01],
  ],
  Bengali: [
    [/[ৰৱ]/gu, 'as', 0.003],
    [/[\u0980-\u09ff]/gu, 'bn', 0.5],
  ],
};

/**
 * Common short words of each language: articles, pronouns, conjunctions, prepositions and the
 * commonest verbs. A language must match many more of a text's words than any other to count.
 */
const FUNCTION_WORDS: Record<string, string> = {
  en: 'the and you that is to of it what this in was for have are not with be on he we they',
  es: 'el la que de y en los se no es un una por con para lo las pero qué está muy',
  pt: 'o a que de e não é um uma os do da em para com você está eu isso mas',
  fr: 'le la les de et que est un une je vous pas il ce des en pour qui sur avec mais',
  de: 'der die das und ist nicht ich du sie es ein eine zu mit auf den dem was wir aber',
  it: 'il la che di e non è un una per sono mi ti lo ho gli ma questo cosa anche',
  nl: 'de het een en van ik je niet dat is wat op te zijn met maar hij ze er',
  fi: 'ja on ei se että en olen hän me te he mitä mutta kun tämä niin jos ole oli',
  sv: 'och att det är jag inte du en som på för med har vad men han hon vi ett',
  da: 'og at det er jeg ikke du en som på for med har hvad men han hun af mig dig',
  nb: 'og at det er jeg ikke du en som på for med har hva men han hun av meg deg',
  pl: 'i nie się w na to że jest z co do jak tak ale ja ty mi już',
  cs: 'a je to že se na v jsem co jak ale tak už mi by být není',
  hu: 'a az és hogy nem van is egy meg de ez mi csak már még igen',
  ro: 'și de în nu că să este la cu un o pe ce mai dar am eu',
  tr: 've bir bu da de ne için çok ben sen o ama mi var yok gibi',
  id: 'yang dan di itu ini tidak saya aku kamu dengan untuk ada apa akan ke dari',
  vi: 'và là của có không tôi anh em một những cho được này người với',
  et: 'ja on ei et see ma sa ta mis aga kui oli nii veel ka',
  sk: 'a je to že sa na v som čo ako ale tak už mi by byť nie',
  ca: 'i el la que de en no és un una per amb els les em però molt',
  tl: 'ang ng sa na at mga ako ka hindi ko mo siya ito ay',
  sw: 'na ya wa ni kwa za la katika hii sana mimi wewe yeye',
  hi: 'है के में की और से को नहीं यह कि हैं तो था पर भी',
  mr: 'आहे आणि नाही मी तू हे ते का तर पण होते आम्ही',
  ne: 'छ र मा हो छैन यो त्यो पनि गर्न थियो हुन्छ',
};

const DEVANAGARI = ['hi', 'mr', 'ne'];
const WORDS = new Map(
  Object.entries(FUNCTION_WORDS).map(([tag, list]) => [tag, new Set(list.split(' '))]),
);

/** Simplified and traditional forms of common characters, both ways. */
const SIMPLIFIED = /[们这说时个国来会对没吗为过还经么问题]/gu;
const TRADITIONAL = /[們這說時個國來會對沒嗎為過還經麼問題]/gu;

export interface LanguageGuess {
  tag: string;
  /** Share of the sample's letters (by script) or words (by vocabulary) that point to it. */
  score: number;
}

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

/** Letters of each script, for the scripts present. */
function scripts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.matchAll(
    /(\p{Script=Latin}+)|(\p{Script=Cyrillic}+)|(\p{Script=Arabic}+)|(\p{Script=Devanagari}+)|(\p{Script=Bengali}+)|([\p{Script=Hiragana}\p{Script=Katakana}]+)|(\p{Script=Han}+)|(\p{L}+)/gu,
  )) {
    const name =
      ['Latin', 'Cyrillic', 'Arabic', 'Devanagari', 'Bengali', 'Kana', 'Han', 'Other'][
        m.slice(1).findIndex((g) => g !== undefined)
      ] ?? 'Other';
    out.set(name, (out.get(name) ?? 0) + [...(m[0] as string)].length);
  }
  return out;
}

/** The language a word list points to clearly, among those written in the text's script. */
function byVocabulary(text: string, candidates: string[]): LanguageGuess | null {
  const words = text.toLowerCase().match(/[\p{L}\p{M}’']+/gu) ?? [];
  if (words.length < 20) return null;
  const scored = candidates
    .map((tag) => {
      const set = WORDS.get(tag) as Set<string>;
      return { tag, hits: words.filter((w) => set.has(w)).length };
    })
    .sort((a, b) => b.hits - a.hits);
  const [best, second] = scored;
  if (!best || best.hits / words.length < 0.12) return null;
  if (second && second.hits * 1.5 > best.hits) return null;
  return { tag: best.tag, score: best.hits / words.length };
}

/** The first language whose distinguishing letters are common enough (see DISTINCT_LETTERS). */
function byLetters(
  text: string,
  letters: number,
  table: [RegExp, string, number][],
): string | null {
  for (const [re, tag, min] of table) if (count(text, re) / letters >= min) return tag || null;
  return null;
}

/**
 * A guess at the language of some text, only when it is fairly sure: one script dominates, and
 * either the script is written for essentially one language or the words or letters point
 * clearly to one. Null otherwise; never a reason to change anything without asking.
 */
export function guessLanguage(text: string): LanguageGuess | null {
  const byScript = scripts(text);
  const total = [...byScript.values()].reduce((a, b) => a + b, 0);
  if (total < 30) return null;
  const share = (name: string): number => (byScript.get(name) ?? 0) / total;

  // Japanese mixes kana with Han; a little kana is enough.
  if (share('Kana') > 0.1 && share('Kana') + share('Han') > 0.7)
    return { tag: 'ja', score: share('Kana') + share('Han') };
  if (share('Han') > 0.7) {
    const s = count(text, SIMPLIFIED);
    const t = count(text, TRADITIONAL);
    const tag = s > t * 3 ? 'zh-Hans' : t > s * 3 ? 'zh-Hant' : 'zh';
    return { tag, score: share('Han') };
  }
  const other = share('Other');
  if (other > 0.7) {
    for (const [re, tag] of SINGLE_LANGUAGE_SCRIPTS) {
      const n = count(text, new RegExp(re.source, 'gu'));
      if (n / total > 0.7) return { tag, score: n / total };
    }
    return null;
  }
  const words = (candidates: string[]) => byVocabulary(text, candidates);
  if (share('Latin') > 0.8)
    return words([...WORDS.keys()].filter((tag) => !DEVANAGARI.includes(tag)));
  if (share('Devanagari') > 0.8) return words(DEVANAGARI);
  for (const [name, table] of Object.entries(DISTINCT_LETTERS)) {
    if (share(name) <= 0.8) continue;
    const tag = byLetters(text, byScript.get(name) ?? 0, table);
    return tag ? { tag, score: share(name) } : null;
  }
  return null;
}

/** The readable text of the first cues, enough to guess from. */
export function sampleText(doc: VttDocument, maxChars = 20000): string {
  let out = '';
  for (const cue of cuesOf(doc)) {
    out += `${cue.text.replace(/<[^>]*>/g, '').replace(/&[a-z]+;|&#\w+;/gi, ' ')}\n`;
    if (out.length >= maxChars) break;
  }
  return out;
}
