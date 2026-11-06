import { describe, expect, it } from 'vitest';
import {
  parseCardsInfo,
  parseMediaName,
  parseNoteId,
  parseNoteIds,
  parseNotesInfo,
  parseNullResult,
  parseStringArray,
  parseVersion,
} from '../src/sync/ankiResponses';

describe('AnkiConnect response parsers', () => {
  it('accepts the numeric shapes AnkiConnect returns', () => {
    expect(parseVersion(6)).toBe(6);
    expect(parseNoteId(42, 'note ID from addNote')).toBe(42);
    expect(parseNoteIds([11, 22])).toEqual([11, 22]);
    expect(parseStringArray(['Default', 'Deck::Sub'], 'deck names')).toEqual([
      'Default',
      'Deck::Sub',
    ]);
    expect(parseMediaName('pandazap_one.png')).toBe('pandazap_one.png');
    expect(parseNullResult(null, 'delete result')).toBe(null);
    expect(parseNotesInfo([{ noteId: 7, fields: { Front: { value: 'Q' } } }])).toEqual([
      { noteId: 7, fields: { Front: { value: 'Q' } } },
    ]);
    expect(
      parseNotesInfo([
        {
          noteId: 7,
          fields: { Front: { value: 'Q' } },
          tags: ['panda-zap'],
          cards: [3],
        },
      ])
    ).toEqual([{ noteId: 7, fields: { Front: { value: 'Q' } }, tags: ['panda-zap'], cards: [3] }]);
    expect(parseCardsInfo([{ cardId: 3, note: 7, deckName: 'Default' }])).toEqual([
      { cardId: 3, note: 7, deckName: 'Default' },
    ]);
  });

  it('rejects a note ID list that is not made of numbers', () => {
    expect(() => parseNoteIds('11')).toThrow('Anki returned invalid note IDs');
    expect(() => parseNoteIds(['11'])).toThrow('Anki returned invalid note IDs');
    expect(() => parseNoteIds([11, 1.5])).toThrow('Anki returned invalid note IDs');
  });

  it('rejects a single note ID that is not a number', () => {
    expect(() => parseNoteId('42', 'note ID from addNote')).toThrow(
      'Anki returned invalid note ID from addNote'
    );
    expect(() => parseNoteId(null, 'note ID from addNote')).toThrow(
      'Anki returned invalid note ID from addNote'
    );
  });

  it('rejects a string list containing a non-string', () => {
    expect(() => parseStringArray(['Deck', 7], 'deck names')).toThrow(
      'Anki returned invalid deck names'
    );
    expect(() => parseStringArray({ names: [] }, 'model names')).toThrow(
      'Anki returned invalid model names'
    );
  });

  it('rejects note information with a malformed note', () => {
    expect(() => parseNotesInfo(null)).toThrow('Anki returned invalid note information');
    expect(() => parseNotesInfo([{ noteId: '7', fields: {} }])).toThrow(
      'Anki returned invalid note information'
    );
    expect(() => parseNotesInfo([{ noteId: 7 }])).toThrow('Anki returned invalid note information');
    expect(() => parseNotesInfo([{ noteId: 7, fields: { Front: 'Q' } }])).toThrow(
      'Anki returned invalid note information'
    );
    expect(() => parseNotesInfo([{ noteId: 7, fields: {}, tags: [1] }])).toThrow(
      'Anki returned invalid note information'
    );
    expect(() => parseNotesInfo([{ noteId: 7, fields: {}, cards: ['3'] }])).toThrow(
      'Anki returned invalid note information'
    );
  });

  it('rejects card information with a malformed card', () => {
    expect(() => parseCardsInfo([{ cardId: '3' }])).toThrow(
      'Anki returned invalid card information'
    );
    expect(() => parseCardsInfo([{ cardId: 3, note: '7' }])).toThrow(
      'Anki returned invalid card information'
    );
    expect(() => parseCardsInfo([{ cardId: 3, deckName: 1 }])).toThrow(
      'Anki returned invalid card information'
    );
  });

  it('rejects a media name that is not a non-empty string', () => {
    expect(() => parseMediaName(false)).toThrow('Anki returned invalid media filename');
    expect(() => parseMediaName('')).toThrow('Anki returned invalid media filename');
  });

  it('rejects a non-null result where Anki returns null', () => {
    expect(() => parseNullResult(true, 'delete result')).toThrow(
      'Anki returned invalid delete result'
    );
    expect(() => parseNullResult(0, 'tag update result')).toThrow(
      'Anki returned invalid tag update result'
    );
  });

  it('rejects a version that is not a number', () => {
    expect(() => parseVersion('6')).toThrow('Anki returned invalid version number');
    expect(() => parseVersion(undefined)).toThrow('Anki returned invalid version number');
  });
});
