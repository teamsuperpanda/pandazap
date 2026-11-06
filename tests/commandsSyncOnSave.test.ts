import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CommandLike {
  id: string;
  name: string;
  checkCallback?: (checking: boolean) => boolean;
}

const {
  requestUrl,
  notices,
  openSyncModal,
  commands,
  statusBarState,
  statusItem,
  confirmResult,
  confirmOptions,
} = vi.hoisted(() => {
  const statusBarState = {
    text: '',
    attributes: {} as Record<string, string>,
    classes: new Set<string>(),
    created: 0,
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
    confirmResult: { value: true },
    confirmOptions: [] as Array<{ title: string; message: string; items?: readonly string[] }>,
  };
});

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
      statusBarState.created += 1;
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
vi.mock('../src/dialogs/ConfirmModal', () => ({
  ConfirmModal: class {
    constructor(_app: unknown, options: { title: string; message: string; items?: string[] }) {
      confirmOptions.push(options);
    }
    async confirm(): Promise<boolean> {
      return confirmResult.value;
    }
  },
}));

import PandaZapPlugin from '../src/main';
import { MarkdownView, TFile } from 'obsidian';
import type { Menu, TAbstractFile } from 'obsidian';
import { AnkiConnector } from '../src/sync/AnkiConnector';
import {
  DEFAULT_SETTINGS,
  createSyncContext,
  type PandaZapSettings,
  type SyncRunOptions,
} from '../src/sync/types';
import { SYNC_ON_SAVE_DEBOUNCE_MS } from '../src/constants';
import { installFakeAnki, type FakeAnkiState } from './fakeAnki';

/** The abort token a sync run is given; the cast keeps the nested matcher typed. */
const expectedAbort = expect.objectContaining({ cancelled: false }) as SyncRunOptions['abort'];

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
      cardsInConflict: [],
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

