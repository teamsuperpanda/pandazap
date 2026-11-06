/**
 * Stateful stand-in for AnkiConnect, shared by the rename and media tests. It
 * answers the actions those flows use and keeps notes, cards and media in
 * memory so a second run sees what the first one changed.
 */

export interface FakeNote {
  noteId: string;
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

export function installFakeAnki(
  requestUrl: RequestUrlMock,
  initial: Partial<Pick<FakeAnkiState, 'notes' | 'cards' | 'media'>> = {}
): FakeAnkiState {
  const state: FakeAnkiState = {
    notes: initial.notes ?? [],
    cards: initial.cards ?? [],
    media: initial.media ?? [],
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

    switch (request.action) {
      case 'version':
        return ok(6);
      case 'findNotes': {
        const query = String(request.params?.query ?? '');
        if (state.failFindNotes?.(query)) throw new Error('findNotes failed');
        // Only tag and quoted text filters matter here; deck filters are
        // ignored, exactly like a superset of the real result.
        const tags = query
          .split(/\s+/)
          .filter((token) => token.startsWith('tag:'))
          .map((token) => token.slice(4));
        const quoted = (query.match(/"[^"]*"/g) ?? []).map((token) => token.slice(1, -1));
        return ok(
          state.notes
            .filter((note) => tags.every((tag) => note.tags.includes(tag)))
            .filter((note) => quoted.every((text) => noteText(note).includes(text)))
            .map((note) => Number(note.noteId))
        );
      }
      case 'notesInfo': {
        const ids = ((request.params?.notes as unknown[]) ?? []).map(String);
        return ok(
          state.notes
            .filter((note) => ids.includes(note.noteId))
            .map((note) => ({
              // Real Anki Connect returns note IDs as numbers.
              noteId: Number(note.noteId),
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
        const note = state.notes.find((entry) => entry.noteId === String(request.params?.note));
        if (note) note.tags = [...((request.params?.tags as string[]) ?? [])];
        return ok(null);
      }
      case 'changeDeck': {
        const ids = ((request.params?.cards as unknown[]) ?? []).map(Number);
        const deck = String(request.params?.deck ?? '');
        for (const card of state.cards) if (ids.includes(card.cardId)) card.deckName = deck;
        return ok(null);
      }
      case 'getMediaFilesNames': {
        const pattern = String(request.params?.pattern ?? '')
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*');
        const matcher = new RegExp(`^${pattern}$`);
        return ok(state.media.filter((name) => matcher.test(name)));
      }
      case 'deleteMediaFile': {
        const filename = String(request.params?.filename ?? '');
        state.media = state.media.filter((name) => name !== filename);
        return ok(null);
      }
      case 'createDeck':
      case 'addNote':
      case 'updateNoteFields':
        return ok(null);
      default:
        throw new Error(`Unexpected action: ${request.action}`);
    }
  });

  return state;
}
