import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({
  App: class {},
  TFile: class {},
  requestUrl,
}));

import { AnkiConnector } from '../src/sync/AnkiConnector';
import { DEFAULT_SETTINGS, type AnkiCard, type PandaZapSettings } from '../src/sync/types';
import { SYNC_HASH_TAG_PREFIX } from '../src/constants';
import { installFakeAnki, type FakeAnkiState, type FakeNote } from './fakeAnki';

const app = {} as ConstructorParameters<typeof AnkiConnector>[1];
const NOTE_PATH = 'note.md';
const NOTE_CONTENT = 'Q: Q\nA: A';

function settings(overrides: Partial<PandaZapSettings> = {}): PandaZapSettings {
  return { ...DEFAULT_SETTINGS, useNoteBased: false, ...overrides };
}

function card(answer: string, question = 'Q'): AnkiCard {
  return { question, answer };
}

function syncTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => tag.startsWith(SYNC_HASH_TAG_PREFIX));
}

/** The fingerprint the plugin computes for a pushed Front and Back. */
function fingerprint(connector: AnkiConnector, front: string, back: string): string {
  return (connector as unknown as { syncTagFor(f: string, b: string): string }).syncTagFor(
    front,
    back
  );
}

function sourceTag(connector: AnkiConnector, notePath: string): string {
  return (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(notePath);
}

/** Adds one card through the connector, then drops the deck cache like a sync does. */
async function seedSyncedNote(connector: AnkiConnector, anki: FakeAnkiState): Promise<FakeNote> {
  const result = await connector.syncCards([card('A')], NOTE_PATH, NOTE_CONTENT);
  expect(result.cards[0].status).toBe('added');
  connector.invalidateCache();
  return anki.notes[0];
}

describe('Anki edit detection', () => {
  beforeEach(() => {
    requestUrl.mockReset();
  });

  it('skips a card changed in Anki by default and leaves the note and tag untouched', async () => {
    const connector = new AnkiConnector(settings(), app);
    const anki = installFakeAnki(requestUrl);
    const note = await seedSyncedNote(connector, anki);
    expect(syncTags(note.tags)).toEqual([fingerprint(connector, 'Q', 'A')]);

    note.back = 'Edited in Anki';
    const tagsBefore = [...note.tags];
    anki.requests.length = 0;

    const analysis = await connector.analyzeSyncOperation([card('A')], NOTE_PATH);
    expect(analysis.cardsInConflict).toHaveLength(1);
    expect(analysis.cardsToUpdate).toHaveLength(0);

    const result = await connector.syncCards([card('A')], NOTE_PATH);

    expect(result.cards[0]).toMatchObject({ status: 'conflict' });
    expect(anki.requests.some((request) => request.action === 'updateNoteFields')).toBe(false);
    expect(anki.requests.some((request) => request.action === 'updateNoteTags')).toBe(false);
    expect(note.back).toBe('Edited in Anki');
    expect(note.tags).toEqual(tagsBefore);
    expect(syncTags(note.tags)).toHaveLength(1);
  });

  it('overwrites a card changed in Anki when the setting is on and refreshes its tag', async () => {
    const connector = new AnkiConnector(settings({ overwriteAnkiEdits: true }), app);
    const anki = installFakeAnki(requestUrl);
    const note = await seedSyncedNote(connector, anki);
    const oldTag = syncTags(note.tags)[0];

    note.back = 'Edited in Anki';
    anki.requests.length = 0;

    const result = await connector.syncCards([card('Local answer')], NOTE_PATH);

    expect(result.cards[0]).toMatchObject({ status: 'updated' });
    expect(anki.requests.some((request) => request.action === 'updateNoteFields')).toBe(true);
    expect(note.back).toBe('Local answer');
    expect(syncTags(note.tags)).toEqual([fingerprint(connector, 'Q', 'Local answer')]);
    expect(syncTags(note.tags)[0]).not.toBe(oldTag);
  });

  it('updates a locally changed card that Anki did not touch', async () => {
    const connector = new AnkiConnector(settings(), app);
    const anki = installFakeAnki(requestUrl);
    const note = await seedSyncedNote(connector, anki);

    const result = await connector.syncCards([card('Local answer')], NOTE_PATH);

    expect(result.cards[0]).toMatchObject({ status: 'updated' });
    expect(note.back).toBe('Local answer');
    expect(syncTags(note.tags)).toEqual([fingerprint(connector, 'Q', 'Local answer')]);
  });

  it('updates a legacy note without a tag and starts detection from that push', async () => {
    const connector = new AnkiConnector(settings(), app);
    const legacyTag = sourceTag(connector, NOTE_PATH);
    const anki = installFakeAnki(requestUrl, {
      notes: [
        {
          noteId: '1',
          front: 'Q',
          back: 'A',
          tags: ['panda-zap', legacyTag],
          cards: [10],
        },
      ],
      cards: [{ cardId: 10, note: 1, deckName: 'Default' }],
    });

    const analysis = await connector.analyzeSyncOperation([card('Local answer')], NOTE_PATH);
    expect(analysis.cardsInConflict).toHaveLength(0);
    expect(analysis.cardsToUpdate).toHaveLength(1);

    const result = await connector.syncCards([card('Local answer')], NOTE_PATH);
    const note = anki.notes[0];

    expect(result.cards[0]).toMatchObject({ status: 'updated' });
    expect(note.back).toBe('Local answer');
    expect(syncTags(note.tags)).toEqual([fingerprint(connector, 'Q', 'Local answer')]);
  });

  it('replaces the tag instead of accumulating one per sync', async () => {
    const connector = new AnkiConnector(settings(), app);
    const anki = installFakeAnki(requestUrl);
    const note = await seedSyncedNote(connector, anki);

    for (const answer of ['B', 'C', 'D']) {
      connector.invalidateCache();
      const result = await connector.syncCards([card(answer)], NOTE_PATH);
      expect(result.cards[0]).toMatchObject({ status: 'updated' });
      expect(syncTags(note.tags)).toHaveLength(1);
    }

    expect(syncTags(note.tags)).toEqual([fingerprint(connector, 'Q', 'D')]);
  });

  it('skips a conflict for silent sync even when overwriting is enabled', async () => {
    const connector = new AnkiConnector(settings({ overwriteAnkiEdits: true }), app);
    const anki = installFakeAnki(requestUrl);
    const note = await seedSyncedNote(connector, anki);

    note.back = 'Edited in Anki';
    const tagsBefore = [...note.tags];
    anki.requests.length = 0;

    const result = await connector.syncCards(
      [card('Local answer')],
      NOTE_PATH,
      undefined,
      false,
      undefined,
      false,
      { skipConflicts: true }
    );

    expect(result.cards[0]).toMatchObject({ status: 'conflict' });
    expect(anki.requests.some((request) => request.action === 'updateNoteFields')).toBe(false);
    expect(note.back).toBe('Edited in Anki');
    expect(note.tags).toEqual(tagsBefore);
  });

  it('marks a removed note edited in Anki in the deletion analysis', async () => {
    const connector = new AnkiConnector(settings(), app);
    const anki = installFakeAnki(requestUrl);
    const note = await seedSyncedNote(connector, anki);
    note.back = 'Edited in Anki';
    connector.invalidateCache();

    const analysis = await connector.analyzeSyncOperation([], NOTE_PATH, 'Nothing left');

    expect(analysis.cardsToDelete).toHaveLength(1);
    expect(analysis.cardsToDelete[0].externallyEdited).toBe(true);
  });
});