/** The fingerprint the connector computes for a pushed Front and Back. */
function syncTagFor(connector: AnkiConnector, front: string, back: string): string {
  return (connector as unknown as { syncTagFor(f: string, b: string): string }).syncTagFor(
    front,
    back
  );
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
  statusBarState.created = 0;
  confirmOptions.length = 0;
  confirmResult.value = true;
  (globalThis as unknown as { activeDocument: unknown }).activeDocument = {
    querySelectorAll: () => [],
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sync current note command', () => {
  it('creates the status item during onload', async () => {
    await createHarness();

    expect(statusBarState.created).toBe(1);
    expect(statusBarState.classes.has('panda-zap-sync-status')).toBe(true);
  });

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

  it('runs the sync when checkCallback is invoked for execution', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const command = commands.find((entry) => entry.id === 'sync-current-note');
    const sync = vi.spyOn(harness.plugin, 'syncCurrentNote').mockResolvedValue();

    expect(command?.checkCallback?.(false)).toBe(false);
    harness.setActiveView(newMarkdownView());
    expect(command?.checkCallback?.(false)).toBe(true);

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('syncs the active note from the editor buffer without opening the dialog', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Saved\nA: Value' });
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn().mockResolvedValue({
        cardsToAdd: [],
        cardsToUpdate: [],
        cardsToDelete: [],
        cardsInConflict: [],
        totalCards: 1,
      }),
      syncCards: vi.fn().mockResolvedValue({
        cards: [{ card: { question: 'Buffered', answer: 'Value' }, status: 'updated' }],
      }),
    });
    useConnector(harness.plugin, connector);
    harness.setActiveView(markdownView('note.md', 'Q: Buffered\nA: Value'));

    await harness.plugin.syncCurrentNote();

    expect(openSyncModal).not.toHaveBeenCalled();
    expect(connector.syncCards).toHaveBeenCalledWith(
      [{ question: 'Buffered', answer: 'Value' }],
      'note.md',
      'Q: Buffered\nA: Value',
      false,
      undefined,
      true,
      expect.objectContaining({ abort: expectedAbort })
    );
    expect(notices[notices.length - 1]).toBe('Sync completed: 1 succeeded, 0 skipped');
  });

  it('asks once before deleting notes found by the analysis', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn().mockResolvedValue({
        cardsToAdd: [],
        cardsToUpdate: [],
        cardsToDelete: [
          {
            card: { question: 'Old', answer: '' },
            deckName: 'note',
            existingCardId: '1',
          },
        ],
        cardsInConflict: [],
        totalCards: 1,
      }),
    });
    useConnector(harness.plugin, connector);
    harness.setActiveView(markdownView('note.md', 'Q: Q\nA: A'));

    await harness.plugin.syncCurrentNote();

    expect(openSyncModal).not.toHaveBeenCalled();
    expect(confirmOptions).toHaveLength(1);
    expect(confirmOptions[0].message).toContain('delete 1 cards');
    expect(connector.syncCards).toHaveBeenCalledWith(
      [{ question: 'Q', answer: 'A' }],
      'note.md',
      'Q: Q\nA: A',
      true,
      ['1'],
      true,
      expect.objectContaining({ abort: expectedAbort })
    );
  });

  it('does not start a second run while one is already in flight', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    let release!: (analysis: unknown) => void;
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      ),
    });
    useConnector(harness.plugin, connector);
    harness.setActiveView(markdownView('note.md', 'Q: Q\nA: A'));

    const first = harness.plugin.syncCurrentNote();
    await vi.waitFor(() => expect(connector.analyzeSyncOperation).toHaveBeenCalledTimes(1));
    await harness.plugin.syncCurrentNote();

    expect(notices).toContain('A sync for one of these notes is already running');
    expect(connector.analyzeSyncOperation).toHaveBeenCalledTimes(1);

    release({
      cardsToAdd: [],
      cardsToUpdate: [],
      cardsToDelete: [],
      cardsInConflict: [],
      totalCards: 1,
    });
    await first;
  });

  it('warns that externally edited cards are part of the delete set', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn().mockResolvedValue({
        cardsToAdd: [],
        cardsToUpdate: [],
        cardsInConflict: [],
        cardsToDelete: [
          {
            card: { question: 'Old', answer: '' },
            deckName: 'note',
            existingCardId: '1',
            externallyEdited: true,
          },
        ],
        totalCards: 1,
      }),
    });
    useConnector(harness.plugin, connector);
    harness.setActiveView(markdownView('note.md', 'Q: Q\nA: A'));

    await harness.plugin.syncCurrentNote();

    expect(confirmOptions).toHaveLength(1);
    expect(confirmOptions[0].message).toContain('1 of these cards were changed in Anki');
  });

  it('bails when a silent run for the note is already in flight', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn().mockResolvedValue({
        cardsToAdd: [],
        cardsToUpdate: [],
        cardsToDelete: [],
        cardsInConflict: [],
        totalCards: 1,
      }),
    });
    useConnector(harness.plugin, connector);
    harness.setActiveView(markdownView('note.md', 'Q: Q\nA: A'));
    (harness.plugin as unknown as { syncInFlight: Set<string> }).syncInFlight.add('note.md');

    await harness.plugin.syncCurrentNote();

    expect(notices).toContain('A sync for one of these notes is already running');
    expect(connector.analyzeSyncOperation).not.toHaveBeenCalled();
  });
});

