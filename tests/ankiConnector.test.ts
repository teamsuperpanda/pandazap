import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({
  App: class {},
  TFile: class {},
  requestUrl,
}));

import { AnkiConnector } from '../src/sync/AnkiConnector';
import { getStoredMediaFilename } from '../src/sync/imageUtils';
import { DEFAULT_SETTINGS, type AnkiNoteInfo } from '../src/sync/types';

const settings = { ...DEFAULT_SETTINGS, useNoteBased: true };
const app = {} as ConstructorParameters<typeof AnkiConnector>[1];

function response(result: unknown, error: string | null = null, status = 200) {
  return { status, json: { result, error } };
}

function actionOf(call: unknown[]): string {
  return parseRequest((call[0] as { body: string }).body).action;
}

function parseRequest(body: string): { action: string } {
  return JSON.parse(body) as { action: string };
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
  });

  it('requires a valid successful version response', async () => {
    requestUrl.mockResolvedValueOnce(response(6, null, 500));
    expect(await new AnkiConnector(settings, app).testConnection()).toBe(false);

    requestUrl.mockResolvedValueOnce({ status: 200, json: { value: 6 } });
    expect(await new AnkiConnector(settings, app).testConnection()).toBe(false);

    requestUrl.mockResolvedValueOnce(response('6'));
    expect(await new AnkiConnector(settings, app).testConnection()).toBe(false);

    requestUrl.mockResolvedValueOnce(response(6));
    expect(await new AnkiConnector(settings, app).testConnection()).toBe(true);
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

    expect(result).toEqual(['Added: Q -> mine']);
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
    expect(result).toEqual(['Updated: Q -> mine']);
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
    expect(result[0]).toMatch(/^Skipped \(already up-to-date\): Q/);
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

    expect(result).toEqual(['Skipped (already up-to-date): Q -> Shared']);
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

    expect(result).toContain('Deleted 1 notes from Anki');
    expect(confirmedIds).toEqual(['11']);
    expect(requestUrl.mock.calls.filter((call) => actionOf(call) === 'findNotes')).toHaveLength(1);
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
    expect(result).toEqual(['Failed: Q - update failed']);
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
    expect(result).toEqual(['Image failed (image.png): media failed']);
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
});
