import { escapeRegex } from './markers';

const FRONTMATTER_DECK_KEY = /^deck\s*:\s*(.*)$/;

export interface NoteHeader {
  /** Deck the note's header targets, already normalised to `::` nesting. */
  deckOverride?: string;
}

/** Anki nests decks with `::`, while note overrides accept either separator. */
function normalizeDeckTarget(value: string | undefined): string | undefined {
  const target = (value ?? '').trim().replace(/\//g, '::');
  return target || undefined;
}

/** Drops one matching pair of YAML single or double quotes around a value. */
function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Reads the deck a note targets from its header. A leading YAML frontmatter
 * block wins with a top-level `deck:` key; otherwise the first line after the
 * block may carry `<overrideWord>:: Name`. A `deck:` key anywhere in the body
 * is plain text and never an override.
 */
export function parseNoteHeader(content: string, overrideWord: string): NoteHeader {
  if (!content) return {};
  const lines = content.split(/\r?\n/);

  let bodyStart = 0;
  if (lines[0]?.trim() === '---') {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    // An unclosed block is malformed, not frontmatter, so it carries no key.
    if (closing !== -1) {
      let deck: string | undefined;
      for (const line of lines.slice(1, closing)) {
        const match = line.match(FRONTMATTER_DECK_KEY);
        const value = match ? stripYamlQuotes(match[1]) : '';
        if (value) deck = value;
      }
      if (deck) return { deckOverride: normalizeDeckTarget(deck) };
      bodyStart = closing + 1;
    }
  }

  const word = overrideWord.trim();
  if (!word) return {};
  const firstLine = lines[bodyStart] ?? '';
  const match = firstLine.match(new RegExp(`^${escapeRegex(word)}::\\s*(.+)$`, 'i'));
  return { deckOverride: normalizeDeckTarget(match?.[1]) };
}
