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
}

function createHarness(notes: Record<string, string> = {}): Harness {
  const files = new Map<string, { content: string; file: unknown }>();
  for (const [path, content] of Object.entries(notes)) {
    files.set(path, { content, file: newFile(path) });
  }
  const renameHandlers: RenameHandler[] = [];
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
  return { app, files, renameHandlers };
}

async function loadPlugin(harness: Harness): Promise<PandaZapPlugin> {
  const plugin = new PandaZapPlugin(harness.app as never, {} as never);
  await plugin.onload();
  // The load-time flush is fire and forget; chaining a second flush behind it
  // makes the test wait for the first to finish.
  await plugin.flushPendingTagMigrations();
  return plugin;
}

function renameTo(
  harness: Harness,
  fromPath: string,
  toPath: string,
  content = ''
): Promise<unknown[]> {
  harness.files.delete(fromPath);
  harness.files.set(toPath, { content, file: newFile(toPath) });
  const file = harness.files.get(toPath)?.file;
  return Promise.all(harness.renameHandlers.map((handler) => handler(file, fromPath)));
}

function sourceTagOf(plugin: PandaZapPlugin, path: string): string {
  const connector = (plugin as unknown as { ankiConnector: AnkiConnector }).ankiConnector;
  return (connector as unknown as { getSourceTag(p: string): string }).getSourceTag(path);
}

function connectorOf(plugin: PandaZapPlugin): AnkiConnector {
  return (plugin as unknown as { ankiConnector: AnkiConnector }).ankiConnector;
}

function addAnkiNote(state: FakeAnkiState, noteId: string, tags: string[], deckName: string): void {
  const cardId = Number(noteId);
  state.notes.push({ noteId, front: 'Q', back: 'A', tags, cards: [cardId] });
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

    await renameTo(harness, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

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

    await renameTo(harness, 'folder/note.md', 'other/renamed.md', 'Q: Q\nA: A');

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

    await renameTo(harness, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

    expect(anki.requests.map((request) => request.action)).not.toContain('changeDeck');
  });

  it('drops the queue entry when no Anki note carries the old tag', async () => {
    const harness = createHarness({ 'folder/note.md': 'Q: Q\nA: A' });
    const plugin = await loadPlugin(harness);

    await renameTo(harness, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

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

    await renameTo(harness, 'folder/note.md', 'folder/renamed.md', 'Q: Q\nA: A');

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
});
