import { describe, expect, it } from 'vitest';
import { deckNameFromPath } from '../src/sync/deckNaming';
import {
  MAX_SOURCE_TAG_LENGTH,
  canUseLegacySourceTag,
  eligibleSourceTags,
  isLegacySourceTagLossless,
  legacySourceTag,
  sourceTag,
  sourceTags,
} from '../src/sync/sourceTags';

const longPath = `${'long-folder/'.repeat(10)}mine.md`;
const longSibling = `${'long-folder/'.repeat(10)}other.md`;

/** Context for a note-based sync into the deck its own path targets. */
function context(overrides: Partial<Parameters<typeof canUseLegacySourceTag>[0]> = {}) {
  return {
    notePath: 'folder/note.md',
    useNoteBased: true,
    deckName: 'folder::note',
    notePathDeck: 'folder::note',
    ...overrides,
  };
}

describe('legacySourceTag', () => {
  it('prefixes the path and makes separators tag-safe', () => {
    expect(legacySourceTag('folder/My Note, 1.md')).toBe('source:folder_My_Note_1.md');
    expect(legacySourceTag('folder\\note.md')).toBe('source:folder_note.md');
    expect(legacySourceTag('folder/a  b,c.md')).toBe('source:folder_a_b_c.md');
  });

  it('truncates the tag to the Anki limit', () => {
    const tag = legacySourceTag(longPath);

    expect(tag).toHaveLength(MAX_SOURCE_TAG_LENGTH);
    expect(tag.startsWith('source:long-folder_long-folder_')).toBe(true);
    expect(legacySourceTag(longSibling)).toBe(tag);
  });
});

describe('sourceTag', () => {
  it('keeps a short path tag readable and ends it with a hash', () => {
    expect(sourceTag('note.md')).toMatch(/^source:note\.md_[0-9a-z]{7}$/);
  });

  it('fits the Anki limit and stays unique when the legacy tag collides', () => {
    const tag = sourceTag(longPath);
    const sibling = sourceTag(longSibling);

    expect(tag).toHaveLength(MAX_SOURCE_TAG_LENGTH);
    expect(tag).toMatch(/_[0-9a-z]{7}$/);
    expect(legacySourceTag(longPath)).toBe(legacySourceTag(longSibling));
    expect(tag).not.toBe(sibling);
  });

  it('hashes a note path the same way for either separator', () => {
    expect(sourceTag('folder\\note.md')).toBe(sourceTag('folder/note.md'));
  });

  it('is stable across calls', () => {
    expect(sourceTag('folder/note.md')).toBe(sourceTag('folder/note.md'));
  });
});

describe('sourceTags', () => {
  it('returns the hashed tag first', () => {
    expect(sourceTags('note.md')).toEqual([sourceTag('note.md'), legacySourceTag('note.md')]);
  });
});

describe('isLegacySourceTagLossless', () => {
  it('is true up to the Anki limit and false past it', () => {
    // 'source:' plus a 73-character path fills the 80-character tag exactly.
    expect(isLegacySourceTagLossless('a'.repeat(73))).toBe(true);
    expect(isLegacySourceTagLossless('a'.repeat(74))).toBe(false);
    expect(isLegacySourceTagLossless(longPath)).toBe(false);
  });
});

describe('canUseLegacySourceTag', () => {
  it('is false when the sync is not note-based', () => {
    expect(canUseLegacySourceTag(context({ useNoteBased: false }))).toBe(false);
  });

  it('trusts a lossless legacy tag', () => {
    expect(canUseLegacySourceTag(context({ deckName: 'Shared' }))).toBe(true);
  });

  it('trusts a truncated tag only when the path alone picks the target deck', () => {
    const notePathDeck = deckNameFromPath(longPath);

    expect(
      canUseLegacySourceTag(context({ notePath: longPath, deckName: notePathDeck, notePathDeck }))
    ).toBe(true);
    expect(
      canUseLegacySourceTag(context({ notePath: longPath, deckName: 'Shared', notePathDeck }))
    ).toBe(false);
    expect(
      canUseLegacySourceTag(
        context({
          notePath: longPath,
          deckName: notePathDeck,
          notePathDeck,
          deckOverride: 'Shared',
        })
      )
    ).toBe(false);
  });

  it('keeps trusting a lossless tag in a shared overridden deck', () => {
    expect(canUseLegacySourceTag(context({ deckName: 'Shared', deckOverride: 'Shared' }))).toBe(
      true
    );
  });
});

describe('eligibleSourceTags', () => {
  it('offers both tags when the legacy tag is authoritative', () => {
    expect(eligibleSourceTags(context())).toEqual([
      sourceTag('folder/note.md'),
      legacySourceTag('folder/note.md'),
    ]);
  });

  it('offers only the hashed tag when the legacy tag is not', () => {
    expect(eligibleSourceTags(context({ useNoteBased: false }))).toEqual([
      sourceTag('folder/note.md'),
    ]);
    expect(eligibleSourceTags(context({ notePath: longPath, deckName: 'Shared' }))).toEqual([
      sourceTag(longPath),
    ]);
  });
});
