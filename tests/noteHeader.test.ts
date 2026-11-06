import { describe, expect, it } from 'vitest';
import { parseNoteHeader } from '../src/sync/noteHeader';
import { DEFAULT_SETTINGS } from '../src/sync/types';

const WORD = DEFAULT_SETTINGS.deckOverrideWord;

describe('parseNoteHeader', () => {
  it('reads a plain frontmatter deck key', () => {
    const content = ['---', 'deck: Spanish::Vocab', '---', 'Q: Hello', 'A: Hola'].join('\n');

    expect(parseNoteHeader(content, WORD)).toEqual({ deckOverride: 'Spanish::Vocab' });
  });

  it('reads a quoted frontmatter deck key and converts slashes to nesting', () => {
    expect(parseNoteHeader('---\ndeck: "Biology/Plants"\n---\nQ: Q\nA: A', WORD)).toEqual({
      deckOverride: 'Biology::Plants',
    });
  });

  it('prefers the frontmatter deck over a Deck:: line', () => {
    const content = ['---', 'deck: FromFrontmatter', '---', 'Deck:: FromLine', 'Q: Q', 'A: A'].join(
      '\n'
    );

    expect(parseNoteHeader(content, WORD)).toEqual({ deckOverride: 'FromFrontmatter' });
  });

  it('reads a Deck:: line when there is no frontmatter', () => {
    expect(parseNoteHeader('Deck:: FromLine\nQ: Q\nA: A', WORD)).toEqual({
      deckOverride: 'FromLine',
    });
    expect(parseNoteHeader('deck:: FromLine\nQ: Q\nA: A', WORD)).toEqual({
      deckOverride: 'FromLine',
    });
  });

  it('uses the configured override word', () => {
    expect(parseNoteHeader('Topic:: Mine\nQ: Q\nA: A', 'Topic')).toEqual({ deckOverride: 'Mine' });
    expect(parseNoteHeader('Deck:: Ignored\nQ: Q\nA: A', 'Topic')).toEqual({});
  });

  it('reads the Deck:: line from the first body line after frontmatter', () => {
    const content = ['---', 'tags: [cards]', '---', 'Deck:: FromLine', 'Q: Q', 'A: A'].join('\n');

    expect(parseNoteHeader(content, WORD)).toEqual({ deckOverride: 'FromLine' });
  });

  it('ignores a deck key in the body', () => {
    expect(parseNoteHeader('Q: Q\ndeck: BodyOnly\nA: A', WORD)).toEqual({});
  });

  it('ignores a malformed, unclosed frontmatter block', () => {
    expect(parseNoteHeader('---\ndeck: NeverClosed\nQ: Q\nA: A', WORD)).toEqual({});
  });

  it('falls back to the Deck:: line when the frontmatter value is empty', () => {
    const content = ['---', 'deck:', '---', 'Deck:: Fallback', 'Q: Q', 'A: A'].join('\n');

    expect(parseNoteHeader(content, WORD)).toEqual({ deckOverride: 'Fallback' });
    expect(parseNoteHeader(['---', 'deck: ""', '---', 'Q: Q', 'A: A'].join('\n'), WORD)).toEqual(
      {}
    );
  });

  it('returns no header without content or an override word', () => {
    expect(parseNoteHeader('', WORD)).toEqual({});
    expect(parseNoteHeader('Deck:: Mine\nQ: Q\nA: A', '   ')).toEqual({});
  });

  it('handles CRLF line endings', () => {
    expect(parseNoteHeader('---\r\ndeck: Spanish\r\n---\r\nQ: Q\r\nA: A', WORD)).toEqual({
      deckOverride: 'Spanish',
    });
  });
});
