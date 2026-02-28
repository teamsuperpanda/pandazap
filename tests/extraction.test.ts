import { describe, it, expect } from 'vitest';
import { extractQACardsFromText } from '../src/sync/extractionUtils';
import { PandaZapSettings } from '../src/sync/types';

const defaultSettings: PandaZapSettings = {
  ankiConnectUrl: 'http://127.0.0.1',
  ankiConnectPort: 8765,
  defaultDeck: 'Default',
  deckOverrideWord: 'Deck',
  questionWord: 'Q',
  answerWord: 'A',
  noteType: 'Basic',
  useNoteBased: true,
  boldQuestionInReadingMode: true,
  imageWord: 'I',
};

describe('extractQACardsFromText', () => {
  it('should handle empty or null input gracefully', () => {
    expect(extractQACardsFromText('', defaultSettings)).toEqual([]);
    expect(extractQACardsFromText(null as any, defaultSettings)).toEqual([]);
    expect(extractQACardsFromText('test', null as any)).toEqual([]);
  });

  it('should extract single line Q&A cards', () => {
    const content = 'Q: What is TypeScript? A: A typed superset of JavaScript';
    const cards = extractQACardsFromText(content, defaultSettings);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual({
      question: 'What is TypeScript?',
      answer: 'A typed superset of JavaScript',
      line: 1,
    });
  });

  it('should extract multi-line Q&A cards', () => {
    const content = `Q: What is React?
A: A JavaScript library for building user interfaces
It was created by Facebook`;

    const cards = extractQACardsFromText(content, defaultSettings);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual({
      question: 'What is React?',
      answer: 'A JavaScript library for building user interfaces\nIt was created by Facebook',
      line: 1,
    });
  });

  it('should handle custom question and answer words', () => {
    const customSettings = {
      ...defaultSettings,
      questionWord: 'Question',
      answerWord: 'Answer',
    };

    const content = 'Question: What is Vue? Answer: A progressive JavaScript framework';
    const cards = extractQACardsFromText(content, customSettings);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('What is Vue?');
    expect(cards[0].answer).toBe('A progressive JavaScript framework');
  });

  it('should return empty array for invalid input', () => {
    expect(extractQACardsFromText('No Q&A here', defaultSettings)).toEqual([]);
    expect(extractQACardsFromText('Q: Question but no answer', defaultSettings)).toEqual([]);
  });
});
