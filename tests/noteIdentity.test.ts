import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrl, notices, saveData, loadData, registerEvent } = vi.hoisted(() => ({
  requestUrl: vi.fn(),
  notices: [] as string[],
  saveData: vi.fn(),
  loadData: vi.fn(),
  registerEvent: vi.fn(),
}));

vi.mock('obsidian', () => ({
  Plugin: class {
    app: unknown;
    manifest: unknown;
    constructor(app: unknown, manifest: unknown) {
      this.app = app;
      this.manifest = manifest;
    }
    loadData = loadData;
    saveData = saveData;
    addRibbonIcon(): void {
      // no-op
    }
    addCommand(): void {
      // no-op
    }
    addSettingTab(): void {
      // no-op
    }
    registerMarkdownPostProcessor(): void {
      // no-op
    }
    registerEvent(eventRef: unknown): void {
      registerEvent(eventRef);
    }
  },
  MarkdownView: class {},
  TFile: class {
    path: string;
    extension: string;
    constructor(path = '') {
      this.path = path;
      this.extension = path.split('.').pop() ?? '';
    }
  },
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
  requestUrl,
}));

vi.mock('../src/dialogs/SyncModal', () => ({ SyncModal: class {} }));
vi.mock('../src/dialogs/SettingsTab', () => ({ PandaZapSettingTab: class {} }));
vi.mock('../src/dialogs/ConfirmModal', () => ({
  ConfirmModal: class {
    confirm(): Promise<boolean> {
      return Promise.resolve(true);
    }
  },
}));

import PandaZapPlugin from '../src/main';
import { TFile } from 'obsidian';
import { AnkiConnector } from '../src/sync/AnkiConnector';
import { DEFAULT_SETTINGS, createSyncContext, type PandaZapSettings } from '../src/sync/types';
import { installFakeAnki, type FakeAnkiState } from './fakeAnki';

type RenameHandler = (file: unknown, oldPath: string) => unknown;

/** The test mock's TFile takes the path; the Obsidian type does not. */
function newFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

interface Harness {
  app: Record<string, unknown>;
  files: Map<string, { content: string; file: unknown }>;
  renameHandlers: RenameHandler[];
  /** Set to make the next vault reads fail, like a locked or vanished file. */
  state: { readError: Error | null };
}

function createHarness(notes: Record<string, string> = {}): Harness {
  const files = new Map<string, { content: string; file: unknown }>();
  for (const [path, content] of Object.entries(notes)) {
    files.set(path, { content, file: newFile(path) });
  }
  const renameHandlers: RenameHandler[] = [];
  const state: { readError: Error | null } = { readError: null };
  const app = {
    vault: {
      on(event: string, handler: RenameHandler) {
        if (event === 'rename') renameHandlers.push(handler);
        return {};
      },
      getAbstractFileByPath(path: string) {
        return files.get(path)?.file ?? null;
      },
      async read(file: unknown) {
        if (state.readError) throw state.readError;
        for (const entry of files.values()) if (entry.file === file) return entry.content;
        return '';
      },
      getMarkdownFiles() {
        return [...files.values()].map((entry) => entry.file);
      },
    },
    workspace: {},
    metadataCache: {},
  };
  return { app, files, renameHandlers, state };
}

async function loadPlugin(harness: Harness): Promise<PandaZapPlugin> {
  const plugin = new PandaZapPlugin(harness.app as never, {} as never);
  await plugin.onload();
  // The load-time flush is fire and forget; chaining a second flush behind it
  // makes the test wait for the first to finish.
  await plugin.flushPendingTagMigrations();
  return plugin;
}

async function renameTo(
  harness: Harness,
  plugin: PandaZapPlugin,
  fromPath: string,
  toPath: string,
  content = ''
): Promise<void> {
  harness.files.delete(fromPath);
  harness.files.set(toPath, { content, file: newFile(toPath) });
  const file = harness.files.get(toPath)?.file;
  for (const handler of harness.renameHandlers) handler(file, fromPath);
  // The event handler starts its own flush; chaining a second flush behind it
  // waits for the first one to settle.
  await plugin.flushPendingTagMigrations();
}

