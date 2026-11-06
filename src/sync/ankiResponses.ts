import { AnkiCardInfo, AnkiNoteInfo } from './types';

/**
 * Parsers for the `result` of each AnkiConnect action the client calls. Anki
 * is an external service, so a result is validated before it is used: a wrong
 * shape throws a clear error instead of being cast into the domain types.
 */

function invalid(what: string): Error {
  return new Error(`Anki returned invalid ${what}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Version number returned by the `version` action. */
export function parseVersion(value: unknown): number {
  if (!isInteger(value)) throw invalid('version number');
  return value;
}

/** A single note ID, as returned by `addNote`. */
export function parseNoteId(value: unknown, what = 'note ID'): number {
  if (!isInteger(value)) throw invalid(what);
  return value;
}

/** Numeric note ID array, as returned by `findNotes`. */
export function parseNoteIds(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every(isInteger)) throw invalid('note IDs');
  return [...value];
}

/** String array, as returned by `deckNames`, `modelNames` and media listings. */
export function parseStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw invalid(what);
  }
  return [...value];
}

/** Deck ID, as returned by `createDeck`. */
export function parseDeckId(value: unknown): number {
  if (!isInteger(value)) throw invalid('deck ID');
  return value;
}

/** Media filename, as returned by `storeMediaFile`. */
export function parseMediaName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid('media filename');
  return value;
}

/**
 * Anki answers `{}` for an ID that no longer exists between a lookup and its
 * info read, so an empty entry means the note or card is gone, not malformed.
 */
function isPresent(entry: unknown): boolean {
  return !isRecord(entry) || Object.keys(entry).length > 0;
}

/** Notes returned by `notesInfo`. */
export function parseNotesInfo(value: unknown): AnkiNoteInfo[] {
  if (!Array.isArray(value)) throw invalid('note information');
  return value.filter(isPresent).map((entry) => {
    if (!isRecord(entry) || !isInteger(entry.noteId) || !isFields(entry.fields)) {
      throw invalid('note information');
    }
    const note: AnkiNoteInfo = { noteId: entry.noteId, fields: entry.fields };
    if (entry.tags !== undefined) {
      if (!isStringArray(entry.tags)) throw invalid('note information');
      note.tags = entry.tags;
    }
    if (entry.cards !== undefined) {
      if (!isNumberArray(entry.cards)) throw invalid('note information');
      note.cards = entry.cards;
    }
    return note;
  });
}

/** Cards returned by `cardsInfo`. */
export function parseCardsInfo(value: unknown): AnkiCardInfo[] {
  if (!Array.isArray(value)) throw invalid('card information');
  return value.filter(isPresent).map((entry) => {
    if (!isRecord(entry) || !isInteger(entry.cardId)) throw invalid('card information');
    const card: AnkiCardInfo = { cardId: entry.cardId };
    if (entry.note !== undefined) {
      if (!isInteger(entry.note)) throw invalid('card information');
      card.note = entry.note;
    }
    if (entry.deckName !== undefined) {
      if (typeof entry.deckName !== 'string') throw invalid('card information');
      card.deckName = entry.deckName;
    }
    return card;
  });
}

/** Actions that succeed with a null result, such as `deleteNotes`. */
export function parseNullResult(value: unknown, what: string): null {
  if (value !== null) throw invalid(what);
  return null;
}

function isFields(value: unknown): value is AnkiNoteInfo['fields'] {
  if (!isRecord(value)) return false;
  return Object.values(value).every((field) => isRecord(field) && typeof field.value === 'string');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isInteger);
}
