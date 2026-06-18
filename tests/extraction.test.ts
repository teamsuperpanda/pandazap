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
    expect(extractQACardsFromText('Q: just a question with nothing after', defaultSettings)).toEqual([]);
  });

  it('should capture bullet points after Q: without explicit A:', () => {
    const content = `Q: What are the types of fruit?
- Apple
- Banana
- Orange`;

    const cards = extractQACardsFromText(content, defaultSettings);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('What are the types of fruit?');
    expect(cards[0].answer).toBe('- Apple\n- Banana\n- Orange');
  });

  it('should capture tables after Q: without explicit A:', () => {
    const content = `Q: Conversion rates
| From | To | Rate |
| --- | --- | --- |
| USD | EUR | 0.85 |
| EUR | USD | 1.18 |`;

    const cards = extractQACardsFromText(content, defaultSettings);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Conversion rates');
    expect(cards[0].answer).toBe('| From | To | Rate |\n| --- | --- | --- |\n| USD | EUR | 0.85 |\n| EUR | USD | 1.18 |');
  });

  it('should handle bullet points with explicit A: on same Q: line', () => {
    const content = `Q: Key features? A:
- Fast
- Reliable
- Scalable`;

    const cards = extractQACardsFromText(content, defaultSettings);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Key features?');
    expect(cards[0].answer).toBe('- Fast\n- Reliable\n- Scalable');
  });

  it('should capture mixed content after Q: as answer', () => {
    const content = `Q: Steps to deploy
1. Build the app
2. Run tests
3. Deploy to server`;

    const cards = extractQACardsFromText(content, defaultSettings);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Steps to deploy');
    expect(cards[0].answer).toBe('1. Build the app\n2. Run tests\n3. Deploy to server');
  });

  it('should extract cards after YAML frontmatter', () => {
    const content = `---
title: My Notes
tags: [typescript, programming]
---

Q: What is TypeScript? A: A typed superset of JavaScript`;

    const cards = extractQACardsFromText(content, defaultSettings);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('What is TypeScript?');
  });

  it('should NOT extract cards inside fenced code blocks', () => {
    const content = '```\nQ: What is inside code? A: This should not be extracted\n```';

    const cards = extractQACardsFromText(content, defaultSettings);

    expect(cards).toHaveLength(0);
  });

  it('should extract cards after fenced code blocks', () => {
    const content = `\`\`\`
const x = 1;
\`\`\`
Q: What comes after code? A: This should be extracted`;

    const cards = extractQACardsFromText(content, defaultSettings);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('What comes after code?');
  });
});