function sourceTagOf(plugin: PandaZapPlugin, path: string): string {
  const connector = (plugin as unknown as { ankiConnector: AnkiConnector }).ankiConnector;
  return (connector as unknown as { getSourceTag(p: string): string }).getSourceTag(path);
}

function connectorOf(plugin: PandaZapPlugin): AnkiConnector {
  return (plugin as unknown as { ankiConnector: AnkiConnector }).ankiConnector;
}

function legacyTagOf(plugin: PandaZapPlugin, path: string): string {
  return (
    connectorOf(plugin) as unknown as { getLegacySourceTag(p: string): string }
  ).getLegacySourceTag(path);
}

function addAnkiNote(
  state: FakeAnkiState,
  noteId: string,
  tags: string[],
  deckName: string,
  front = 'Q'
): void {
  const cardId = Number(noteId);
  state.notes.push({ noteId, front, back: 'A', tags, cards: [cardId] });
  state.cards.push({ cardId, note: cardId, deckName });
}

let anki: FakeAnkiState;

beforeEach(() => {
  notices.length = 0;
  requestUrl.mockReset();
  registerEvent.mockReset();
  saveData.mockReset();
  saveData.mockResolvedValue(undefined);
  loadData.mockReset();
  loadData.mockImplementation(async () => ({ ...DEFAULT_SETTINGS }));
  anki = installFakeAnki(requestUrl);
});

