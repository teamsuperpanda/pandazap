import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({
  App: class {},
  TFile: class {},
  requestUrl,
}));

import { AnkiConnector } from '../src/sync/AnkiConnector';
import { legacySourceTag, sourceTag } from '../src/sync/sourceTags';
import { getStoredMediaFilename } from '../src/sync/imageUtils';
import {
  DEFAULT_SETTINGS,
  describeConnection,
  formatSyncResult,
  type AnkiNoteInfo,
} from '../src/sync/types';
import { REQUEST_TIMEOUT_MS, RETRY_BACKOFF_BASE_MS, SYNC_HASH_TAG_PREFIX } from '../src/constants';
import { installFakeAnki } from './fakeAnki';

const settings = { ...DEFAULT_SETTINGS, useNoteBased: true };
const deckSettings = { ...DEFAULT_SETTINGS, useNoteBased: false };
const app = {} as ConstructorParameters<typeof AnkiConnector>[1];

function response(result: unknown, error: string | null = null, status = 200) {
  return { status, json: { result, error } };
}

function actionOf(call: unknown[]): string {
  return parseRequest((call[0] as { body: string }).body).action;
}

function parseRequest(body: string): { action: string; params?: Record<string, unknown> } {
  return JSON.parse(body) as { action: string; params?: Record<string, unknown> };
}

function requests(action: string) {
  return requestUrl.mock.calls
    .map((call) => parseRequest((call[0] as { body: string }).body))
    .filter((request) => request.action === action);
}

/** The findNotes query of a request, as the connector sent it. */
function queryOf(request: { params?: Record<string, unknown> }): string {
  const query = request.params?.query;
  return typeof query === 'string' ? query : '';
}

function deckLookups(deckName: string) {
  return requests('findNotes').filter(
    (request) => request.params?.query === `deck:"${deckName}" tag:panda-zap`
  );
}

function never() {
  return new Promise<never>(() => {});
}

function note(noteId: number, front: string, back: string, tags: string[]): AnkiNoteInfo {
  return {
    noteId,
    fields: { Front: { value: front }, Back: { value: back } },
    tags,
  };
}

