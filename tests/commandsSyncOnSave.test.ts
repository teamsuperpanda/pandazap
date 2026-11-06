import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CommandLike {
  id: string;
  name: string;
  checkCallback?: (checking: boolean) => boolean;
}

interface StatusBarState {
  text: string;
  attributes: Record<string, string>;
  classes: Set<string>;
}

const { requestUrl, notices, openSyncModal, commands, statusBarState, statusItem } = vi.hoisted(
  () => {
    const statusBarState = {
      text: '',
      attributes: {} as Record<string, string>,
      classes: new Set<string>(),
    };
    const statusItem = {
      setText(value: string) {
        statusBarState.text = value;
      },
      setAttribute(name: string, value: string) {
        statusBarState.attributes[name] = value;
      },
      addClass(name: string) {
        statusBarState.classes.add(name);
      },
    };
    return {
      requestUrl: vi.fn(),
      notices: [] as string[],
      openSyncModal: vi.fn(),
      commands: [] as CommandLike[],
      statusBarState,
      statusItem,
    };
  }
);

vi.mock('obsidian', () => ({
  Plugin: class {
    async loadData() {
      return null;
    }
    async saveData() {
      return undefined;
    }
    addRibbonIcon() {
      return undefined;
    }
    addCommand(command: CommandLike) {
      commands.push(command);
    }
    addSettingTab() {
      return undefined;
    }
    registerMarkdownPostProcessor() {
      return undefined;
    }
    registerEvent() {
      return undefined;
    }
    addStatusBarItem() {
      return statusItem;
    }
  },
  MarkdownView: class {},
  TFile: class {},
  Modal: class {},
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
  requestUrl,
}));

vi.mock('../src/dialogs/SyncModal', () => ({
  SyncModal: class {
    open() {
      openSyncModal();
    }
  },
}));
vi.mock('../src/dialogs/SettingsTab', () => ({ PandaZapSettingTab: class {} }));
vi.mock('../src/dialogs/ConfirmModal', () => ({ ConfirmModal: class {} }));

import PandaZapPlugin from '../src/main';
import { MarkdownView, TFile } from 'obsidian';
import type { Menu, TAbstractFile } from 'obsidian';
import { AnkiConnector } from '../src/sync/AnkiConnector';
import { DEFAULT_SETTINGS, type PandaZapSettings } from '../src/sync/types';
import { SYNC_ON_SAVE_DEBOUNCE_MS } from '../src/constants';
import { installFakeAnki, type FakeAnkiState } from './fakeAnki';

type VaultHandler = (file: TAbstractFile) => void;
type FileMenuHandler = (menu: unknown, file: TAbstractFile) => void;

const newPlugin = () => new (PandaZapPlugin as unknown as new () => PandaZapPlugin)();
const newMarkdownView = () => new (MarkdownView as unknown as new () => MarkdownView)();

interface MenuEntry {
  title: string;
  onClick?: () => void;
}

interface Harness {
  plugin: PandaZapPlugin;
  file: (path: string) => TFile;
  setActiveView: (view: unknown) => void;
  vaultHandlers: Map<string, VaultHandler>;
  workspaceHandlers: Map<string, FileMenuHandler>;
  selectFiles: (...files: TFile[]) => void;
}

function markdownView(path: string, content: string): MarkdownView {
  return Object.assign(newMarkdownView(), {
    file: { path },
    editor: { getValue: () => content },
  });
}

async function createHarness(notes: Record<string, string> = {}): Promise<Harness> {
  const files = new Map<string, TFile>();
  const contents = new Map<string, string>(Object.entries(notes));
  const vaultHandlers = new Map<string, VaultHandler>();
  const workspaceHandlers = new Map<string, FileMenuHandler>();
  let activeView: object | null = null;
  const selected: TFile[] = [];

  const file = (path: string): TFile => {
    const existing = files.get(path);
    if (existing) return existing;
    const created = Object.assign(new TFile(), {
      path,
      extension: path.slice(path.lastIndexOf('.') + 1),
    });
    files.set(path, created);
    return created;
  };
  for (const path of Object.keys(notes)) file(path);

  const vault = {
    on: (event: string, handler: VaultHandler) => {
      vaultHandlers.set(event, handler);
      return {};
    },
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    read: async (target: TFile) => {
      for (const [path, entry] of files) {
        if (entry === target) return contents.get(path) ?? '';
      }
      return '';
    },
    getMarkdownFiles: () => [...files.values()],
  };
  const workspace = {
    getActiveViewOfType: (type: new (...args: never[]) => object) =>
      activeView instanceof type ? activeView : null,
    on: (event: string, handler: FileMenuHandler) => {
      workspaceHandlers.set(event, handler);
      return {};
    },
    getLeavesOfType: (_type: string) =>
      selected.length > 0 ? [{ view: { getSelectedFiles: () => new Set(selected) } }] : [],
  };

  const plugin = newPlugin();
  (plugin as unknown as { app: unknown }).app = { vault, workspace };
  await plugin.onload();

  return {
    plugin,
    file,
    setActiveView: (view) => {
      activeView = (view ?? null) as object | null;
    },
    vaultHandlers,
    workspaceHandlers,
    selectFiles: (...next) => {
      selected.splice(0, selected.length, ...next);
    },
  };
}

