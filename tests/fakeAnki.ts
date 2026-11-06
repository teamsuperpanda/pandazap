/**
 * Stateful stand-in for AnkiConnect, shared by the rename and media tests. It
 * answers the actions those flows use and keeps notes, cards and media in
 * memory so a second run sees what the first one changed.
 */

export interface FakeNote {
  noteId: number;
  front: string;
  back: string;
  tags: string[];
  cards: number[];
  /** Field values returned by notesInfo; defaults to Front and Back. */
  fields?: Record<string, { value: string }>;
}

export interface FakeCard {
  cardId: number;
  note: number;
  deckName: string;
}

export interface FakeAnkiState {
  notes: FakeNote[];
  cards: FakeCard[];
  media: string[];
  /** Names returned by deckNames and modelNames, for the settings pickers. */
  decks: string[];
  models: string[];
  /** Actions that throw, simulating Anki being unreachable or a failed call. */
  failActions: Set<string>;
  /** Fails findNotes whose query matches, to poison a single migration. */
  failFindNotes?: (query: string) => boolean;
  requests: Array<{ action: string; params?: Record<string, unknown> }>;
}

interface RequestUrlMock {
  mockImplementation(fn: (options: { body: string }) => Promise<unknown>): unknown;
}

function ok(result: unknown) {
  return { status: 200, json: { result, error: null } };
}

/** Reads a request parameter as AnkiConnect would: a string, never an object. */
function stringParam(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

/** Every field value of a note, for Anki's quoted full-text search. */
function noteText(note: FakeNote): string {
  const fields = note.fields ?? {
    Front: { value: note.front },
    Back: { value: note.back },
  };
  return Object.values(fields)
    .map((field) => field.value)
    .join('\n');
}

/** Decks a note's cards live in, for Anki's `deck:"..."` search. */
function decksOf(state: FakeAnkiState, note: FakeNote): string[] {
  return state.cards
    .filter((card) => note.cards.includes(card.cardId))
    .map((card) => card.deckName);
}

/** Anki's `deck:"X"` matches X and its subdecks. */
function isInDeck(deckName: string, query: string): boolean {
  return deckName === query || deckName.startsWith(`${query}::`);
}

export function installFakeAnki(
  requestUrl: RequestUrlMock,
  initial: Partial<Pick<FakeAnkiState, 'notes' | 'cards' | 'media' | 'decks' | 'models'>> = {}
): FakeAnkiState {
  const state: FakeAnkiState = {
    notes: initial.notes ?? [],
    cards: initial.cards ?? [],
    media: initial.media ?? [],
    decks: initial.decks ?? ['Default'],
    models: initial.models ?? ['Basic'],
    failActions: new Set(),
    requests: [],
  };

  requestUrl.mockImplementation(async (options: { body: string }) => {
    const request = JSON.parse(options.body) as {
      action: string;
      params?: Record<string, unknown>;
    };
    state.requests.push(request);
    if (state.failActions.has(request.action)) throw new Error(`${request.action} failed`);
    const nextNoteId = Math.max(0, ...state.notes.map((note) => note.noteId)) + 1;
    const nextCardId = Math.max(0, ...state.cards.map((card) => card.cardId)) + 1;

    switch (request.action) {
      case 'version':
        return ok(6);
      case 'deckNames':
        return ok(state.decks);
      case 'modelNames':
        return ok(state.models);
      case 'findNotes': {
        const query = stringParam(request.params, 'query');
        if (state.failFindNotes?.(query)) throw new Error('findNotes failed');
        // Tag, deck and quoted text filters are honoured, so an over-broad
        // legacy query fails the tests instead of passing unnoticed.
        const tags = query
          .split(/\s+/)
          .filter((token) => token.startsWith('tag:'))
          .map((token) => token.slice(4));
        // The deck argument is quoted too, so remove it before reading the
        // quoted full-text terms.
        const deckMatch = query.match(/deck:"([^"]*)"/);
        const deck = deckMatch?.[1];
        const textQuery = deckMatch ? query.replace(deckMatch[0], '') : query;
        const matches: string[] = textQuery.match(/"[^"]*"/g) ?? [];
        const quoted = matches.map((token) => token.slice(1, -1));
        return ok(
          state.notes
            .filter((note) => tags.every((tag) => note.tags.includes(tag)))
            .filter((note) => quoted.every((text) => noteText(note).includes(text)))
            .filter((note) => !deck || decksOf(state, note).some((name) => isInDeck(name, deck)))
            .map((note) => note.noteId)
        );
      }
      case 'notesInfo': {
        const ids = ((request.params?.notes as unknown[]) ?? []).map(Number);
        return ok(
          state.notes
            .filter((note) => ids.includes(note.noteId))
            .map((note) => ({
              // Real Anki Connect returns note IDs as numbers.
              noteId: note.noteId,
              fields: note.fields ?? {
                Front: { value: note.front },
                Back: { value: note.back },
              },
              tags: [...note.tags],
              cards: [...note.cards],
            }))
        );
      }
      case 'cardsInfo': {
        const ids = ((request.params?.cards as unknown[]) ?? []).map(Number);
        return ok(state.cards.filter((card) => ids.includes(card.cardId)));
      }
      case 'updateNoteTags': {
        const note = state.notes.find(
          (entry) => entry.noteId === Number(stringParam(request.params, 'note'))
        );
        if (note) note.tags = [...((request.params?.tags as string[]) ?? [])];
        return ok(null);
      }
      case 'changeDeck': {
        const ids = ((request.params?.cards as unknown[]) ?? []).map(Number);
        const deck = stringParam(request.params, 'deck');
        for (const card of state.cards) if (ids.includes(card.cardId)) card.deckName = deck;
        return ok(null);
      }
      case 'getMediaFilesNames': {
        const pattern = stringParam(request.params, 'pattern')
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*');
        const matcher = new RegExp(`^${pattern}$`);
        return ok(state.media.filter((name) => matcher.test(name)));
      }
      case 'deleteMediaFile': {
        const filename = stringParam(request.params, 'filename');
        state.media = state.media.filter((name) => name !== filename);
        return ok(null);
      }
      case 'createDeck':
        return ok(null);
      case 'addNote': {
        const note = request.params?.note as
          | {
              deckName?: string;
              fields?: Record<string, string>;
              tags?: string[];
            }
          | undefined;
        const fields = note?.fields ?? {};
        const created: FakeNote = {
          noteId: nextNoteId,
          front: fields.Front ?? '',
          back: fields.Back ?? '',
          tags: [...(note?.tags ?? [])],
          cards: [nextCardId],
        };
        state.notes.push(created);
        state.cards.push({
          cardId: nextCardId,
          note: nextNoteId,
          deckName: note?.deckName ?? 'Default',
        });
        return ok(nextNoteId);
      }
      case 'updateNoteFields': {
        const params = request.params?.note as
          { id?: number; fields?: Record<string, string> } | undefined;
        const note = state.notes.find((entry) => entry.noteId === params?.id);
        if (note && params?.fields) {
          for (const [name, value] of Object.entries(params.fields)) {
            // Keep both views of the note in step: fields for notesInfo and
            // front/back for the quoted full-text search.
            if (name === 'Front') note.front = value;
            if (name === 'Back') note.back = value;
            if (note.fields) note.fields[name] = { value };
          }
        }
        return ok(null);
      }
      default:
        throw new Error(`Unexpected action: ${request.action}`);
    }
  });

  return state;
}