describe('AnkiConnector', () => {
  beforeEach(() => {
    requestUrl.mockReset();
    vi.unstubAllGlobals();
  });

  it('requires a valid successful version response', async () => {
    requestUrl.mockResolvedValueOnce(response(6, null, 500));
    expect(await new AnkiConnector(settings, app).testConnection()).toEqual({
      status: 'protocol-error',
    });

    requestUrl.mockResolvedValueOnce({ status: 200, json: { value: 6 } });
    expect(await new AnkiConnector(settings, app).testConnection()).toEqual({
      status: 'protocol-error',
    });

    requestUrl.mockResolvedValueOnce(response('6'));
    expect(await new AnkiConnector(settings, app).testConnection()).toEqual({
      status: 'protocol-error',
    });

    requestUrl.mockResolvedValueOnce(response(6));
    expect(await new AnkiConnector(settings, app).testConnection()).toEqual({
      status: 'ok',
      version: 6,
    });
  });

  it('reports an unreachable connection when the request fails at the network level', async () => {
    vi.useFakeTimers();
    try {
      requestUrl.mockRejectedValue(new TypeError('Failed to fetch'));
      const status = new AnkiConnector(settings, app).testConnection();

      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_BASE_MS * 8);

      expect(await status).toEqual({ status: 'unreachable' });
      expect(requestUrl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an unreachable connection when the version probe times out', async () => {
    vi.useFakeTimers();
    try {
      requestUrl.mockImplementation(() => never());
      const connector = new AnkiConnector(settings, app);
      const status = connector.testConnection();

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 3 + RETRY_BACKOFF_BASE_MS * 4);

      const connection = await status;
      expect(connection).toEqual({
        status: 'unreachable',
        detail: 'Timed out after 5000 ms.',
      });
      expect(describeConnection(connection, 6)).toContain('Timed out after 5000 ms.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an AnkiConnect version that is too old', async () => {
    requestUrl.mockResolvedValueOnce(response(5));
    expect(await new AnkiConnector(settings, app).testConnection()).toEqual({
      status: 'version-too-old',
      version: 5,
    });
  });

  it('propagates lookup failures instead of classifying the card as missing', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'findNotes') throw new Error('lookup failed');
      throw new Error(`Unexpected action: ${action}`);
    });

    const connector = new AnkiConnector(settings, app);
    await expect(
      connector.analyzeSyncOperation([{ question: 'Q', answer: 'A' }], 'one.md')
    ).rejects.toThrow('lookup failed');
  });

  it('rejects a findNotes result that is not numeric note IDs', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'findNotes') return response(['11']);
      throw new Error(`Unexpected action: ${action}`);
    });

    await expect(
      new AnkiConnector(settings, app).analyzeSyncOperation(
        [{ question: 'Q', answer: 'A' }],
        'one.md'
      )
    ).rejects.toThrow('Anki returned invalid note IDs');
  });

  it('rejects notesInfo entries shaped with a string note ID', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'findNotes') return response([11]);
      if (action === 'notesInfo') {
        return response([{ noteId: '11', fields: { Front: { value: 'Q' } } }]);
      }
      throw new Error(`Unexpected action: ${action}`);
    });

    await expect(
      new AnkiConnector(settings, app).analyzeSyncOperation(
        [{ question: 'Q', answer: 'A' }],
        'one.md'
      )
    ).rejects.toThrow('Anki returned invalid note information');
  });

  it('rejects an addNote result that is not a note ID', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(1);
      if (action === 'findNotes') return response([]);
      if (action === 'addNote') return response(null);
      throw new Error(`Unexpected action: ${action}`);
    });

    const result = await new AnkiConnector(settings, app).syncCards(
      [{ question: 'Q', answer: 'A' }],
      'mine.md',
      'Q: Q\nA: A'
    );

    expect(result.cards).toEqual([
      {
        card: { question: 'Q', answer: 'A' },
        status: 'failed',
        reason: 'Anki returned invalid note ID from addNote',
      },
    ]);
  });

  it('reports a failed deletion when deleteNotes does not return null', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(1);
      if (action === 'deleteNotes') return response(true);
      throw new Error(`Unexpected action: ${action}`);
    });

    const result = await new AnkiConnector(settings, app).syncCards(
      [],
      'mine.md',
      'Q: Q\nA: A',
      true,
      [11]
    );

    expect(result.deletion).toEqual({
      deletedCount: 0,
      failed: true,
      reason: 'Anki returned invalid delete result',
    });
  });

  it('counts analysed input cards, including cards that need no change', async () => {
    const connector = new AnkiConnector(settings, app);
    const mineSourceTag = sourceTag('mine.md');

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') {
        return response(queryOf(request).includes(`tag:${mineSourceTag}`) ? [] : [11, 22]);
      }
      if (request.action === 'notesInfo') {
        return response([
          note(11, 'Same', 'A', [mineSourceTag]),
          note(22, 'Edited', 'old', [mineSourceTag, 'pandazap-sync:stale']),
        ]);
      }
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const analysis = await connector.analyzeSyncOperation(
      [
        { question: 'New', answer: 'A' },
        { question: 'Same', answer: 'A' },
        { question: 'Edited', answer: 'A' },
      ],
      'mine.md'
    );

    // The up-to-date card appears in no list, but it is still one of the cards
    // the analysis read and the progress denominator.
    expect(analysis.cardsToAdd).toHaveLength(1);
    expect(analysis.cardsToUpdate).toEqual([]);
    expect(analysis.cardsInConflict).toHaveLength(1);
    expect(analysis.totalCards).toBe(3);
    expect(
      analysis.cardsToAdd.length +
        analysis.cardsToUpdate.length +
        analysis.cardsToDelete.length +
        analysis.cardsInConflict.length
    ).toBeLessThan(analysis.totalCards);
  });

  it('does not update a matching front owned by another source', async () => {
    const connector = new AnkiConnector(settings, app);
    const otherTag = sourceTag('other.md');

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as { action: string };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(1);
      if (body.action === 'findNotes') return response([11]);
      if (body.action === 'notesInfo') return response([note(11, 'Q', 'old', [otherTag])]);
      if (body.action === 'addNote') return response(22);
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const result = await connector.syncCards([{ question: 'Q', answer: 'new' }], 'mine.md');

    expect(result.cards).toEqual([
      { card: { question: 'Q', answer: 'new' }, status: 'added', deckName: 'mine' },
    ]);
    expect(formatSyncResult(result)).toEqual(['Added: Q -> mine']);
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('updateNoteFields');
  });

  it('uses one selected cache entry for its ID, fields, and tags', async () => {
    const connector = new AnkiConnector(settings, app);
    const mineSourceTag = sourceTag('mine.md');
    const otherTag = sourceTag('other.md');

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as {
        action: string;
        params?: { note?: { id?: string }; notes?: number[] };
      };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(1);
      if (body.action === 'findNotes') return response([11, 22]);
      if (body.action === 'notesInfo') {
        const asked = body.params?.notes ?? [];
        const all = [note(11, 'Q', 'new', [otherTag]), note(22, 'Q', 'old', [mineSourceTag])];
        return response(all.filter((entry) => asked.includes(entry.noteId)));
      }
      if (body.action === 'updateNoteFields') {
        expect(body.params?.note?.id).toBe(22);
        return response(null);
      }
      if (body.action === 'updateNoteTags') return response(null);
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const result = await connector.syncCards([{ question: 'Q', answer: 'new' }], 'mine.md');
    expect(result.cards).toEqual([
      { card: { question: 'Q', answer: 'new' }, status: 'updated', deckName: 'mine' },
    ]);
    expect(formatSyncResult(result)).toEqual(['Updated: Q -> mine']);
  });

  it('recognizes and migrates a legacy truncated source tag', async () => {
    const connector = new AnkiConnector(settings, app);
    const path = `${'long-folder/'.repeat(10)}mine.md`;
    const legacyTag = legacySourceTag(path);
    const hashedTag = sourceTag(path);
    expect(hashedTag).toHaveLength(80);
    expect(hashedTag).not.toBe(legacyTag);

    const siblingPath = `${'long-folder/'.repeat(10)}other.md`;
    expect(legacySourceTag(siblingPath)).toBe(legacyTag);
    expect(sourceTag(siblingPath)).not.toBe(hashedTag);

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as {
        action: string;
        params?: { note?: number; tags?: string[] };
      };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(1);
      if (body.action === 'findNotes') return response([42]);
      if (body.action === 'notesInfo') return response([note(42, 'Q', 'new', [legacyTag])]);
      if (body.action === 'updateNoteTags') {
        expect(body.params).toMatchObject({ note: 42 });
        expect(body.params?.tags).toContain(hashedTag);
        return response(null);
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const result = await connector.syncCards([{ question: 'Q', answer: 'new' }], path);
    expect(result.cards[0]).toMatchObject({ status: 'skipped-identical' });
    expect(formatSyncResult(result)[0]).toMatch(/^Skipped \(already up-to-date\): Q/);
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('updateNoteFields');
  });

  it('does not claim a colliding legacy source tag in a shared overridden deck', async () => {
    const connector = new AnkiConnector(settings, app);
    const path = `${'long-folder/'.repeat(10)}mine.md`;
    const siblingPath = `${'long-folder/'.repeat(10)}other.md`;
    const overriddenDeck = path.replace(/\.md$/, '').replace(/\//g, '::');
    const legacyTag = legacySourceTag(path);
    expect(legacySourceTag(siblingPath)).toBe(legacyTag);

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as {
        action: string;
        params?: { query?: string };
      };
      if (body.action === 'version') return response(6);
      if (body.action === 'findNotes') {
        expect(body.params?.query).not.toContain(`tag:${legacyTag}`);
        // The broad deck cache can see the sibling note, but source-specific
        // deletion lookup must not claim it.
        return response(
          body.params?.query === `deck:"${overriddenDeck}" tag:panda-zap` ? [42] : []
        );
      }
      if (body.action === 'notesInfo') {
        return response([note(42, 'Sibling question', 'answer', [legacyTag])]);
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const analysis = await connector.analyzeSyncOperation(
      [{ question: 'Mine', answer: 'answer' }],
      path,
      `Deck:: ${overriddenDeck}\nQ: Mine\nA: answer`
    );

    expect(analysis.cardsToAdd).toHaveLength(1);
    expect(analysis.cardsToUpdate).toEqual([]);
    expect(analysis.cardsToDelete).toEqual([]);
  });

  it('recognizes and migrates a lossless legacy tag in a shared overridden deck', async () => {
    const connector = new AnkiConnector(settings, app);
    const path = 'folder/mine.md';
    const legacyTag = legacySourceTag(path);
    const hashedTag = sourceTag(path);

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as {
        action: string;
        params?: { note?: number; tags?: string[]; query?: string };
      };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(1);
      if (body.action === 'findNotes') {
        return response(body.params?.query?.includes(`tag:${hashedTag}`) ? [] : [42]);
      }
      if (body.action === 'notesInfo') return response([note(42, 'Q', 'A', [legacyTag])]);
      if (body.action === 'updateNoteTags') {
        expect(body.params).toMatchObject({ note: 42 });
        expect(body.params?.tags).toContain(hashedTag);
        return response(null);
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const analysis = await connector.analyzeSyncOperation(
      [{ question: 'Other', answer: 'answer' }],
      path,
      'Deck:: Shared\nQ: Other\nA: answer'
    );
    expect(analysis.cardsToDelete.map((card) => card.existingCardId)).toEqual([42]);

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'A' }],
      path,
      'Deck:: Shared\nQ: Q\nA: A'
    );

    expect(result.cards).toEqual([
      {
        card: { question: 'Q', answer: 'A' },
        status: 'skipped-identical',
        deckName: 'Shared',
      },
    ]);
    expect(formatSyncResult(result)).toEqual(['Skipped (already up-to-date): Q -> Shared']);
    expect(requestUrl.mock.calls.map(actionOf)).toContain('updateNoteTags');
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('updateNoteFields');
  });

  it('adds a note for a second source that shares a question in the default deck', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    const otherTag = sourceTag('other.md');

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([11]);
      if (request.action === 'notesInfo') return response([note(11, 'Q', 'first', [otherTag])]);
      if (request.action === 'addNote') return response(22);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const result = await connector.syncCards([{ question: 'Q', answer: 'second' }], 'mine.md');

    expect(result.cards).toEqual([
      { card: { question: 'Q', answer: 'second' }, status: 'added', deckName: 'Default' },
    ]);
    expect(requests('addNote')).toHaveLength(1);
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('updateNoteFields');
  });

  it('deletes only the default-deck notes owned by the synced note', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    const mineTag = sourceTag('mine.md');
    const otherTag = sourceTag('other.md');

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') {
        const query = queryOf(request);
        return response(query.includes(`tag:${mineTag}`) ? [11] : [11, 22]);
      }
      if (request.action === 'notesInfo') {
        return response([
          note(11, 'Removed', 'answer', [mineTag]),
          note(22, 'Kept', 'answer', [otherTag]),
        ]);
      }
      if (request.action === 'deleteNotes') return response(null);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const analysis = await connector.analyzeSyncOperation(
      [{ question: 'Kept', answer: 'answer' }],
      'mine.md'
    );
    expect(analysis.cardsToDelete.map((card) => card.existingCardId)).toEqual([11]);
    expect(requests('findNotes').map((request) => request.params?.query)).toContain(
      `deck:"Default" tag:panda-zap tag:${mineTag}`
    );

    const result = await connector.syncCards([], 'mine.md', undefined, true, [11]);
    expect(result.deletion).toEqual({ deletedCount: 1, failed: false });
    expect(requests('deleteNotes').map((request) => request.params?.notes)).toEqual([[11]]);
  });

  it('finds an emptied note by exact source tag after its deck override was removed', async () => {
    const connector = new AnkiConnector(settings, app);
    const hashedTag = sourceTag('mine.md');
    expect(legacySourceTag('mine.md')).not.toBe(hashedTag);

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([11]);
      if (request.action === 'notesInfo') {
        return response([note(11, 'Removed', 'answer', [hashedTag])]);
      }
      if (request.action === 'deleteNotes') return response(null);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    // The note was synced in a note-based deck earlier; its Deck:: line is gone.
    const analysis = await connector.analyzeSyncOperation([], 'mine.md', 'Nothing left here');
    const queries = requests('findNotes').map(queryOf);
    // One exact-tag lookup: no deck filter and no shared legacy tag.
    expect(queries).toEqual([`tag:panda-zap tag:${hashedTag}`]);
    expect(queries.join(' ')).not.toContain('deck:');
    expect(analysis.cardsToDelete.map((card) => card.existingCardId)).toEqual([11]);

    const result = await connector.syncCards([], 'mine.md', 'Nothing left here', true, [11]);
    expect(result.deletion).toEqual({ deletedCount: 1, failed: false });
    expect(requests('deleteNotes').map((request) => request.params?.notes)).toEqual([[11]]);
    // A deletion-only sync must not leave an empty deck behind.
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('createDeck');
  });

  it('does not re-analyse deletions when the confirmed ID list is empty', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const result = await new AnkiConnector(settings, app).syncCards(
      [],
      'mine.md',
      'Nothing left here',
      true,
      []
    );

    expect(result.deletion).toBeUndefined();
    expect(requestUrl.mock.calls.map(actionOf)).toEqual(['version']);
  });

  it('deletes exactly the immutable IDs supplied from confirmation', async () => {
    const connector = new AnkiConnector(settings, app);
    const mineSourceTag = sourceTag('mine.md');
    const confirmedIds = Object.freeze([11]);

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as {
        action: string;
        params?: { query?: string; notes?: string[] };
      };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(1);
      if (body.action === 'findNotes') return response([22]);
      if (body.action === 'notesInfo') return response([note(22, 'Q', 'A', [mineSourceTag])]);
      if (body.action === 'deleteNotes') {
        expect(body.params?.notes).toEqual([11]);
        return response(null);
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'A' }],
      'mine.md',
      'Q: Q\nA: A',
      true,
      confirmedIds
    );

    expect(result.deletion).toEqual({ deletedCount: 1, failed: false });
    expect(formatSyncResult(result)).toContain('Deleted 1 notes from Anki');
    expect(confirmedIds).toEqual([11]);
    expect(requestUrl.mock.calls.filter((call) => actionOf(call) === 'findNotes')).toHaveLength(1);
  });

  it('reports a failed deletion instead of a silent success', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(1);
      if (action === 'deleteNotes') return response(null, 'delete failed');
      throw new Error(`Unexpected action: ${action}`);
    });

    const result = await new AnkiConnector(settings, app).syncCards(
      [],
      'mine.md',
      'Q: Q\nA: A',
      true,
      [11]
    );

    expect(result.deletion).toEqual({ deletedCount: 0, failed: true, reason: 'delete failed' });
    expect(formatSyncResult(result)).toEqual(['Failed to delete notes: delete failed']);
  });

  it('does not add after an update operation fails', async () => {
    const connector = new AnkiConnector(settings, app);
    const mineSourceTag = sourceTag('mine.md');

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(1);
      if (action === 'findNotes') return response([11]);
      if (action === 'notesInfo') return response([note(11, 'Q', 'old', [mineSourceTag])]);
      if (action === 'updateNoteFields') return response(null, 'update failed');
      throw new Error(`Unexpected action: ${action}`);
    });

    const result = await connector.syncCards([{ question: 'Q', answer: 'new' }], 'mine.md');
    expect(result.cards).toEqual([
      {
        card: { question: 'Q', answer: 'new' },
        status: 'failed',
        reason: 'update failed',
      },
    ]);
    expect(formatSyncResult(result)).toEqual(['Failed: Q - update failed']);
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('addNote');
  });

  it('aborts a card when its image cannot be uploaded', async () => {
    const connector = new AnkiConnector(settings, app);
    vi.spyOn(
      connector as unknown as { uploadImageToAnki: () => Promise<string> },
      'uploadImageToAnki'
    ).mockRejectedValue(new Error('media failed'));
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(1);
      throw new Error(`Unexpected action: ${action}`);
    });

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'A', image: 'image.png' }],
      'mine.md'
    );
    expect(result.cards).toEqual([
      {
        card: { question: 'Q', answer: 'A', image: 'image.png' },
        status: 'image-failed',
        reason: 'media failed',
      },
    ]);
    expect(formatSyncResult(result)).toEqual(['Image failed (image.png): media failed']);
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('addNote');
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('updateNoteFields');
  });

  it('compares image cards using the exact stored media filename', async () => {
    const imageFile = {
      name: 'image.png',
      path: 'assets/topic/image.png',
      stat: { size: 100 },
    };
    const imageApp = {
      metadataCache: { getFirstLinkpathDest: vi.fn(() => imageFile) },
    } as unknown as ConstructorParameters<typeof AnkiConnector>[1];
    const connector = new AnkiConnector(settings, imageApp);
    const mineSourceTag = sourceTag('mine.md');
    const storedFilename = getStoredMediaFilename(imageApp, 'image.png', 'mine.md');

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'findNotes') return response([11]);
      if (action === 'notesInfo') {
        return response([note(11, 'Q', `A<br><img src="${storedFilename}">`, [mineSourceTag])]);
      }
      throw new Error(`Unexpected action: ${action}`);
    });

    const analysis = await connector.analyzeSyncOperation(
      [{ question: 'Q', answer: 'A', image: 'image.png' }],
      'mine.md'
    );

    expect(analysis.cardsToUpdate).toEqual([]);
  });

  it('reuses the analysis deck cache during sync', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    const mineSourceTag = sourceTag('mine.md');
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') {
        // The source-scoped deletion lookup sees nothing to delete here, so the
        // deck cache stays the only notesInfo lookup.
        const query = queryOf(request);
        return response(query.includes(`tag:${mineSourceTag}`) ? [] : [11]);
      }
      if (request.action === 'notesInfo') return response([note(11, 'Q', 'A', [mineSourceTag])]);
      if (request.action === 'updateNoteTags') return response(null);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const cards = [{ question: 'Q', answer: 'A' }];
    await connector.analyzeSyncOperation(cards, 'mine.md');
    const result = await connector.syncCards(cards, 'mine.md');

    expect(formatSyncResult(result)).toEqual(['Skipped (already up-to-date): Q -> Default']);
    expect(deckLookups('Default')).toHaveLength(1);
    // The deck read is reused, plus one targeted re-read of the matched note.
    expect(requests('notesInfo')).toHaveLength(2);
  });

  it('refreshes the cached deck when the connection port changes', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([]);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const cards = [{ question: 'Q', answer: 'A' }];
    await connector.analyzeSyncOperation(cards, 'mine.md');
    connector.updateSettings({ ...deckSettings, ankiConnectPort: 8766 });
    await connector.analyzeSyncOperation(cards, 'mine.md');

    expect(deckLookups('Default')).toHaveLength(2);
  });

  it('refreshes the cached deck when deck settings change', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([]);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const cards = [{ question: 'Q', answer: 'A' }];
    await connector.analyzeSyncOperation(cards, 'mine.md');
    connector.updateSettings({ ...deckSettings, defaultDeck: 'Renamed' });
    await connector.analyzeSyncOperation(cards, 'mine.md');

    expect(deckLookups('Default')).toHaveLength(1);
    expect(deckLookups('Renamed')).toHaveLength(1);
  });

  it('keeps the cached deck when unrelated settings change', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([]);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const cards = [{ question: 'Q', answer: 'A' }];
    await connector.analyzeSyncOperation(cards, 'mine.md');
    connector.updateSettings({ ...deckSettings, questionWord: 'Question' });
    await connector.analyzeSyncOperation(cards, 'mine.md');

    expect(deckLookups('Default')).toHaveLength(1);
  });

  it('refreshes the cached deck after an explicit invalidation', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([]);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const cards = [{ question: 'Q', answer: 'A' }];
    await connector.analyzeSyncOperation(cards, 'mine.md');
    connector.invalidateCache();
    await connector.analyzeSyncOperation(cards, 'mine.md');

    expect(deckLookups('Default')).toHaveLength(2);
  });

  it('re-queries Anki after the caller invalidates the cache following a sync run', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    const mineSourceTag = sourceTag('mine.md');
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([11]);
      if (request.action === 'notesInfo') return response([note(11, 'Q', 'A', [mineSourceTag])]);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const cards = [{ question: 'Q', answer: 'A' }];
    await connector.syncCards(cards, 'mine.md');
    // main.ts clears the cache once after syncCardsToAnki returns.
    connector.invalidateCache();
    await connector.syncCards(cards, 'mine.md');

    expect(deckLookups('Default')).toHaveLength(2);
    // Two deck reads plus one targeted re-read per sync run.
    expect(requests('notesInfo')).toHaveLength(4);
  });

  it('keeps one deck lookup across a shared-deck batch', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([]);
      if (request.action === 'addNote') return response(1);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const content = 'Deck:: Shared\nQ: Q\nA: A';
    const cards = [{ question: 'Q', answer: 'A' }];
    await connector.syncCards(cards, 'one.md', content);
    await connector.syncCards(cards, 'two.md', content);

    expect(deckLookups('Shared')).toHaveLength(1);
    expect(requests('addNote')).toHaveLength(2);
  });

  it('does not retry a non-idempotent request after a network error', async () => {
    requestUrl.mockRejectedValue(new TypeError('Failed to fetch'));
    const connector = new AnkiConnector(settings, app);
    const request = (
      connector as unknown as {
        ankiConnectRequest(action: string): Promise<unknown>;
      }
    ).ankiConnectRequest('addNote');

    await expect(request).rejects.toThrow('Failed to fetch');
    expect(requestUrl).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-idempotent request once the timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      requestUrl.mockImplementation(() => never());
      const connector = new AnkiConnector(settings, app);
      const request = (
        connector as unknown as {
          ankiConnectRequest(action: string): Promise<unknown>;
        }
      ).ankiConnectRequest('addNote');
      const rejection = expect(request).rejects.toThrow(
        /Anki Connect request "addNote" timed out after 5000 ms.*Anki is running/
      );

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await rejection;
      expect(requestUrl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the request timeout timer after a successful response', async () => {
    vi.useFakeTimers();
    try {
      requestUrl.mockResolvedValue(response(6));
      const connector = new AnkiConnector(settings, app);
      const result = await (
        connector as unknown as {
          ankiConnectRequest(action: string): Promise<unknown>;
        }
      ).ankiConnectRequest('version');

      expect(result).toBe(6);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries an idempotent read after a timeout', async () => {
    vi.useFakeTimers();
    try {
      requestUrl.mockImplementationOnce(() => never()).mockResolvedValueOnce(response([1]));
      const connector = new AnkiConnector(settings, app);
      const request = (
        connector as unknown as {
          ankiConnectRequest(action: string, params?: Record<string, unknown>): Promise<unknown>;
        }
      ).ankiConnectRequest('findNotes', { query: 'deck:"Default"' });

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_BASE_MS * 2);

      await expect(request).resolves.toEqual([1]);
      expect(requestUrl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports progress for every processed card', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(1);
      if (action === 'findNotes') return response([]);
      if (action === 'addNote') return response(1);
      throw new Error(`Unexpected action: ${action}`);
    });
    const cards = [1, 2, 3].map((n) => ({ question: `Q${n}`, answer: 'A' }));
    const progress: Array<[number, number]> = [];

    const result = await new AnkiConnector(settings, app).syncCards(
      cards,
      'mine.md',
      undefined,
      false,
      undefined,
      false,
      {
        onProgress: (done, total) => progress.push([done, total]),
      }
    );

    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(result.cards).toHaveLength(3);
  });

  it('stops before the next card when the run is cancelled', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(1);
      if (action === 'findNotes') return response([]);
      if (action === 'addNote') return response(1);
      throw new Error(`Unexpected action: ${action}`);
    });
    const cards = [1, 2, 3].map((n) => ({ question: `Q${n}`, answer: 'A' }));
    const abort = { cancelled: false };

    const result = await new AnkiConnector(settings, app).syncCards(
      cards,
      'mine.md',
      undefined,
      false,
      undefined,
      false,
      {
        abort,
        onProgress: (done) => {
          if (done === 1) abort.cancelled = true;
        },
      }
    );

    expect(requests('addNote')).toHaveLength(1);
    expect(result.cards).toEqual([{ card: cards[0], status: 'added', deckName: 'mine' }]);
  });

  it('does not delete notes when cancellation lands before the deletion', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(1);
      if (action === 'findNotes') return response([]);
      if (action === 'addNote') return response(1);
      throw new Error(`Unexpected action: ${action}`);
    });
    const abort = { cancelled: false };
    const card = { question: 'Q', answer: 'A' };

    const result = await new AnkiConnector(settings, app).syncCards(
      [card],
      'mine.md',
      'Q: Q\nA: A',
      true,
      [11],
      false,
      {
        abort,
        onProgress: (done, total) => {
          if (done === total) abort.cancelled = true;
        },
      }
    );

    expect(requests('deleteNotes')).toHaveLength(0);
    expect(result.deletion).toBeUndefined();
    expect(result.cards).toEqual([{ card, status: 'added', deckName: 'mine' }]);
  });

  it('detects an Anki edit made after the analysis instead of rewriting the stale snapshot', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    const anki = installFakeAnki(requestUrl);
    const card = { question: 'Q', answer: 'A' };
    const content = 'Q: Q\nA: A';

    await connector.syncCards([card], 'mine.md', content);
    connector.invalidateCache();
    const note = anki.notes[0];

    // The dialog analyses the unchanged card, so nothing is reported to update.
    const analysis = await connector.analyzeSyncOperation([card], 'mine.md', content);
    expect(analysis.cardsToUpdate).toEqual([]);
    expect(analysis.cardsInConflict).toEqual([]);

    // The user then edits the note in Anki while the dialog sits open.
    note.back = 'Edited in Anki';
    note.tags = [
      ...note.tags.filter((tag) => !tag.startsWith(SYNC_HASH_TAG_PREFIX)),
      `${SYNC_HASH_TAG_PREFIX}edited`,
    ];
    const tagsBefore = [...note.tags];
    anki.requests.length = 0;

    const result = await connector.syncCards([card], 'mine.md', content);

    expect(result.cards).toEqual([
      { card, status: 'conflict', deckName: 'Default', reason: 'changed in Anki' },
    ]);
    expect(anki.requests.map((request) => request.action)).not.toContain('updateNoteFields');
    expect(anki.requests.map((request) => request.action)).not.toContain('updateNoteTags');
    expect(note.back).toBe('Edited in Anki');
    expect(note.tags).toEqual(tagsBefore);
  });

  it('keeps a note cache per deck across an interleaved analysis and sync', async () => {
    const connector = new AnkiConnector(settings, app);
    const anki = installFakeAnki(requestUrl);
    const card = { question: 'Q', answer: 'A' };

    await connector.syncCards([card], 'a/one.md');
    await connector.syncCards([card], 'b/two.md');
    connector.invalidateCache();
    expect(anki.notes).toHaveLength(2);

    // Both notes are analysed before either is synced, as a batch would do.
    await connector.analyzeSyncOperation([card], 'a/one.md');
    await connector.analyzeSyncOperation([card], 'b/two.md');

    // One fresh deck read per analysis; the syncs must reuse both caches rather
    // than re-read a clobbered one and add a duplicate note.
    const oneReads = deckLookups('a::one').length;
    const twoReads = deckLookups('b::two').length;

    const [first, second] = await Promise.all([
      connector.syncCards([card], 'a/one.md'),
      connector.syncCards([card], 'b/two.md'),
    ]);

    expect(first.cards).toEqual([{ card, status: 'skipped-identical', deckName: 'a::one' }]);
    expect(second.cards).toEqual([{ card, status: 'skipped-identical', deckName: 'b::two' }]);

    const again = await connector.syncCards([card], 'a/one.md');
    expect(again.cards).toEqual([{ card, status: 'skipped-identical', deckName: 'a::one' }]);

    // Each deck stays cached, so no run re-reads it or adds a duplicate note.
    expect(deckLookups('a::one')).toHaveLength(oneReads);
    expect(deckLookups('b::two')).toHaveLength(twoReads);
    expect(requests('addNote')).toHaveLength(2);
    expect(anki.notes).toHaveLength(2);
  });

  it('creates the deck named by an override even when note-based decks are off', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    const anki = installFakeAnki(requestUrl);
    const card = { question: 'Hola', answer: 'Hello' };

    const result = await connector.syncCards(
      [card],
      'mine.md',
      '---\ndeck: Spanish\n---\nQ: Hola\nA: Hello'
    );

    expect(result.cards).toEqual([{ card, status: 'added', deckName: 'Spanish' }]);
    expect(requests('createDeck').map((request) => request.params)).toEqual([{ deck: 'Spanish' }]);
    expect(requests('addNote')[0].params?.note).toMatchObject({ deckName: 'Spanish' });
    expect(anki.cards[0].deckName).toBe('Spanish');
  });

  it('reports a failed source-tag migration after the deck already moved', async () => {
    const connector = new AnkiConnector(settings, app);
    const oldTag = sourceTag('folder/note.md');
    const newTag = sourceTag('other/renamed.md');
    const anki = installFakeAnki(requestUrl, {
      notes: [{ noteId: 11, front: 'Q', back: 'A', tags: ['panda-zap', oldTag], cards: [11] }],
      cards: [{ cardId: 11, note: 11, deckName: 'folder::note' }],
    });
    anki.failActions.add('updateNoteTags');

    await expect(
      connector.migrateSourceTag('folder/note.md', 'other/renamed.md', 'Q: Q\nA: A')
    ).rejects.toThrow('updateNoteTags failed');

    // The deck move happened first, so a retry still finds the note by its old
    // tag; nothing claims the tags moved to the new path.
    expect(requests('changeDeck').map((request) => request.params)).toEqual([
      { cards: [11], deck: 'other::renamed' },
    ]);
    expect(anki.cards[0].deckName).toBe('other::renamed');
    expect(anki.notes[0].tags).toEqual(['panda-zap', oldTag]);
    expect(anki.notes[0].tags).not.toContain(newTag);
  });
});
