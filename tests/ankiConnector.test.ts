import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({
  App: class {},
  TFile: class {},
  requestUrl,
}));

import { AnkiConnector } from '../src/sync/AnkiConnector';
import { getStoredMediaFilename } from '../src/sync/imageUtils';
import {
  DEFAULT_SETTINGS,
  describeConnection,
  formatSyncResult,
  type AnkiNoteInfo,
} from '../src/sync/types';
import { REQUEST_TIMEOUT_MS, RETRY_BACKOFF_BASE_MS } from '../src/constants';

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

function deckLookups(deckName: string) {
  return requests('findNotes').filter(
    (request) => request.params?.query === `deck:"${deckName}" tag:panda-zap`
  );
}

function never() {
  return new Promise<never>(() => {});
}

function note(noteId: string, front: string, back: string, tags: string[]): AnkiNoteInfo {
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
      connector.analyzeSyncOperation([{ question: 'Q', answer: 'A', line: 1 }], 'one.md')
    ).rejects.toThrow('lookup failed');
  });

  it('does not update a matching front owned by another source', async () => {
    const connector = new AnkiConnector(settings, app);
    const otherTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'other.md'
    );

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as { action: string };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(null);
      if (body.action === 'findNotes') return response(['11']);
      if (body.action === 'notesInfo') return response([note('11', 'Q', 'old', [otherTag])]);
      if (body.action === 'addNote') return response('22');
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'new', line: 1 }],
      false,
      'mine.md'
    );

    expect(result.cards).toEqual([
      { card: { question: 'Q', answer: 'new', line: 1 }, status: 'added', deckName: 'mine' },
    ]);
    expect(formatSyncResult(result)).toEqual(['Added: Q -> mine']);
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('updateNoteFields');
  });

  it('uses one selected cache entry for its ID, fields, and tags', async () => {
    const connector = new AnkiConnector(settings, app);
    const sourceTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'mine.md'
    );
    const otherTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'other.md'
    );

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as {
        action: string;
        params?: { note?: { id?: string } };
      };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(null);
      if (body.action === 'findNotes') return response(['11', '22']);
      if (body.action === 'notesInfo') {
        return response([note('11', 'Q', 'new', [otherTag]), note('22', 'Q', 'old', [sourceTag])]);
      }
      if (body.action === 'updateNoteFields') {
        expect(body.params?.note?.id).toBe('22');
        return response(null);
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'new', line: 1 }],
      false,
      'mine.md'
    );
    expect(result.cards).toEqual([
      { card: { question: 'Q', answer: 'new', line: 1 }, status: 'updated', deckName: 'mine' },
    ]);
    expect(formatSyncResult(result)).toEqual(['Updated: Q -> mine']);
  });

  it('recognizes and migrates a legacy truncated source tag', async () => {
    const connector = new AnkiConnector(settings, app);
    const tags = connector as unknown as {
      getSourceTag(path: string): string;
      getLegacySourceTag(path: string): string;
    };
    const path = `${'long-folder/'.repeat(10)}mine.md`;
    const legacyTag = tags.getLegacySourceTag(path);
    const sourceTag = tags.getSourceTag(path);
    expect(sourceTag).toHaveLength(80);
    expect(sourceTag).not.toBe(legacyTag);

    const siblingPath = `${'long-folder/'.repeat(10)}other.md`;
    expect(tags.getLegacySourceTag(siblingPath)).toBe(legacyTag);
    expect(tags.getSourceTag(siblingPath)).not.toBe(sourceTag);

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as {
        action: string;
        params?: { note?: number; tags?: string[] };
      };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(null);
      if (body.action === 'findNotes') return response(['42']);
      if (body.action === 'notesInfo') return response([note('42', 'Q', 'new', [legacyTag])]);
      if (body.action === 'updateNoteTags') {
        expect(body.params).toMatchObject({ note: 42 });
        expect(body.params?.tags).toContain(sourceTag);
        return response(null);
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'new', line: 1 }],
      false,
      path
    );
    expect(result.cards[0]).toMatchObject({ status: 'skipped-identical' });
    expect(formatSyncResult(result)[0]).toMatch(/^Skipped \(already up-to-date\): Q/);
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('updateNoteFields');
  });

  it('does not claim a colliding legacy source tag in a shared overridden deck', async () => {
    const connector = new AnkiConnector(settings, app);
    const tags = connector as unknown as {
      getLegacySourceTag(path: string): string;
    };
    const path = `${'long-folder/'.repeat(10)}mine.md`;
    const siblingPath = `${'long-folder/'.repeat(10)}other.md`;
    const overriddenDeck = path.replace(/\.md$/, '').replace(/\//g, '::');
    const legacyTag = tags.getLegacySourceTag(path);
    expect(tags.getLegacySourceTag(siblingPath)).toBe(legacyTag);

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
          body.params?.query === `deck:"${overriddenDeck}" tag:panda-zap` ? ['42'] : []
        );
      }
      if (body.action === 'notesInfo') {
        return response([note('42', 'Sibling question', 'answer', [legacyTag])]);
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const analysis = await connector.analyzeSyncOperation(
      [{ question: 'Mine', answer: 'answer', line: 2 }],
      path,
      `Deck:: ${overriddenDeck}\nQ: Mine\nA: answer`
    );

    expect(analysis.cardsToAdd).toHaveLength(1);
    expect(analysis.cardsToUpdate).toEqual([]);
    expect(analysis.cardsToDelete).toEqual([]);
  });

  it('recognizes and migrates a lossless legacy tag in a shared overridden deck', async () => {
    const connector = new AnkiConnector(settings, app);
    const tags = connector as unknown as {
      getSourceTag(path: string): string;
      getLegacySourceTag(path: string): string;
    };
    const path = 'folder/mine.md';
    const legacyTag = tags.getLegacySourceTag(path);
    const sourceTag = tags.getSourceTag(path);

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as {
        action: string;
        params?: { note?: number; tags?: string[]; query?: string };
      };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(null);
      if (body.action === 'findNotes') {
        return response(body.params?.query?.includes(`tag:${sourceTag}`) ? [] : ['42']);
      }
      if (body.action === 'notesInfo') return response([note('42', 'Q', 'A', [legacyTag])]);
      if (body.action === 'updateNoteTags') {
        expect(body.params).toMatchObject({ note: 42 });
        expect(body.params?.tags).toContain(sourceTag);
        return response(null);
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const analysis = await connector.analyzeSyncOperation(
      [{ question: 'Other', answer: 'answer', line: 2 }],
      path,
      'Deck:: Shared\nQ: Other\nA: answer'
    );
    expect(analysis.cardsToDelete.map((card) => card.existingCardId)).toEqual(['42']);

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'A', line: 2 }],
      false,
      path,
      'Deck:: Shared\nQ: Q\nA: A'
    );

    expect(result.cards).toEqual([
      {
        card: { question: 'Q', answer: 'A', line: 2 },
        status: 'skipped-identical',
        deckName: 'Shared',
      },
    ]);
    expect(formatSyncResult(result)).toEqual(['Skipped (already up-to-date): Q -> Shared']);
    expect(requestUrl.mock.calls.map(actionOf)).toContain('updateNoteTags');
    expect(requestUrl.mock.calls.map(actionOf)).not.toContain('updateNoteFields');
  });

  it('deletes exactly the immutable IDs supplied from confirmation', async () => {
    const connector = new AnkiConnector(settings, app);
    const sourceTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'mine.md'
    );
    const confirmedIds = Object.freeze(['11']);

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const body = JSON.parse(options.body) as {
        action: string;
        params?: { query?: string; notes?: string[] };
      };
      if (body.action === 'version') return response(6);
      if (body.action === 'createDeck') return response(null);
      if (body.action === 'findNotes') return response(['22']);
      if (body.action === 'notesInfo') return response([note('22', 'Q', 'A', [sourceTag])]);
      if (body.action === 'deleteNotes') {
        expect(body.params?.notes).toEqual(['11']);
        return response(null);
      }
      throw new Error(`Unexpected action: ${body.action}`);
    });

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'A', line: 1 }],
      false,
      'mine.md',
      'Q: Q\nA: A',
      true,
      confirmedIds
    );

    expect(result.deletion).toEqual({ deletedCount: 1, failed: false });
    expect(formatSyncResult(result)).toContain('Deleted 1 notes from Anki');
    expect(confirmedIds).toEqual(['11']);
    expect(requestUrl.mock.calls.filter((call) => actionOf(call) === 'findNotes')).toHaveLength(1);
  });

  it('reports a failed deletion instead of a silent success', async () => {
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(null);
      if (action === 'deleteNotes') return response(null, 'delete failed');
      throw new Error(`Unexpected action: ${action}`);
    });

    const result = await new AnkiConnector(settings, app).syncCards(
      [],
      false,
      'mine.md',
      'Q: Q\nA: A',
      true,
      ['11']
    );

    expect(result.deletion).toEqual({ deletedCount: 0, failed: true, reason: 'delete failed' });
    expect(formatSyncResult(result)).toEqual(['Failed to delete notes: delete failed']);
  });

  it('does not add after an update operation fails', async () => {
    const connector = new AnkiConnector(settings, app);
    const sourceTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'mine.md'
    );

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'createDeck') return response(null);
      if (action === 'findNotes') return response(['11']);
      if (action === 'notesInfo') return response([note('11', 'Q', 'old', [sourceTag])]);
      if (action === 'updateNoteFields') return response(null, 'update failed');
      throw new Error(`Unexpected action: ${action}`);
    });

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'new', line: 1 }],
      false,
      'mine.md'
    );
    expect(result.cards).toEqual([
      {
        card: { question: 'Q', answer: 'new', line: 1 },
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
      if (action === 'createDeck') return response(null);
      throw new Error(`Unexpected action: ${action}`);
    });

    const result = await connector.syncCards(
      [{ question: 'Q', answer: 'A', image: 'image.png', line: 1 }],
      false,
      'mine.md'
    );
    expect(result.cards).toEqual([
      {
        card: { question: 'Q', answer: 'A', image: 'image.png', line: 1 },
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
    const sourceTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'mine.md'
    );
    const storedFilename = getStoredMediaFilename(imageApp, 'image.png', 'mine.md');

    requestUrl.mockImplementation(async (options: { body: string }) => {
      const action = parseRequest(options.body).action;
      if (action === 'version') return response(6);
      if (action === 'findNotes') return response(['11']);
      if (action === 'notesInfo') {
        return response([note('11', 'Q', `A<br><img src="${storedFilename}">`, [sourceTag])]);
      }
      throw new Error(`Unexpected action: ${action}`);
    });

    const analysis = await connector.analyzeSyncOperation(
      [{ question: 'Q', answer: 'A', image: 'image.png', line: 1 }],
      'mine.md'
    );

    expect(analysis.cardsToUpdate).toEqual([]);
  });

  it('reuses the analysis deck cache during sync', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    const sourceTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'mine.md'
    );
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response(['11']);
      if (request.action === 'notesInfo') return response([note('11', 'Q', 'A', [sourceTag])]);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const cards = [{ question: 'Q', answer: 'A', line: 1 }];
    await connector.analyzeSyncOperation(cards, 'mine.md');
    const result = await connector.syncCards(cards, false, 'mine.md');

    expect(formatSyncResult(result)).toEqual(['Skipped (already up-to-date): Q -> Default']);
    expect(deckLookups('Default')).toHaveLength(1);
    expect(requests('notesInfo')).toHaveLength(1);
  });

  it('refreshes the cached deck when the connection port changes', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([]);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const cards = [{ question: 'Q', answer: 'A', line: 1 }];
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

    const cards = [{ question: 'Q', answer: 'A', line: 1 }];
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

    const cards = [{ question: 'Q', answer: 'A', line: 1 }];
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

    const cards = [{ question: 'Q', answer: 'A', line: 1 }];
    await connector.analyzeSyncOperation(cards, 'mine.md');
    connector.invalidateCache();
    await connector.analyzeSyncOperation(cards, 'mine.md');

    expect(deckLookups('Default')).toHaveLength(2);
  });

  it('re-queries Anki after the caller invalidates the cache following a sync run', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    const sourceTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'mine.md'
    );
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response(['11']);
      if (request.action === 'notesInfo') return response([note('11', 'Q', 'A', [sourceTag])]);
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const cards = [{ question: 'Q', answer: 'A', line: 1 }];
    await connector.syncCards(cards, false, 'mine.md');
    // main.ts clears the cache once after syncCardsToAnki returns.
    connector.invalidateCache();
    await connector.syncCards(cards, false, 'mine.md');

    expect(deckLookups('Default')).toHaveLength(2);
    expect(requests('notesInfo')).toHaveLength(2);
  });

  it('keeps one deck lookup across a shared-deck batch', async () => {
    const connector = new AnkiConnector(deckSettings, app);
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = parseRequest(options.body);
      if (request.action === 'version') return response(6);
      if (request.action === 'findNotes') return response([]);
      if (request.action === 'addNote') return response('1');
      throw new Error(`Unexpected action: ${request.action}`);
    });

    const content = 'Deck:: Shared\nQ: Q\nA: A';
    const cards = [{ question: 'Q', answer: 'A', line: 1 }];
    await connector.syncCards(cards, false, 'one.md', content);
    await connector.syncCards(cards, false, 'two.md', content);

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
      requestUrl.mockImplementationOnce(() => never()).mockResolvedValueOnce(response(['1']));
      const connector = new AnkiConnector(settings, app);
      const request = (
        connector as unknown as {
          ankiConnectRequest(action: string, params?: Record<string, unknown>): Promise<unknown>;
        }
      ).ankiConnectRequest('findNotes', { query: 'deck:"Default"' });

      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_BASE_MS * 2);

      await expect(request).resolves.toEqual(['1']);
      expect(requestUrl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
