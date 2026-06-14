import { describe, it, expect } from 'vitest';
import { extractQACardsFromText } from '../src/sync/extractionUtils';
import { DEFAULT_SETTINGS } from '../src/sync/types';

describe('extractQACardsFromText - image paths', () => {
  it('extracts markdown image with spaces in path', () => {
    const text = `Q: Question
A: Answer
I: ![x](folder/my image.png)`;
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('folder/my image.png');
  });

  it('extracts markdown image with quoted title', () => {
    const text = `Q: Question
A: Answer
I: ![alt](path/to/image.png "Title")`;
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('path/to/image.png');
  });

  it('extracts markdown image with single-quoted title', () => {
    const text = `Q: Question
A: Answer
I: ![alt](path/img.png 'A title')`;
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('path/img.png');
  });

  it('extracts markdown image with angle-bracket URL', () => {
    const text = `Q: Question
A: Answer
I: ![alt](<path/to/image.png>)`;
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('path/to/image.png');
  });

  it('extracts single-line markdown image with spaces in path', () => {
    const text = 'Q: Question A: Answer I: ![x](folder/my image.png)';
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('folder/my image.png');
  });
});

describe('extractQACardsFromText - empty markers fallback', () => {
  it('uses default markers when questionWord is empty', () => {
    const text = 'Q: What? A: Answer';
    const cards = extractQACardsFromText(text, {
      ...DEFAULT_SETTINGS,
      questionWord: '',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('What?');
  });

  it('uses default markers when answerWord is empty', () => {
    const text = 'Q: What? A: Answer';
    const cards = extractQACardsFromText(text, {
      ...DEFAULT_SETTINGS,
      answerWord: '',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].answer).toBe('Answer');
  });

  it('uses default markers when imageWord is empty', () => {
    const text = 'Q: What? A: Answer I: [[img.png]]';
    const cards = extractQACardsFromText(text, {
      ...DEFAULT_SETTINGS,
      imageWord: '',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('img.png');
  });

  it('uses imageWord default when empty in single-line Q/I', () => {
    const text = 'Q: Question I: [[img.png]]';
    const cards = extractQACardsFromText(text, {
      ...DEFAULT_SETTINGS,
      imageWord: '',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('img.png');
  });
});
