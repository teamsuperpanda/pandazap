import { describe, it, expect } from 'vitest';
import { extractQACardsFromText } from '../src/sync/extractionUtils';
import { PandaZapSettings, DEFAULT_SETTINGS } from '../src/sync/types';

describe('extractQACardsFromText with Images', () => {
    const settings: PandaZapSettings = { ...DEFAULT_SETTINGS };

    it('should extract image from I: tag with Obsidian link', () => {
        const text = `Q: Question
A: Answer
I: [[image.jpg]]`;
        
        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBe('image.jpg');
    });

    it('should extract image from I: tag with Obsidian embedded link', () => {
        const text = `Q: Question
A: Answer
I: ![[image.png]]`;
        
        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBe('image.png');
    });

    it('should extract image from I: tag with Markdown image syntax', () => {
        const text = `Q: Question
A: Answer
I: ![Alt text](path/to/image.jpg)`;

        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBe('path/to/image.jpg');
    });

    it('should extract image from I: tag with raw path', () => {
        const text = `Q: Question
A: Answer
I: path/to/image.png`;

        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBe('path/to/image.png');
    });

    it('should handle single-line Q/A/I format', () => {
        const text = `Q: Question A: Answer I: [[image.jpg]]`;
        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].question).toBe('Question');
        expect(cards[0].answer).toBe('Answer');
        expect(cards[0].image).toBe('image.jpg');
    });

    it('should handle custom Image word', () => {
        const customSettings = { ...settings, imageWord: 'Img' };
        const text = `Q: Question
A: Answer
Img: [[custom.jpg]]`;

        const cards = extractQACardsFromText(text, customSettings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBe('custom.jpg');
    });

    it('should ignore I: tag if it does not contain a valid image', () => {
        const text = `Q: Question
A: Answer
I: `; // empty I tag
        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBeUndefined();
    });
});