function stubConnector(overrides: Record<string, unknown> = {}) {
  return {
    updateSettings: vi.fn(),
    invalidateCache: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ status: 'ok', version: 6 }),
    hasNotesForSourceTag: vi.fn().mockResolvedValue(false),
    analyzeSyncOperation: vi.fn().mockResolvedValue({
      cardsToAdd: [],
      cardsToUpdate: [],
      cardsToDelete: [],
      totalCards: 0,
    }),
    syncCards: vi.fn().mockResolvedValue({ cards: [] }),
    ...overrides,
  };
}

function useConnector(plugin: PandaZapPlugin, connector: ReturnType<typeof stubConnector>): void {
  (plugin as unknown as { ankiConnector: unknown }).ankiConnector = connector;
}

function useSettings(plugin: PandaZapPlugin, overrides: Partial<PandaZapSettings> = {}): void {
  plugin.settings = { ...DEFAULT_SETTINGS, ...overrides };
}

function createMenu(): { entries: MenuEntry[]; menu: Menu } {
  const entries: MenuEntry[] = [];
  const menu = {
    addItem: (build: (item: unknown) => void) => {
      const entry: MenuEntry = { title: '' };
      const item = {
        setTitle(title: string) {
          entry.title = title;
          return item;
        },
        setIcon() {
          return item;
        },
        onClick(callback: () => void) {
          entry.onClick = callback;
          return item;
        },
      };
      build(item);
      entries.push(entry);
    },
  } as unknown as Menu;
  return { entries, menu };
}

beforeEach(() => {
  notices.length = 0;
  commands.length = 0;
  openSyncModal.mockReset();
  requestUrl.mockReset();
  statusBarState.text = '';
  statusBarState.attributes = {};
  statusBarState.classes.clear();
  (globalThis as unknown as { activeDocument: unknown }).activeDocument = {
    querySelectorAll: () => [],
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sync current note command', () => {
  it('is visible only for a Markdown file', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const command = commands.find((entry) => entry.id === 'sync-current-note');
    expect(command?.name).toBe('Sync current note to Anki');
    expect(command?.checkCallback).toBeTypeOf('function');

    expect(command?.checkCallback?.(true)).toBe(false);
    harness.setActiveView(newMarkdownView());
    expect(command?.checkCallback?.(true)).toBe(true);
    harness.setActiveView({ not: 'a markdown view' });
    expect(command?.checkCallback?.(true)).toBe(false);
  });

  it('syncs the active note from the editor buffer without opening the dialog', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Saved\nA: Value' });
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn().mockResolvedValue({
        cardsToAdd: [],
        cardsToUpdate: [],
        cardsToDelete: [],
        totalCards: 1,
      }),
      syncCards: vi.fn().mockResolvedValue({
        cards: [{ card: { question: 'Buffered', answer: 'Value', line: 1 }, status: 'updated' }],
      }),
    });
    useConnector(harness.plugin, connector);
    harness.setActiveView(markdownView('note.md', 'Q: Buffered\nA: Value'));

    await harness.plugin.syncCurrentNote();

    expect(openSyncModal).not.toHaveBeenCalled();
    expect(connector.syncCards).toHaveBeenCalledWith(
      [{ question: 'Buffered', answer: 'Value', line: 1 }],
      false,
      'note.md',
      'Q: Buffered\nA: Value',
      false,
      [],
      false,
      undefined
    );
    expect(notices[notices.length - 1]).toBe('Sync completed: 1 succeeded, 0 skipped');
  });

  it('uses the dialog confirmation path when the note has deletions', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn().mockResolvedValue({
        cardsToAdd: [],
        cardsToUpdate: [],
        cardsToDelete: [
          {
            card: { question: 'Old', answer: '', line: -1 },
            action: 'delete',
            deckName: 'note',
            existingCardId: '1',
          },
        ],
        totalCards: 1,
      }),
    });
    useConnector(harness.plugin, connector);
    harness.setActiveView(markdownView('note.md', 'Q: Q\nA: A'));

    await harness.plugin.syncCurrentNote();

    expect(openSyncModal).toHaveBeenCalledTimes(1);
    expect(connector.syncCards).not.toHaveBeenCalled();
  });
});

describe('file menu sync entry', () => {
  it('adds one entry for the clicked Markdown file', async () => {
    const harness = await createHarness({ 'one.md': '', 'two.md': '' });
    const open = vi.spyOn(harness.plugin, 'openBatchSyncDialog').mockResolvedValue();
    const { entries, menu } = createMenu();

    harness.workspaceHandlers.get('file-menu')?.(menu, harness.file('one.md'));

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Sync note to Anki');
    entries[0].onClick?.();
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith(['one.md']);
  });

  it('syncs all selected Markdown files with a counted label', async () => {
    const harness = await createHarness({ 'one.md': '', 'two.md': '' });
    const open = vi.spyOn(harness.plugin, 'openBatchSyncDialog').mockResolvedValue();
    harness.selectFiles(harness.file('one.md'), harness.file('two.md'));
    const { entries, menu } = createMenu();

    harness.workspaceHandlers.get('file-menu')?.(menu, harness.file('two.md'));

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Sync 2 notes to Anki');
    entries[0].onClick?.();
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith(['one.md', 'two.md']);
  });

  it('does not add an entry for a non-Markdown file', async () => {
    const harness = await createHarness({ 'image.png': '' });
    const { entries, menu } = createMenu();

    harness.workspaceHandlers.get('file-menu')?.(menu, harness.file('image.png'));

    expect(entries).toHaveLength(0);
  });
});

