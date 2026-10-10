import { describe, expect, it } from 'vitest';
import {
  createCue,
  createDocument,
  guessLanguage,
  importDocument,
  languageHint,
  languageName,
  sampleText,
} from '../src/index.ts';

const docOf = (text: string) => importDocument(text).document;

describe('language hints', () => {
  it('reads a Language: header line', () => {
    const doc = docOf('WEBVTT\nKind: captions\nLanguage: fi\n\n00:00.000 --> 00:01.000\nHei\n');
    expect(languageHint(doc, 'video.en.vtt')).toEqual({ tag: 'fi', source: 'header' });
  });

  it('reads <lang> markup around every cue', () => {
    const doc = docOf(
      'WEBVTT\n\n00:00.000 --> 00:01.000\n<lang ja>こんにちは</lang>\n\n00:01.000 --> 00:02.000\n<lang ja>はい</lang>\n',
    );
    expect(languageHint(doc)).toEqual({ tag: 'ja', source: 'markup' });
    const mixed = docOf(
      'WEBVTT\n\n00:00.000 --> 00:01.000\n<lang ja>こんにちは</lang>\n\n00:01.000 --> 00:02.000\nHello\n',
    );
    expect(languageHint(mixed)).toBeNull();
  });

  it('reads a language code in the file name', () => {
    const doc = createDocument();
    expect(languageHint(doc, 'talk [abc].fi.vtt')).toEqual({ tag: 'fi', source: 'file-name' });
    expect(languageHint(doc, 'talk.en-US.vtt')?.tag).toBe('en-US');
    expect(languageHint(doc, 'talk.en-orig.vtt')?.tag).toBe('en');
    expect(languageHint(doc, 'talk.pt_BR.vtt')?.tag).toBe('pt-BR');
    expect(languageHint(doc, 'notes.final.vtt')).toBeNull();
    expect(languageHint(doc, 'notes.xq.vtt')).toBeNull();
    expect(languageHint(doc, 'talk.vtt')).toBeNull();
  });

  it('names languages', () => {
    expect(languageName('fi')).toBe('Finnish');
    expect(languageName('xq')).toBeNull();
  });
});

describe('language guesses', () => {
  const samples: [string, string][] = [
    [
      'en',
      'So what do you think about the new plan? I think that it is not bad, but we have to talk with them before we are sure. They said it was fine for now.',
    ],
    [
      'fi',
      'Mitä mieltä olet uudesta suunnitelmasta? Minusta se ei ole huono, mutta meidän täytyy puhua heidän kanssaan. Jos he sanovat että se on hyvä, niin tämä on valmis kun me olemme.',
    ],
    [
      'es',
      '¿Qué piensas del nuevo plan? Creo que no está mal, pero tenemos que hablar con ellos antes de decidir. Lo que dijeron es que por ahora está muy bien para la empresa.',
    ],
    [
      'de',
      'Was hältst du von dem neuen Plan? Ich denke, das ist nicht schlecht, aber wir müssen mit ihnen reden. Sie sagen, es ist gut, und das ist auch was wir auf der Liste haben.',
    ],
    [
      'fr',
      'Que pensez-vous du nouveau plan ? Je pense que ce n’est pas mal, mais il faut en parler avec eux. Ils disent que la situation est bonne pour le moment et que vous pouvez venir.',
    ],
    [
      'ja',
      '今日はいい天気ですね。散歩に行きましょうか。そうですね、公園まで歩いて、それからお昼ご飯を食べましょう。',
    ],
    [
      'zh-Hans',
      '我们今天去公园吗？这个时候人很多，没有地方坐。对，我们还是在家里看电视吧，你说呢？',
    ],
    [
      'zh-Hant',
      '我們今天去公園嗎？這個時候人很多，沒有地方坐。對，我們還是在家裡看電視吧，你說呢？',
    ],
    ['ko', '오늘 날씨가 정말 좋네요. 공원에 산책하러 갈까요? 네, 좋아요. 점심도 같이 먹어요.'],
    [
      'th',
      'วันนี้อากาศดีมากครับ เราไปเดินเล่นที่สวนสาธารณะกันไหม ได้เลยครับ แล้วกินข้าวเที่ยงด้วยกัน',
    ],
    ['he', 'מה אתה חושב על התוכנית החדשה? אני חושב שהיא לא רעה, אבל אנחנו צריכים לדבר איתם קודם.'],
    [
      'ar',
      'ما رأيك في الخطة الجديدة؟ أعتقد أنها ليست سيئة، لكن يجب أن نتحدث معهم أولاً. قالوا إن كل شيء على ما يرام في المدينة.',
    ],
    [
      'fa',
      'نظر شما درباره برنامه جدید چیست؟ فکر می\u200cکنم بد نیست، ولی باید اول با آنها صحبت کنیم. گفتند که همه چیز خوب است.',
    ],
    [
      'ur',
      'آپ نئے منصوبے کے بارے میں کیا سوچتے ہیں؟ میرے خیال میں یہ برا نہیں ہے، لیکن ہمیں پہلے ان سے بات کرنی چاہیے۔',
    ],
    [
      'ru',
      'Что ты думаешь о новом плане? Я думаю, что он неплохой, но мы должны сначала поговорить с ними. Они сказали, что это вы решите.',
    ],
    [
      'uk',
      'Що ти думаєш про новий план? Я думаю, що він непоганий, але ми маємо спочатку поговорити з ними. Вони сказали, що все гаразд і їм подобається.',
    ],
    [
      'hi',
      'आप नई योजना के बारे में क्या सोचते हैं? मुझे लगता है कि यह बुरी नहीं है, लेकिन हमें पहले उनसे बात करनी है। उन्होंने कहा कि सब ठीक है और यह काम भी हो जाएगा तो फिर से देखेंगे।',
    ],
  ];
  it.each(samples)('recognizes %s', (tag, text) => {
    expect(guessLanguage(text)?.tag).toBe(tag);
  });

  it('stays quiet when unsure', () => {
    expect(guessLanguage('OK')).toBeNull();
    expect(
      guessLanguage(
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      ),
    ).toBeNull();
    // Half English, half Japanese.
    expect(
      guessLanguage(
        'This is a test of the system. これはシステムのテストです。This is only a test.',
      ),
    ).toBeNull();
    // Mongolian Cyrillic: no confident Cyrillic language.
    expect(
      guessLanguage(
        'Сайн байна уу? Өнөөдөр цаг агаар үнэхээр сайхан байна. Бид цэцэрлэгт хүрээлэнд зугаалах уу?',
      ),
    ).toBeNull();
  });

  it('samples cue text without markup', () => {
    const doc = { ...createDocument(), body: [createCue(0, 1000, '<i>Hei</i> &amp; moi')] };
    expect(sampleText(doc)).toBe('Hei   moi\n');
  });
});
