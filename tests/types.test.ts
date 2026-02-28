import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, CardAction } from '../src/sync/types';

describe('Types and Constants', () => {
  describe('DEFAULT_SETTINGS', () => {
    it('has correct default values', () => {
      expect(DEFAULT_SETTINGS.ankiConnectUrl).toBe('http://127.0.0.1');
      expect(DEFAULT_SETTINGS.ankiConnectPort).toBe(8765);
      expect(DEFAULT_SETTINGS.defaultDeck).toBe('Default');
      expect(DEFAULT_SETTINGS.questionWord).toBe('Q');
      expect(DEFAULT_SETTINGS.answerWord).toBe('A');
      expect(DEFAULT_SETTINGS.noteType).toBe('Basic');
      expect(DEFAULT_SETTINGS.useNoteBased).toBe(true);
      expect(DEFAULT_SETTINGS.boldQuestionInReadingMode).toBe(true);
    });

    it('has all required properties', () => {
      expect(DEFAULT_SETTINGS).toHaveProperty('ankiConnectUrl');
      expect(DEFAULT_SETTINGS).toHaveProperty('ankiConnectPort');
      expect(DEFAULT_SETTINGS).toHaveProperty('defaultDeck');
      expect(DEFAULT_SETTINGS).toHaveProperty('deckOverrideWord');
      expect(DEFAULT_SETTINGS).toHaveProperty('questionWord');
      expect(DEFAULT_SETTINGS).toHaveProperty('answerWord');
      expect(DEFAULT_SETTINGS).toHaveProperty('noteType');
      expect(DEFAULT_SETTINGS).toHaveProperty('useNoteBased');
      expect(DEFAULT_SETTINGS).toHaveProperty('boldQuestionInReadingMode');
    });
  });

  describe('CardAction enum', () => {
    it('has correct action values', () => {
      expect(CardAction.ADD).toBe('add');
      expect(CardAction.UPDATE).toBe('update');
      expect(CardAction.DELETE).toBe('delete');
    });
  });
});
