import { describe, it, expect } from 'vitest';
import {
  ANKI_CONNECT_PORT_MAX,
  buildAnkiConnectUrl,
  markerLabels,
  normalizeSettings,
  parseAnkiConnectUrl,
  parsePort,
  validateDeckName,
  validateDeckOverrideWord,
  validateMarkerWord,
} from '../src/settings';
import { buildMarkerRegexes } from '../src/sync/markers';
import { DEFAULT_SETTINGS } from '../src/sync/types';

describe('normalizeSettings', () => {
  it('returns the defaults for missing or non-object data', () => {
    for (const raw of [undefined, null, [], 'settings', 42, true]) {
      expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps valid values and trims strings', () => {
    expect(
      normalizeSettings({
        ankiConnectUrl: '  https://anki.local:9000  ',
        ankiConnectPort: 9000,
        defaultDeck: '  Languages  ',
        deckOverrideWord: '  Deck  ',
        questionWord: '  Question  ',
        answerWord: ' Answer ',
        imageWord: ' Image ',
        noteType: '  Cloze  ',
        useNoteBased: false,
        boldQuestionInReadingMode: false,
      })
    ).toEqual({
      ankiConnectUrl: 'https://anki.local:9000',
      ankiConnectPort: 9000,
      defaultDeck: 'Languages',
      deckOverrideWord: 'Deck',
      questionWord: 'Question',
      answerWord: 'Answer',
      imageWord: 'Image',
      noteType: 'Cloze',
      useNoteBased: false,
      boldQuestionInReadingMode: false,
    });
  });

  it('accepts a port stored as a numeric string', () => {
    expect(normalizeSettings({ ankiConnectPort: '8766' }).ankiConnectPort).toBe(8766);
    expect(normalizeSettings({ ankiConnectPort: ' 8767 ' }).ankiConnectPort).toBe(8767);
  });

  it('falls back to the default for out-of-range ports', () => {
    for (const port of [0, -20, 70000, '0', '70000', '-1']) {
      expect(normalizeSettings({ ankiConnectPort: port }).ankiConnectPort).toBe(
        DEFAULT_SETTINGS.ankiConnectPort
      );
    }
  });

  it('accepts in-range ports only', () => {
    expect(normalizeSettings({ ankiConnectPort: 1 }).ankiConnectPort).toBe(1);
    expect(normalizeSettings({ ankiConnectPort: ANKI_CONNECT_PORT_MAX }).ankiConnectPort).toBe(
      ANKI_CONNECT_PORT_MAX
    );
  });

  it('falls back for non-numeric or non-integer ports', () => {
    for (const port of ['abc', '', '8765.5', 8765.5, Number.NaN, null, {}, []]) {
      expect(normalizeSettings({ ankiConnectPort: port }).ankiConnectPort).toBe(
        DEFAULT_SETTINGS.ankiConnectPort
      );
    }
  });

  it('accepts http(s) URLs unchanged', () => {
    expect(normalizeSettings({ ankiConnectUrl: 'http://192.168.1.5' }).ankiConnectUrl).toBe(
      'http://192.168.1.5'
    );
    expect(normalizeSettings({ ankiConnectUrl: 'https://anki.local/path' }).ankiConnectUrl).toBe(
      'https://anki.local/path'
    );
  });

  it('gives bare hosts an http scheme', () => {
    expect(normalizeSettings({ ankiConnectUrl: 'localhost:8765' }).ankiConnectUrl).toBe(
      'http://localhost:8765'
    );
    expect(normalizeSettings({ ankiConnectUrl: '192.168.1.5:8765' }).ankiConnectUrl).toBe(
      'http://192.168.1.5:8765'
    );
    expect(normalizeSettings({ ankiConnectUrl: 'localhost/proxy' }).ankiConnectUrl).toBe(
      'http://localhost/proxy'
    );
    expect(normalizeSettings({ ankiConnectUrl: '  anki.local  ' }).ankiConnectUrl).toBe(
      'http://anki.local'
    );
  });

  it('falls back for unusable URLs', () => {
    for (const url of ['ftp://anki.local', 'http://', 'not a url', '', '   ', null, 42]) {
      expect(normalizeSettings({ ankiConnectUrl: url }).ankiConnectUrl).toBe(
        DEFAULT_SETTINGS.ankiConnectUrl
      );
    }
  });

  it('falls back for empty marker words', () => {
    const settings = normalizeSettings({
      questionWord: '',
      answerWord: '   ',
      imageWord: '\n',
      deckOverrideWord: '',
    });
    expect(settings.questionWord).toBe(DEFAULT_SETTINGS.questionWord);
    expect(settings.answerWord).toBe(DEFAULT_SETTINGS.answerWord);
    expect(settings.imageWord).toBe(DEFAULT_SETTINGS.imageWord);
    expect(settings.deckOverrideWord).toBe(DEFAULT_SETTINGS.deckOverrideWord);
  });

  it('keeps a colon in the deck override word but rejects line breaks', () => {
    expect(normalizeSettings({ deckOverrideWord: ' Deck: ' }).deckOverrideWord).toBe('Deck:');
    expect(normalizeSettings({ deckOverrideWord: 'Deck\nOther' }).deckOverrideWord).toBe(
      DEFAULT_SETTINGS.deckOverrideWord
    );
  });

  it('falls back for marker words that break parsing', () => {
    const settings = normalizeSettings({
      questionWord: 'Q:',
      answerWord: 'A\nB',
      imageWord: ':',
    });
    expect(settings.questionWord).toBe(DEFAULT_SETTINGS.questionWord);
    expect(settings.answerWord).toBe(DEFAULT_SETTINGS.answerWord);
    expect(settings.imageWord).toBe(DEFAULT_SETTINGS.imageWord);
  });

  it('falls back for a default deck that breaks the deck query', () => {
    expect(normalizeSettings({ defaultDeck: ' Languages ' }).defaultDeck).toBe('Languages');
    expect(normalizeSettings({ defaultDeck: 'Deck\nOther' }).defaultDeck).toBe(
      DEFAULT_SETTINGS.defaultDeck
    );
    expect(normalizeSettings({ defaultDeck: 'Deck\r\nOther' }).defaultDeck).toBe(
      DEFAULT_SETTINGS.defaultDeck
    );
  });

  it('falls back for empty note type and default deck', () => {
    const settings = normalizeSettings({ noteType: '  ', defaultDeck: '' });
    expect(settings.noteType).toBe(DEFAULT_SETTINGS.noteType);
    expect(settings.defaultDeck).toBe(DEFAULT_SETTINGS.defaultDeck);
  });

  it('falls back for values of the wrong type', () => {
    const settings = normalizeSettings({
      ankiConnectUrl: 42,
      defaultDeck: null,
      deckOverrideWord: false,
      questionWord: ['Q'],
      answerWord: { word: 'A' },
      imageWord: 1,
      noteType: 2,
      useNoteBased: 'yes',
      boldQuestionInReadingMode: 1,
    });
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('drops unknown keys', () => {
    const result = normalizeSettings({ questionWord: 'Question', unknownKey: 'value' });
    expect(result).toEqual({ ...DEFAULT_SETTINGS, questionWord: 'Question' });
    expect(result).not.toHaveProperty('unknownKey');
  });

  it('does not mutate the raw data', () => {
    const raw = { questionWord: '  Question  ', ankiConnectPort: '9000' };
    normalizeSettings(raw);
    expect(raw).toEqual({ questionWord: '  Question  ', ankiConnectPort: '9000' });
  });
});

describe('markerLabels', () => {
  it('uses the default labels for default settings', () => {
    expect(markerLabels(DEFAULT_SETTINGS)).toEqual({
      q: DEFAULT_SETTINGS.questionWord,
      a: DEFAULT_SETTINGS.answerWord,
      i: DEFAULT_SETTINGS.imageWord,
    });
  });

  it('falls back to defaults for empty or invalid words', () => {
    expect(
      markerLabels({ ...DEFAULT_SETTINGS, questionWord: '', answerWord: '  ', imageWord: 'I:' })
    ).toEqual({
      q: DEFAULT_SETTINGS.questionWord,
      a: DEFAULT_SETTINGS.answerWord,
      i: DEFAULT_SETTINGS.imageWord,
    });
  });

  it('returns trimmed custom words', () => {
    expect(
      markerLabels({
        ...DEFAULT_SETTINGS,
        questionWord: ' Q ',
        answerWord: 'Ans',
        imageWord: 'Pic',
      })
    ).toEqual({ q: 'Q', a: 'Ans', i: 'Pic' });
  });
});

describe('validateMarkerWord', () => {
  it('rejects empty, whitespace only and newline values', () => {
    expect(validateMarkerWord('')).not.toBeNull();
    expect(validateMarkerWord('   ')).not.toBeNull();
    expect(validateMarkerWord('Q\nA')).not.toBeNull();
    expect(validateMarkerWord('Q\r')).not.toBeNull();
  });

  it('rejects values containing a colon', () => {
    expect(validateMarkerWord('Q:')).not.toBeNull();
    expect(validateMarkerWord(':')).not.toBeNull();
  });

  it('accepts usable marker words', () => {
    for (const word of ['Q', 'Question', 'My Question', '.', '*', '1']) {
      expect(validateMarkerWord(word), word).toBeNull();
    }
  });
});

describe('parseAnkiConnectUrl', () => {
  it('normalizes bare hosts and keeps explicit schemes', () => {
    expect(parseAnkiConnectUrl('localhost:8765')).toBe('http://localhost:8765');
    expect(parseAnkiConnectUrl('https://anki.local:9000')).toBe('https://anki.local:9000');
    expect(parseAnkiConnectUrl('localhost/anki')).toBe('http://localhost/anki');
  });

  it('rejects empty and non-http values', () => {
    for (const value of ['', '   ', 'ftp://anki.local', 'http://', 'not a url']) {
      expect(parseAnkiConnectUrl(value), value).toBeNull();
    }
  });
});

describe('validateDeckOverrideWord', () => {
  it('allows a colon and other text', () => {
    for (const word of ['Deck', 'Deck:', 'My Deck']) {
      expect(validateDeckOverrideWord(word), word).toBeNull();
    }
  });

  it('rejects empty and multi-line values', () => {
    expect(validateDeckOverrideWord('')).not.toBeNull();
    expect(validateDeckOverrideWord('   ')).not.toBeNull();
    expect(validateDeckOverrideWord('Deck\r\nOther')).not.toBeNull();
  });
});

describe('validateDeckName', () => {
  it('allows nested deck names and other text', () => {
    for (const name of ['Default', 'Languages::Spanish', 'My Deck']) {
      expect(validateDeckName(name), name).toBeNull();
    }
  });

  it('rejects empty and multi-line values', () => {
    expect(validateDeckName('')).not.toBeNull();
    expect(validateDeckName('   ')).not.toBeNull();
    expect(validateDeckName('Deck\r\nOther')).not.toBeNull();
  });
});

describe('parsePort', () => {
  it('accepts whole numbers in range', () => {
    expect(parsePort('1')).toBe(1);
    expect(parsePort('8765')).toBe(8765);
    expect(parsePort(` ${ANKI_CONNECT_PORT_MAX} `)).toBe(ANKI_CONNECT_PORT_MAX);
  });

  it('rejects anything else', () => {
    for (const value of ['', ' ', '0', '65536', '-1', '8765.5', 'abc', '12abc', '1e3']) {
      expect(parsePort(value), value).toBeNull();
    }
  });
});

describe('buildAnkiConnectUrl', () => {
  it('applies the configured port when the URL has none', () => {
    expect(buildAnkiConnectUrl(DEFAULT_SETTINGS)).toBe(
      `${DEFAULT_SETTINGS.ankiConnectUrl}:${DEFAULT_SETTINGS.ankiConnectPort}/`
    );
  });

  it('keeps a port already present in the URL', () => {
    expect(
      buildAnkiConnectUrl({
        ...DEFAULT_SETTINGS,
        ankiConnectUrl: 'http://127.0.0.1:9999',
        ankiConnectPort: 8765,
      })
    ).toBe('http://127.0.0.1:9999/');
  });

  it('keeps an explicit default port instead of applying the configured one', () => {
    expect(
      buildAnkiConnectUrl({
        ...DEFAULT_SETTINGS,
        ankiConnectUrl: 'https://anki.local:443',
        ankiConnectPort: 8765,
      })
    ).toBe('https://anki.local/');
    expect(
      buildAnkiConnectUrl({
        ...DEFAULT_SETTINGS,
        ankiConnectUrl: 'http://anki.local:80',
        ankiConnectPort: 8765,
      })
    ).toBe('http://anki.local/');
  });

  it('keeps a path and applies the configured port when the URL has none', () => {
    expect(
      buildAnkiConnectUrl({
        ...DEFAULT_SETTINGS,
        ankiConnectUrl: 'https://anki.local/anki',
        ankiConnectPort: 9000,
      })
    ).toBe('https://anki.local:9000/anki');
    expect(
      buildAnkiConnectUrl({
        ...DEFAULT_SETTINGS,
        ankiConnectUrl: 'http://anki.local:9000/anki',
        ankiConnectPort: 8765,
      })
    ).toBe('http://anki.local:9000/anki');
  });

  it('keeps the port of a normalized bare host', () => {
    const settings = normalizeSettings({ ankiConnectUrl: 'localhost:8765', ankiConnectPort: 9000 });
    expect(settings.ankiConnectUrl).toBe('http://localhost:8765');
    expect(buildAnkiConnectUrl(settings)).toBe('http://localhost:8765/');
  });

  it('treats an empty URL as the default host', () => {
    expect(buildAnkiConnectUrl({ ...DEFAULT_SETTINGS, ankiConnectUrl: '' })).toBe(
      `${DEFAULT_SETTINGS.ankiConnectUrl}:${DEFAULT_SETTINGS.ankiConnectPort}/`
    );
  });
});

describe('marker consistency', () => {
  it('preview labels match extraction labels when settings are empty', () => {
    const settings = { ...DEFAULT_SETTINGS, questionWord: '', answerWord: '', imageWord: '' };
    const labels = markerLabels(settings);
    const regexes = buildMarkerRegexes(settings);

    expect(`${labels.q}:`).toBe(regexes.qFull);
    expect(`${labels.a}:`).toBe(regexes.aFull);
    expect(`${labels.i}:`).toBe(regexes.iFull);
  });

  it('preview labels match extraction labels after normalization', () => {
    const settings = normalizeSettings({ questionWord: 'Question', answerWord: 'Answer' });
    const labels = markerLabels(settings);
    const regexes = buildMarkerRegexes(settings);

    expect(`${labels.q}:`).toBe(regexes.qFull);
    expect(`${labels.a}:`).toBe(regexes.aFull);
    expect(regexes.qLabel.test('Question: What?')).toBe(true);
    expect(regexes.aLabel.test('Answer: That.')).toBe(true);
  });
});
