import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  CardAction,
  createSyncContext,
  describeSyncModalStatus,
} from '../src/sync/types';

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

  describe('describeSyncModalStatus', () => {
    it('keeps a successful connection separate from an analysis failure', () => {
      const status = describeSyncModalStatus({ status: 'ok', version: 6 }, 'findNotes failed', 6);

      expect(status.title).toBe('Connected to Anki');
      expect(status.detail).toBeUndefined();
      expect(status.analysisError).toBe('Analysis failed: findNotes failed');
    });

    it('reports no analysis failure when analysis succeeded', () => {
      const status = describeSyncModalStatus({ status: 'ok', version: 6 }, null, 6);

      expect(status.analysisError).toBeUndefined();
    });

    it('keeps distinct wording for unreachable, too old, and protocol errors', () => {
      const unreachable = describeSyncModalStatus({ status: 'unreachable' }, null, 6);
      expect(unreachable.title).toBe('Not connected to Anki');
      expect(unreachable.detail).toContain('Cannot reach AnkiConnect');

      const tooOld = describeSyncModalStatus({ status: 'version-too-old', version: 5 }, null, 6);
      expect(tooOld.title).toBe('AnkiConnect is out of date');
      expect(tooOld.detail).toContain('requires AnkiConnect 6 or newer');

      const protocol = describeSyncModalStatus({ status: 'protocol-error' }, null, 6);
      expect(protocol.title).toBe('Not connected to Anki');
      expect(protocol.detail).toContain('unexpected response');
    });
  });

  describe('createSyncContext', () => {
    it('takes an immutable point-in-time copy of cards and note data', () => {
      const cards = [{ question: 'Q', answer: 'A', line: 3 }];
      const context = createSyncContext(cards, 'first.md', 'Q: Q\nA: A');

      cards[0].question = 'changed';
      cards.push({ question: 'later', answer: 'later', line: 4 });

      expect(context).toEqual({
        cards: [{ question: 'Q', answer: 'A', line: 3 }],
        notePath: 'first.md',
        noteContent: 'Q: Q\nA: A',
      });
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.cards)).toBe(true);
      expect(Object.isFrozen(context.cards[0])).toBe(true);
    });
  });
});