describe('file menu sync entry', () => {
  it('adds one entry for the clicked Markdown file', async () => {
    const harness = await createHarness({ 'one.md': '', 'two.md': '' });
    const { entries, menu } = createMenu();

    harness.workspaceHandlers.get('file-menu')?.(menu, harness.file('one.md'));

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Sync note to Anki');
  });

  it('syncs one file directly without opening the dialog', async () => {
    const harness = await createHarness({ 'one.md': 'Q: Q\nA: A' });
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn().mockResolvedValue({
        cardsToAdd: [],
        cardsToUpdate: [],
        cardsToDelete: [],
        cardsInConflict: [],
        totalCards: 1,
      }),
    });
    useConnector(harness.plugin, connector);
    const { entries, menu } = createMenu();

    harness.workspaceHandlers.get('file-menu')?.(menu, harness.file('one.md'));
    entries[0].onClick?.();

    await vi.waitFor(() => expect(connector.syncCards).toHaveBeenCalledTimes(1));
    expect(connector.syncCards.mock.calls[0][1]).toBe('one.md');
    expect(openSyncModal).not.toHaveBeenCalled();
    expect(confirmOptions).toHaveLength(0);
  });

  it('syncs all selected Markdown files with a counted label', async () => {
    const harness = await createHarness({ 'one.md': 'Q: Q\nA: A', 'two.md': 'Q: Q2\nA: A2' });
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn().mockResolvedValue({
        cardsToAdd: [],
        cardsToUpdate: [],
        cardsToDelete: [],
        cardsInConflict: [],
        totalCards: 1,
      }),
    });
    useConnector(harness.plugin, connector);
    harness.selectFiles(harness.file('one.md'), harness.file('two.md'));
    const { entries, menu } = createMenu();

    harness.workspaceHandlers.get('file-menu')?.(menu, harness.file('two.md'));
    expect(entries[0].title).toBe('Sync 2 notes to Anki');
    entries[0].onClick?.();

    await vi.waitFor(() => expect(connector.syncCards).toHaveBeenCalledTimes(2));
    expect(connector.syncCards.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      'one.md',
      'two.md',
    ]);
    expect(openSyncModal).not.toHaveBeenCalled();
  });

  it('confirms aggregated deletions once before a multi-note sync', async () => {
    const harness = await createHarness({ 'one.md': 'Q: Q\nA: A', 'two.md': 'Q: Q2\nA: A2' });
    const connector = stubConnector({
      analyzeSyncOperation: vi.fn(async (_cards: unknown, notePath: string) => ({
        cardsToAdd: [],
        cardsToUpdate: [],
        cardsToDelete: [
          {
            card: { question: 'Old', answer: '' },
            deckName: 'x',
            existingCardId: notePath === 'one.md' ? '11' : '22',
          },
        ],
        cardsInConflict: [],
        totalCards: 1,
      })),
    });
    useConnector(harness.plugin, connector);
    harness.selectFiles(harness.file('one.md'), harness.file('two.md'));
    const { entries, menu } = createMenu();

    harness.workspaceHandlers.get('file-menu')?.(menu, harness.file('two.md'));
    entries[0].onClick?.();

    await vi.waitFor(() => expect(connector.syncCards).toHaveBeenCalledTimes(2));
    expect(openSyncModal).not.toHaveBeenCalled();
    expect(confirmOptions).toHaveLength(1);
    expect(confirmOptions[0].message).toContain('2 cards from 2 notes');
    expect(confirmOptions[0].items).toEqual(['one (1)', 'two (1)']);
    expect(connector.syncCards.mock.calls[0][3]).toBe(true);
    expect(connector.syncCards.mock.calls[0][4]).toEqual(['11']);
    expect(connector.syncCards.mock.calls[1][3]).toBe(true);
    expect(connector.syncCards.mock.calls[1][4]).toEqual(['22']);
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

    expect(connector.hasNotesForSourceTag).toHaveBeenCalledWith('note.md', 'Q: Q\nA: A');
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

  it('skips a card changed in Anki silently even when overwriting is enabled', async () => {
    const settings: PandaZapSettings = {
      ...DEFAULT_SETTINGS,
      useNoteBased: false,
      overwriteAnkiEdits: true,
    };
    const connector = new AnkiConnector(settings, {} as never);
    const sourceTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'note.md'
    );
    const anki = installFakeAnki(requestUrl, {
      notes: [
        {
          noteId: '1',
          front: 'Q1',
          back: 'Edited in Anki',
          tags: ['panda-zap', sourceTag, syncTagFor(connector, 'Q1', 'A1')],
          cards: [10],
        },
      ],
      cards: [{ cardId: 10, note: 1, deckName: 'Default' }],
    });
    const harness = await createHarness({ 'note.md': 'Q: Q1\nA: A1' });
    useConnector(harness.plugin, connector as unknown as ReturnType<typeof stubConnector>);
    useSettings(harness.plugin, {
      useNoteBased: false,
      overwriteAnkiEdits: true,
      syncOnSave: true,
    });
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(anki.requests.some((request) => request.action === 'updateNoteFields')).toBe(false);
    expect(anki.notes[0].back).toBe('Edited in Anki');
    expect(statusBarState.text).toBe('Panda Zap: 1 changed in Anki');
    expect(statusBarState.attributes.title).toContain('changed in Anki');
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

  it('pauses while media cleanup is active', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector();
    useConnector(harness.plugin, connector);
    useSettings(harness.plugin, { syncOnSave: true });
    (harness.plugin as unknown as { mediaCleanupActive: boolean }).mediaCleanupActive = true;
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(connector.hasNotesForSourceTag).not.toHaveBeenCalled();
    expect(connector.syncCards).not.toHaveBeenCalled();
    expect(statusBarState.text).toBe('Panda Zap: paused');
  });

  it('clears debounce timers on unload', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector();
    useConnector(harness.plugin, connector);
    useSettings(harness.plugin, { syncOnSave: true });
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    harness.plugin.onunload();
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);

    expect(connector.hasNotesForSourceTag).not.toHaveBeenCalled();
    expect(
      (harness.plugin as unknown as { silentSyncTimers: Map<string, number> }).silentSyncTimers.size
    ).toBe(0);
  });

  it('stops a silent run that is waiting on the Anki probe when unloaded', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const probe = deferred<boolean>();
    const connector = stubConnector({
      hasNotesForSourceTag: vi.fn(() => probe.promise),
    });
    useConnector(harness.plugin, connector);
    useSettings(harness.plugin, { syncOnSave: true });
    vi.useFakeTimers();

    harness.vaultHandlers.get('modify')?.(harness.file('note.md'));
    await vi.advanceTimersByTimeAsync(SYNC_ON_SAVE_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(connector.hasNotesForSourceTag).toHaveBeenCalled();

    harness.plugin.onunload();
    probe.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(connector.syncCards).not.toHaveBeenCalled();
    expect(statusBarState.text).toBe('');
  });

  it('clears the error state when sync on save is turned off', async () => {
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
    expect(statusBarState.text).toBe('Panda Zap: sync failed - note');

    useSettings(harness.plugin, { syncOnSave: false });
    await harness.plugin.saveSettings();

    expect(statusBarState.text).toBe('');
  });

  it('clears the error state when the failing note is deleted', async () => {
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
    expect(statusBarState.text).toBe('Panda Zap: sync failed - note');

    harness.vaultHandlers.get('delete')?.(harness.file('note.md'));

    expect(statusBarState.text).toBe('Panda Zap: idle');
  });

  it('refuses media cleanup while a sync is in flight', async () => {
    const harness = await createHarness();
    const mediaProbe = vi.fn();
    const connector = stubConnector({
      getPluginMediaFiles: mediaProbe,
      getReferencedMediaFiles: vi.fn(),
    });
    useConnector(harness.plugin, connector);
    (harness.plugin as unknown as { syncInFlight: Set<string> }).syncInFlight.add('note.md');

    await harness.plugin.cleanUpOrphanedMedia();

    expect(notices).toContain('Wait for the running sync to finish before cleaning up media');
    expect(mediaProbe).not.toHaveBeenCalled();
  });

  it('invalidates the per-path card cache after a manual sync', async () => {
    const harness = await createHarness({ 'note.md': 'Q: Q\nA: A' });
    const connector = stubConnector();
    useConnector(harness.plugin, connector);
    const cache = (harness.plugin as unknown as { noteHasCardsCache: Map<string, boolean> })
      .noteHasCardsCache;
    cache.set('note.md', false);

    await harness.plugin.syncCardsToAnki(
      false,
      createSyncContext([{ question: 'Q', answer: 'A' }], 'note.md', 'Q: Q\nA: A')
    );

    expect(cache.has('note.md')).toBe(false);
  });

  it('accepts notes carrying only the trusted legacy source tag', async () => {
    const settings: PandaZapSettings = { ...DEFAULT_SETTINGS, useNoteBased: true };
    const connector = new AnkiConnector(settings, {} as never);
    const legacyTag = (
      connector as unknown as { getLegacySourceTag(path: string): string }
    ).getLegacySourceTag('note.md');
    installFakeAnki(requestUrl, {
      notes: [
        {
          noteId: '1',
          front: 'Q',
          back: 'A',
          tags: ['panda-zap', legacyTag],
          cards: [10],
        },
      ],
      cards: [{ cardId: 10, note: 1, deckName: 'note' }],
    });

    await expect(connector.hasNotesForSourceTag('note.md', 'Q: Q\nA: A')).resolves.toBe(true);
  });
});
