import { describe, it, expect } from 'vitest';
import { extractQACardsFromText } from '../src/sync/extractionUtils';
import { PandaZapSettings, DEFAULT_SETTINGS } from '../src/sync/types';

describe('extractQACardsFromText with Optional Rules', () => {
    const settings: PandaZapSettings = { ...DEFAULT_SETTINGS };

    it('should be valid with Q, A, I', () => {
        const text = `Q: Question\nA: Answer\nI: [[img.png]]`;
        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBe('img.png');
        expect(cards[0].answer).toBe('Answer');
    });

    it('should be valid with Q and A (no I)', () => {
        const text = `Q: Question\nA: Answer`;
        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBeUndefined();
        expect(cards[0].answer).toBe('Answer');
    });

    it('should be valid with Q and I (no A)', () => {
        const text = `Q: Question\nI: [[img.png]]`;
        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBe('img.png');
        expect(cards[0].answer).toBe('');
    });

    it('should be valid with Q and I (no A) single-line', () => {
        const text = `Q: Question I: [[img.png]]`;
        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(1);
        expect(cards[0].image).toBe('img.png');
        expect(cards[0].answer).toBe('');
    });

    it('should be invalid with Q only (no A, no I)', () => {
        const text = `Q: Question`;
        const cards = extractQACardsFromText(text, settings);
        expect(cards).toHaveLength(0);
    });

    it('should be invalid if I tag is empty and no A', () => {
        const text = `Q: Question\nI: `;
        const cards = extractQACardsFromText(text, settings);
        // Depending on strictness, if I is empty and no A, it's invalid
        expect(cards).toHaveLength(0);
    });


    // Regression check order
    it('should parse QA even if I exists later but not part of card', () => {
         const text = `Q: Question\nA: Answer\n\nI: [[dangling.png]]`;
         // The previous implementations usually treat blank line as separator
         const cards = extractQACardsFromText(text, settings);
         expect(cards).toHaveLength(1);
         expect(cards[0].image).toBeUndefined();
    });
});
