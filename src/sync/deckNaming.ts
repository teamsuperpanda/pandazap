/** Deck a note targets from its vault path: folders become `::` nesting. */
export function deckNameFromPath(notePath: string): string {
  if (!notePath) return '';

  const pathParts = notePath.split('/');
  const noteNameWithExt = pathParts.pop() || 'Unknown';
  const noteName = noteNameWithExt.replace(/\.md$/, '');
  const folderPath = pathParts.length > 0 ? pathParts.join('/') : '';

  return folderPath ? `${folderPath}::${noteName}` : noteName;
}

export interface DeckTarget {
  useNoteBased: boolean;
  defaultDeck: string;
  notePath?: string;
  deckOverride?: string;
}

/**
 * The deck a note syncs into. A header override wins, then the note's own path
 * in note-based mode, then the shared default deck.
 */
export function resolveDeckName({
  useNoteBased,
  defaultDeck,
  notePath,
  deckOverride,
}: DeckTarget): string {
  if (deckOverride) return deckOverride;
  if (!useNoteBased || !notePath) return defaultDeck;
  return deckNameFromPath(notePath);
}
