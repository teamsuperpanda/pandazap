import { describe, expect, it } from 'vitest';
import { extractDeckOverride } from '../src/sync/extractionUtils';
import { DEFAULT_SETTINGS } from '../src/sync/types';

const WORD = DEFAULT_SETTINGS.deckOverrideWord;

describe('extractDeckOverride', () => {
  it('reads a plain frontmatter deck key', () => {
    const content = ['---', 'deck: Spanish::Vocab', '---', 'Q: Hello', 'A: Hola'].join('\n');

    expect(extractDeckOverride(content, WORD)).toBe('Spanish::Vocab');
  });

  it('reads a quoted frontmatter deck key and converts slashes to nesting', () => {
    expect(extractDeckOverride('---\ndeck: "Biology/Plants"\n---\nQ: Q\nA: A', WORD)).toBe(
      'Biology::Plants'
    );
    expect(extractDeckOverride("---\ndeck: 'Biology/Plants'\n---\nQ: Q\nA: A", WORD)).toBe(
      'Biology::Plants'
    );
  });

  it('prefers the frontmatter deck over a Deck:: line', () => {
    const content = ['---', 'deck: FromFrontmatter', '---', 'Deck:: FromLine', 'Q: Q', 'A: A'].join(
      '\n'
    );

    expect(extractDeckOverride(content, WORD)).toBe('FromFrontmatter');
  });

  it('keeps the Deck:: line behaviour for notes without frontmatter', () => {
    expect(extractDeckOverride('Deck:: FromLine\nQ: Q\nA: A', WORD)).toBe('FromLine');
    expect(extractDeckOverride('deck:: FromLine\nQ: Q\nA: A', WORD)).toBe('FromLine');
  });

  it('uses the configured override word', () => {
    expect(extractDeckOverride('Topic:: Mine\nQ: Q\nA: A', 'Topic')).toBe('Mine');
    expect(extractDeckOverride('Deck:: Ignored\nQ: Q\nA: A', 'Topic')).toBeUndefined();
  });

  it('uses the first body line after frontmatter for a Deck:: override', () => {
    const content = ['---', 'tags: [cards]', '---', 'Deck:: FromLine', 'Q: Q', 'A: A'].join('\n');

    expect(extractDeckOverride(content, WORD)).toBe('FromLine');
  });

  it('ignores a deck key in the body', () => {
    const content = ['Q: Q', 'deck: BodyOnly', 'A: A'].join('\n');

    expect(extractDeckOverride(content, WORD)).toBeUndefined();
  });

  it('ignores a malformed, unclosed frontmatter block', () => {
    expect(extractDeckOverride('---\ndeck: NeverClosed\nQ: Q\nA: A', WORD)).toBeUndefined();
  });

  it('falls back to the Deck:: line when the frontmatter value is empty', () => {
    const content = ['---', 'deck:', '---', 'Deck:: Fallback', 'Q: Q', 'A: A'].join('\n');
    const noLine = ['---', 'deck: ""', '---', 'Q: Q', 'A: A'].join('\n');

    expect(extractDeckOverride(content, WORD)).toBe('Fallback');
    expect(extractDeckOverride(noLine, WORD)).toBeUndefined();
  });

  it('returns nothing without a content or an override word', () => {
    expect(extractDeckOverride('', WORD)).toBeUndefined();
    expect(extractDeckOverride('Deck:: Mine\nQ: Q\nA: A', '   ')).toBeUndefined();
  });

  it('handles CRLF line endings', () => {
    expect(extractDeckOverride('---\r\ndeck: Spanish\r\n---\r\nQ: Q\r\nA: A', WORD)).toBe(
      'Spanish'
    );
  });
});