describe('note rename migration', () => {
  it('moves the source tag to the new path and keeps the other tags', async () => {
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    const oldTag = sourceTagOf(plugin, 'folder/note.md');
    const newTag = sourceTagOf(plugin, 'folder/renamed.md');
    addAnkiNote(anki, '11', ['panda-zap', 'obsidian', oldTag, 'keep-me'], 'Default');

    await renameTo(harness, plugin, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

    expect(anki.notes[0].tags).not.toContain(oldTag);
    expect(anki.notes[0].tags).toContain(newTag);
    expect(anki.notes[0].tags).toContain('keep-me');
    expect(anki.notes[0].tags).toContain('obsidian');
    expect(plugin.settings.pendingTagMigrations).toEqual([]);
    expect(saveData).toHaveBeenLastCalledWith(
      expect.objectContaining({ pendingTagMigrations: [] })
    );
  });

  it('moves the cards to the deck of the new path after a folder move', async () => {
    loadData.mockImplementation(async () => ({ ...DEFAULT_SETTINGS, useNoteBased: true }));
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    const oldTag = sourceTagOf(plugin, 'folder/note.md');
    addAnkiNote(anki, '11', ['panda-zap', oldTag], 'folder::note');

    await renameTo(harness, plugin, 'folder/note.md', 'other/renamed.md', 'Q: Q\nA: A');

    const deckMove = anki.requests.find((request) => request.action === 'changeDeck');
    expect(deckMove?.params).toEqual({ cards: [11], deck: 'other::renamed' });
    expect(anki.cards[0].deckName).toBe('other::renamed');
  });

  it('leaves the deck alone for a rename within the same folder and deck', async () => {
    loadData.mockImplementation(async () => ({ ...DEFAULT_SETTINGS, useNoteBased: false }));
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    const oldTag = sourceTagOf(plugin, 'folder/note.md');
    addAnkiNote(anki, '11', ['panda-zap', oldTag], 'Default');

    await renameTo(harness, plugin, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

    expect(anki.requests.map((request) => request.action)).not.toContain('changeDeck');
  });

  it('drops the queue entry when no Anki note carries the old tag', async () => {
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);

    await renameTo(harness, plugin, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

    expect(plugin.settings.pendingTagMigrations).toEqual([]);
    expect(anki.requests.map((request) => request.action)).not.toContain('updateNoteTags');
    expect(notices).toEqual([]);
  });

  it('keeps an unmigrated rename queued and blocks the next sync', async () => {
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    const oldTag = sourceTagOf(plugin, 'folder/note.md');
    addAnkiNote(anki, '11', ['panda-zap', oldTag], 'Default');
    anki.failActions.add('findNotes');

    await renameTo(harness, plugin, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

    expect(plugin.settings.pendingTagMigrations).toEqual([
      { fromPath: 'folder/note.md', toPath: 'folder/renamed.md' },
    ]);
    expect(saveData).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingTagMigrations: [{ fromPath: 'folder/note.md', toPath: 'folder/renamed.md' }],
      })
    );

    const syncCards = vi.spyOn(connectorOf(plugin), 'syncCards');
    await expect(
      plugin.syncCardsToAnki(
        false,
        false,
        createSyncContext([{ question: 'Q', answer: 'A', line: 1 }], 'folder/renamed.md', '')
      )
    ).rejects.toThrow('renamed note "folder/renamed.md"');

    expect(syncCards).not.toHaveBeenCalled();
    expect(notices).toContain(
      'Could not update Anki for renamed note "folder/renamed.md". Connect to Anki and retry the sync.'
    );
    expect(plugin.settings.pendingTagMigrations).toHaveLength(1);
  });

  it('flushes a queue persisted from a previous session on load', async () => {
    loadData.mockImplementation(async () => ({
      ...DEFAULT_SETTINGS,
      useNoteBased: true,
      pendingTagMigrations: [{ fromPath: 'folder/note.md', toPath: 'other/renamed.md' }],
    }));
    const harness = createHarness({ 'other/renamed.md': 'Q: Q\nA: A' });
    const tagHelper = new AnkiConnector(
      { ...DEFAULT_SETTINGS } as PandaZapSettings,
      harness.app as never
    ) as unknown as { getSourceTag(p: string): string };
    const oldTag = tagHelper.getSourceTag('folder/note.md');
    addAnkiNote(anki, '11', ['panda-zap', oldTag], 'folder::note');

    const plugin = await loadPlugin(harness);

    expect(anki.notes[0].tags).not.toContain(oldTag);
    expect(anki.notes[0].tags).toContain(sourceTagOf(plugin, 'other/renamed.md'));
    expect(plugin.settings.pendingTagMigrations).toEqual([]);
    expect(anki.cards[0].deckName).toBe('other::renamed');
  });

  it('ignores renames of files that are not Markdown notes', async () => {
    const harness = createHarness({ 'notes.txt': 'plain' });
    await loadPlugin(harness);

    expect(harness.renameHandlers).toHaveLength(1);
    expect(registerEvent).toHaveBeenCalledTimes(1);
    await harness.renameHandlers[0](newFile('renamed.txt'), 'notes.txt');

    expect(notices).toEqual([]);
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it('follows a rename chain and ends with a single source tag', async () => {
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    const firstTag = sourceTagOf(plugin, 'folder/note.md');
    addAnkiNote(anki, '11', ['panda-zap', firstTag], 'Default');

    await renameTo(harness, plugin, 'folder/note.md', 'folder/step.md', 'Q: Q\nA: A');
    await renameTo(harness, plugin, 'folder/step.md', 'folder/final.md', 'Q: Q\nA: A');

    const tags = anki.notes[0].tags;
    expect(tags).toContain(sourceTagOf(plugin, 'folder/final.md'));
    expect(tags).not.toContain(firstTag);
    expect(tags.filter((tag) => tag.startsWith('source:'))).toHaveLength(1);
    expect(plugin.settings.pendingTagMigrations).toEqual([]);
  });

  it('never migrates the same rename twice', async () => {
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    addAnkiNote(anki, '11', ['panda-zap', sourceTagOf(plugin, 'folder/note.md')], 'Default');

    await renameTo(harness, plugin, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');
    const tagsAfterFirstRun = [...anki.notes[0].tags];
    const writesAfterFirstRun = anki.requests.filter(
      (request) => request.action === 'updateNoteTags'
    ).length;

    await plugin.flushPendingTagMigrations();

    expect(anki.notes[0].tags).toEqual(tagsAfterFirstRun);
    expect(anki.requests.filter((request) => request.action === 'updateNoteTags')).toHaveLength(
      writesAfterFirstRun
    );
  });

  it('keeps a Deck:: override deck for a renamed note', async () => {
    const harness = createHarness({ 'folder/note.md': 'Deck::Spanish\n\nQ: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    const oldTag = sourceTagOf(plugin, 'folder/note.md');
    addAnkiNote(anki, '11', ['panda-zap', oldTag], 'Spanish');

    await renameTo(
      harness,
      plugin,
      'folder/note.md',
      'folder/renamed.md',
      'Deck::Spanish\n\nQ: Q\nA: A'
    );

    expect(anki.notes[0].tags).toContain(sourceTagOf(plugin, 'folder/renamed.md'));
    expect(anki.requests.map((request) => request.action)).not.toContain('changeDeck');
    expect(anki.cards[0].deckName).toBe('Spanish');
  });

  it('does not pull back a card the user moved to another deck', async () => {
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    addAnkiNote(anki, '11', ['panda-zap', sourceTagOf(plugin, 'folder/note.md')], 'Custom');

    await renameTo(harness, plugin, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

    expect(anki.requests.map((request) => request.action)).not.toContain('changeDeck');
    expect(anki.cards[0].deckName).toBe('Custom');
    expect(anki.notes[0].tags).toContain(sourceTagOf(plugin, 'folder/renamed.md'));
  });

  it('migrates a note that only carries the legacy source tag', async () => {
    const harness = createHarness({ 'note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    const legacyOldTag = legacyTagOf(plugin, 'note.md');
    addAnkiNote(anki, '11', ['panda-zap', legacyOldTag], 'note');

    await renameTo(harness, plugin, 'note.md', 'renamed.md', 'Q: Q\nA: A');

    expect(anki.notes[0].tags).not.toContain(legacyOldTag);
    expect(anki.notes[0].tags).toContain(sourceTagOf(plugin, 'renamed.md'));
    expect(plugin.settings.pendingTagMigrations).toEqual([]);
    const write = anki.requests.find((request) => request.action === 'updateNoteTags');
    expect(write?.params?.note).toBe(11);
    expect(typeof write?.params?.note).toBe('number');
  });

  it('does not trust a truncated legacy tag when a Deck:: override is set', async () => {
    const deepFolder = `deep/${'a'.repeat(80)}`;
    const xPath = `${deepFolder}/x.md`;
    const content = 'Deck::Shared\n\nQ: X question\nA: X answer';
    const harness = createHarness({ [xPath]: content });
    const plugin = await loadPlugin(harness);
    const legacyOldTag = legacyTagOf(plugin, xPath);
    addAnkiNote(anki, '11', ['panda-zap', legacyOldTag], 'Shared', 'X question');

    await renameTo(harness, plugin, xPath, 'z.md', content);

    // A normal sync would not trust the truncated legacy tag with an override.
    expect(anki.notes[0].tags).toEqual(['panda-zap', legacyOldTag]);
    expect(plugin.settings.pendingTagMigrations).toEqual([]);
    expect(anki.requests.map((request) => request.action)).not.toContain('updateNoteTags');
  });

  it('leaves a sibling holding its own hashed tag untouched', async () => {
    const deepFolder = `deep/${'c'.repeat(80)}`;
    const xPath = `${deepFolder}/x.md`;
    const yPath = `${deepFolder}/y.md`;
    const xContent = 'Q: X question\nA: X answer';
    const harness = createHarness({ [xPath]: xContent, [yPath]: 'Q: Y question\nA: Y answer' });
    const plugin = await loadPlugin(harness);
    const legacyOldTag = legacyTagOf(plugin, xPath);
    expect(legacyTagOf(plugin, yPath)).toBe(legacyOldTag);
    // The sibling's note sits in the old deck and its Front happens to match,
    // but its own hashed tag proves it belongs to another note.
    const siblingHashedTag = sourceTagOf(plugin, yPath);
    addAnkiNote(
      anki,
      '11',
      ['panda-zap', sourceTagOf(plugin, xPath), legacyOldTag],
      `${deepFolder}::x`,
      'X question'
    );
    addAnkiNote(
      anki,
      '12',
      ['panda-zap', siblingHashedTag, legacyOldTag],
      `${deepFolder}::x`,
      'X question'
    );

    await renameTo(harness, plugin, xPath, 'z.md', xContent);

    const ownNote = anki.notes.find((note) => note.noteId === '11');
    const siblingNote = anki.notes.find((note) => note.noteId === '12');
    expect(ownNote?.tags).toContain(sourceTagOf(plugin, 'z.md'));
    expect(ownNote?.tags).not.toContain(legacyOldTag);
    expect(siblingNote?.tags).toEqual(['panda-zap', siblingHashedTag, legacyOldTag]);
    expect(siblingNote?.tags).not.toContain(sourceTagOf(plugin, 'z.md'));
    expect(notices).toEqual([]);

    const analysis = await connectorOf(plugin).analyzeSyncOperation([], 'z.md', '');
    expect(analysis.cardsToDelete.map((card) => card.existingCardId)).toEqual(['11']);
  });

  it('does not retag a legacy sibling that shares the Front of the renamed note', async () => {
    const deepFolder = `deep/${'d'.repeat(80)}`;
    const xPath = `${deepFolder}/x.md`;
    const xContent = 'Q: X question\nA: X answer';
    const harness = createHarness({ [xPath]: xContent });
    const plugin = await loadPlugin(harness);
    const legacyOldTag = legacyTagOf(plugin, xPath);
    const hashedOldTag = sourceTagOf(plugin, xPath);
    const oldDeck = `${deepFolder}::x`;
    // The note's own note holds both tags; the sibling is legacy-only and asks
    // the same question, so ownership is genuinely ambiguous.
    addAnkiNote(anki, '11', ['panda-zap', hashedOldTag, legacyOldTag], oldDeck, 'X question');
    addAnkiNote(anki, '12', ['panda-zap', legacyOldTag], oldDeck, 'X question');

    await renameTo(harness, plugin, xPath, 'z.md', xContent);

    const ownNote = anki.notes.find((note) => note.noteId === '11');
    const siblingNote = anki.notes.find((note) => note.noteId === '12');
    expect(ownNote?.tags).toContain(sourceTagOf(plugin, 'z.md'));
    expect(ownNote?.tags).not.toContain(legacyOldTag);
    expect(ownNote?.tags).not.toContain(hashedOldTag);
    expect(siblingNote?.tags).toEqual(['panda-zap', legacyOldTag]);
    expect(plugin.settings.pendingTagMigrations).toEqual([]);

    const analysis = await connectorOf(plugin).analyzeSyncOperation([], 'z.md', '');
    expect(analysis.cardsToDelete.map((card) => card.existingCardId)).toEqual(['11']);
  });

  it('migrates the hashed notes and warns when legacy cards stay unresolved', async () => {
    const deepFolder = `deep/${'e'.repeat(80)}`;
    const xPath = `${deepFolder}/x.md`;
    const xContent = 'Q: New question\nA: New answer';
    const harness = createHarness({ [xPath]: xContent });
    const plugin = await loadPlugin(harness);
    const legacyOldTag = legacyTagOf(plugin, xPath);
    addAnkiNote(
      anki,
      '11',
      ['panda-zap', sourceTagOf(plugin, xPath), legacyOldTag],
      `${deepFolder}::x`,
      'New question'
    );
    addAnkiNote(anki, '12', ['panda-zap', legacyOldTag], `${deepFolder}::x`, 'Old question');

    await renameTo(harness, plugin, xPath, 'z.md', xContent);

    expect(anki.notes[0].tags).toContain(sourceTagOf(plugin, 'z.md'));
    expect(anki.notes[0].tags).not.toContain(legacyOldTag);
    expect(anki.notes[1].tags).toEqual(['panda-zap', legacyOldTag]);
    expect(plugin.settings.pendingTagMigrations).toEqual([]);
    expect(notices).toContain(
      'Older Anki cards of renamed note "z.md" could not be identified and may remain in Anki as orphans.'
    );

    // The note is no longer blocked: its own cards are migrated.
    const syncCards = vi.spyOn(connectorOf(plugin), 'syncCards').mockResolvedValue({ cards: [] });
    await plugin.syncCardsToAnki(false, false, createSyncContext([], 'z.md', ''));
    expect(syncCards).toHaveBeenCalledTimes(1);
  });

  it('keeps the entry when the renamed note cannot be read', async () => {
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    harness.state.readError = new Error('read failed');

    await renameTo(harness, plugin, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

    expect(plugin.settings.pendingTagMigrations).toEqual([
      { fromPath: 'folder/note.md', toPath: 'folder/renamed.md' },
    ]);

    const syncCards = vi.spyOn(connectorOf(plugin), 'syncCards').mockResolvedValue({ cards: [] });
    await expect(
      plugin.syncCardsToAnki(false, false, createSyncContext([], 'folder/renamed.md', ''))
    ).rejects.toThrow('Could not update Anki for renamed note');
    await plugin.syncCardsToAnki(false, false, createSyncContext([], 'other.md', ''));
    expect(syncCards).toHaveBeenCalledTimes(1);

    harness.state.readError = null;
    expect(await plugin.flushPendingTagMigrations()).toEqual([]);
    expect(plugin.settings.pendingTagMigrations).toEqual([]);
  });

  it('keeps draining other entries and blocks only the affected sync', async () => {
    const harness = createHarness({ 'a/new.md': 'Q: Q\nA: A', 'b/new.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    const tagA = sourceTagOf(plugin, 'a/old.md');
    const tagB = sourceTagOf(plugin, 'b/old.md');
    addAnkiNote(anki, '11', ['panda-zap', tagA], 'Default');
    addAnkiNote(anki, '12', ['panda-zap', tagB], 'Default');
    plugin.settings.pendingTagMigrations = [
      { fromPath: 'a/old.md', toPath: 'a/new.md' },
      { fromPath: 'b/old.md', toPath: 'b/new.md' },
    ];
    anki.failFindNotes = (query) => query.includes(tagA);

    const failed = await plugin.flushPendingTagMigrations();

    expect(failed).toEqual([{ fromPath: 'a/old.md', toPath: 'a/new.md' }]);
    expect(anki.notes[0].tags).toContain(tagA);
    expect(anki.notes[1].tags).toContain(sourceTagOf(plugin, 'b/new.md'));
    expect(plugin.settings.pendingTagMigrations).toEqual([
      { fromPath: 'a/old.md', toPath: 'a/new.md' },
    ]);

    const syncCards = vi.spyOn(connectorOf(plugin), 'syncCards').mockResolvedValue({ cards: [] });
    await plugin.syncCardsToAnki(false, false, createSyncContext([], 'other.md', ''));
    expect(syncCards).toHaveBeenCalledTimes(1);

    await expect(
      plugin.syncCardsToAnki(false, false, createSyncContext([], 'a/new.md', ''))
    ).rejects.toThrow('renamed note "a/new.md"');
    expect(syncCards).toHaveBeenCalledTimes(1);
  });

  it('keeps a chained rename while the rename it depends on is pending', async () => {
    const harness = createHarness({ 'a/step.md': 'Q: Q\nA: A', 'a/final.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);
    const tagA = sourceTagOf(plugin, 'a/start.md');
    addAnkiNote(anki, '11', ['panda-zap', tagA], 'Default');
    plugin.settings.pendingTagMigrations = [
      { fromPath: 'a/start.md', toPath: 'a/step.md' },
      { fromPath: 'a/step.md', toPath: 'a/final.md' },
    ];
    anki.failFindNotes = (query) => query.includes(tagA);

    const failed = await plugin.flushPendingTagMigrations();

    expect(failed).toEqual([
      { fromPath: 'a/start.md', toPath: 'a/step.md' },
      { fromPath: 'a/step.md', toPath: 'a/final.md' },
    ]);
    expect(plugin.settings.pendingTagMigrations).toHaveLength(2);
    expect(anki.notes[0].tags).toContain(tagA);

    // Once the first rename can run, the chained entry drains behind it.
    anki.failFindNotes = undefined;
    expect(await plugin.flushPendingTagMigrations()).toEqual([]);
    expect(anki.notes[0].tags).toContain(sourceTagOf(plugin, 'a/final.md'));
    expect(anki.notes[0].tags.filter((tag) => tag.startsWith('source:'))).toHaveLength(1);
    expect(plugin.settings.pendingTagMigrations).toEqual([]);
  });
});
