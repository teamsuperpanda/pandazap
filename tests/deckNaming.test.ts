import { describe, expect, it } from 'vitest';
import { deckNameFromPath, resolveDeckName } from '../src/sync/deckNaming';

describe('deckNameFromPath', () => {
  it('uses the note name when the note sits at the vault root', () => {
    expect(deckNameFromPath('note.md')).toBe('note');
  });

  it('nests folders with the Anki separator', () => {
    expect(deckNameFromPath('folder/note.md')).toBe('folder::note');
    expect(deckNameFromPath('Language/Spanish/Verbs.md')).toBe('Language/Spanish::Verbs');
  });

  it('strips only the markdown extension', () => {
    expect(deckNameFromPath('folder/note.txt.md')).toBe('folder::note.txt');
    expect(deckNameFromPath('folder/note')).toBe('folder::note');
  });

  it('returns nothing for an empty path', () => {
    expect(deckNameFromPath('')).toBe('');
  });
});

describe('resolveDeckName', () => {
  const base = { useNoteBased: true, defaultDeck: 'Default', notePath: 'folder/note.md' };

  it('prefers a header override', () => {
    expect(resolveDeckName({ ...base, deckOverride: 'Override' })).toBe('Override');
  });

  it('falls back to the note path in note-based mode', () => {
    expect(resolveDeckName(base)).toBe('folder::note');
  });

  it('uses the default deck when note-based mode is off', () => {
    expect(resolveDeckName({ ...base, useNoteBased: false })).toBe('Default');
    expect(resolveDeckName({ ...base, useNoteBased: false, deckOverride: 'Override' })).toBe(
      'Override'
    );
  });

  it('uses the default deck without a note path', () => {
    expect(resolveDeckName({ useNoteBased: true, defaultDeck: 'Default' })).toBe('Default');
  });

  it('ignores an empty override', () => {
    expect(resolveDeckName({ ...base, deckOverride: '' })).toBe('folder::note');
  });
});