describe('sync on save', () => {
  it('does nothing while the setting is off', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector();
    useConnector(harness.plugin, connector);
    useSettings(harness.plugin, { syncOnSave: false });
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(connector.hasNotesForSourceTag).not.toHaveBeenCalled();
    expect(connector.syncCards).not.toHaveBeenCalled();
  });

  it('skips a note that has never been synced to Anki', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector();
    useConnector(harness.plugin, connector);
    useSettings(harness.plugin, { syncOnSave: true });
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(connector.hasNotesForSourceTag).toHaveBeenCalledWith('note.md');
    expect(connector.syncCards).not.toHaveBeenCalled();
    expect(statusBarState.text).toBe('');
    expect(notices).toHaveLength(0);
  });

  it('coalesces rapid writes into one sync per note', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector({
      hasNotesForSourceTag: vi.fn().mockResolvedValue(true),
    });
    useConnector(harness.plugin, connector);
    useSettings(harness.plugin, { syncOnSave: true });
    vi.useFakeTimers();

    const modify = harness.vaultHandlers.get('modify');
    modify?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(500);
    modify?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS - 1);
    expect(connector.syncCards).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(connector.hasNotesForSourceTag).toHaveBeenCalledTimes(1);
    expect(connector.syncCards).toHaveBeenCalledTimes(1);
  });

  it('never deletes Anki notes in silent mode', async () => {
    const settings: PandaZapSettings = { ...DEFAULT_SETTINGS, useNoteBased: false };
    const connector = new AnkiConnector(settings, {} as never);
    const sourceTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'note.md'
    );
    const anki: FakeAnkiState = installFakeAnki(requestUrl, {
      notes: [
        {
          noteId: '1',
          front: 'Q1',
          back: 'A1',
          tags: ['panda-zap', sourceTag],
          cards: [10],
        },
        {
          // A stale card a confirmed sync would be allowed to remove.
          noteId: '2',
          front: 'Stale',
          back: 'Old answer',
          tags: ['panda-zap', sourceTag],
          cards: [11],
        },
      ],
      cards: [
        { cardId: 10, note: 1, deckName: 'Default' },
        { cardId: 11, note: 2, deckName: 'Default' },
      ],
    });
    const harness = await createHarness({ 'note.md': 'Q: Q1\nA: A1' });
    useConnector(harness.plugin, connector as unknown as ReturnType<typeof stubConnector>);
    useSettings(harness.plugin, { useNoteBased: false, syncOnSave: true });
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(anki.requests.some((request) => request.action === 'deleteNotes')).toBe(false);
    expect(anki.requests.some((request) => request.action === 'updateNoteFields')).toBe(false);
    expect(notices).toHaveLength(0);
    expect(statusBarState.text).toBe('Panda Zap: idle');
  });

  it('does not run while a sync dialog is open', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector({
      hasNotesForSourceTag: vi.fn().mockResolvedValue(true),
    });
    useConnector(harness.plugin, connector);
    useSettings(harness.plugin, { syncOnSave: true });
    harness.plugin.showSyncModal({ open: vi.fn() } as never);
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(connector.hasNotesForSourceTag).not.toHaveBeenCalled();
    expect(connector.syncCards).not.toHaveBeenCalled();
    expect(statusBarState.text).toBe('Panda Zap: paused');
  });

  it('reports a silent failure on the status item and clears it on success', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector({
      hasNotesForSourceTag: vi.fn().mockResolvedValue(true),
      syncCards: vi.fn().mockRejectedValueOnce(new Error('Anki is down')),
    });
    useConnector(harness.plugin, connector);
    useSettings(harness.plugin, { syncOnSave: true });
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(statusBarState.text).toBe('Panda Zap: sync failed - note');
    expect(statusBarState.attributes.title).toContain('Anki is down');
    expect(notices).toHaveLength(0);

    connector.syncCards.mockResolvedValue({ cards: [] });
    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(statusBarState.text).toBe('Panda Zap: idle');
  });

  it('keeps a repeated failure visible instead of leaving the syncing state', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector({
      hasNotesForSourceTag: vi.fn().mockResolvedValue(true),
      syncCards: vi.fn().mockRejectedValue(new Error('Anki is down')),
    });
    useConnector(harness.plugin, connector);
    useSettings(harness.plugin, { syncOnSave: true });
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);
    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(statusBarState.text).toBe('Panda Zap: sync failed - note');
  });
});
