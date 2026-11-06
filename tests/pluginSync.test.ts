import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrl, notices, openSyncModal } = vi.hoisted(() => ({
  requestUrl: vi.fn(),
  notices: [] as string[],
  openSyncModal: vi.fn(),
}));

vi.mock('obsidian', () => ({
  Plugin: class {},
  MarkdownView: class {},
  TFile: class {},
  Modal: class {},
  setIcon: () => undefined,
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

import PandaZapPlugin from '../src/main';
import { SyncModal } from '../src/dialogs/SyncModal';
import { AnkiConnector } from '../src/sync/AnkiConnector';
import {
  DEFAULT_SETTINGS,
  createBatchSyncContext,
  createSyncContext,
  type PandaZapSettings,
  type SyncRunOptions,
} from '../src/sync/types';
import { TFile } from 'obsidian';

function connectorStub() {
  return {
    updateSettings: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ status: 'ok', version: 6 }),
    syncCards: vi.fn().mockResolvedValue({ cards: [] }),
    invalidateCache: vi.fn(),
  };
}

function createPlugin(
  connector: ReturnType<typeof connectorStub>,
  notes: Record<string, string> = {}
): PandaZapPlugin {
  const plugin = Object.create(PandaZapPlugin.prototype) as PandaZapPlugin;
  const files = new Map(
    Object.entries(notes).map(([path, content]) => [path, { content, file: new TFile() }])
  );
  const internals = plugin as unknown as {
    settings: PandaZapSettings;
    ankiConnector: ReturnType<typeof connectorStub>;
    tagMigrationQueue: Promise<void>;
    noteHasCardsCache: Map<string, boolean>;
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => unknown;
        read: (file: TFile) => Promise<string>;
      };
    };
  };
  internals.settings = DEFAULT_SETTINGS;
  internals.ankiConnector = connector;
  internals.tagMigrationQueue = Promise.resolve();
  internals.noteHasCardsCache = new Map();
  internals.app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path)?.file ?? null,
      read: async (file: TFile) => {
        for (const entry of files.values()) {
          if (entry.file === file) return entry.content;
        }
        return '';
      },
    },
  };
  return plugin;
}

describe('plugin sync cache invalidation', () => {
  it('invalidates once after a batch sync, not once per note', async () => {
    const connector = connectorStub();
    const plugin = createPlugin(connector);
    const bContext = createBatchSyncContext(
      new Map([
        ['one.md', createSyncContext([{ question: 'Q', answer: 'A' }], 'one.md')],
        ['two.md', createSyncContext([{ question: 'Q', answer: 'A' }], 'two.md')],
        ['three.md', createSyncContext([{ question: 'Q', answer: 'A' }], 'three.md')],
      ])
    );

    await plugin.syncBatchCards(bContext);

    expect(connector.syncCards).toHaveBeenCalledTimes(3);
    expect(connector.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates after a batch sync that throws', async () => {
    const connector = connectorStub();
    connector.syncCards.mockRejectedValueOnce(new Error('batch failed'));
    const plugin = createPlugin(connector);
    const bContext = createBatchSyncContext(
      new Map([['one.md', createSyncContext([{ question: 'Q', answer: 'A' }], 'one.md')]])
    );

    await expect(plugin.syncBatchCards(bContext)).rejects.toThrow('batch failed');
    expect(connector.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates once after a single-note sync', async () => {
    const connector = connectorStub();
    const plugin = createPlugin(connector);

    await plugin.syncCardsToAnki(
      false,
      createSyncContext([{ question: 'Q', answer: 'A' }], 'mine.md')
    );

    expect(connector.syncCards).toHaveBeenCalledTimes(1);
    expect(connector.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates after a single-note sync that throws', async () => {
    const connector = connectorStub();
    connector.syncCards.mockRejectedValueOnce(new Error('sync failed'));
    const plugin = createPlugin(connector);

    await expect(
      plugin.syncCardsToAnki(false, createSyncContext([{ question: 'Q', answer: 'A' }], 'mine.md'))
    ).rejects.toThrow('sync failed');
    expect(connector.invalidateCache).toHaveBeenCalledTimes(1);
  });
});

describe('batch sync of an emptied note', () => {
  it('sends the empty card list and its confirmed deletion IDs to the connector', async () => {
    const connector = connectorStub();
    const plugin = createPlugin(connector);
    const bContext = createBatchSyncContext(
      new Map([['one.md', createSyncContext([], 'one.md', '')]])
    );

    await plugin.syncBatchCards(bContext, true, new Map([['one.md', ['11']]]));

    expect(connector.syncCards).toHaveBeenCalledWith(
      [],
      'one.md',
      '',
      true,
      ['11'],
      true,
      undefined
    );
    expect(connector.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('sends an empty confirmed ID list for a note that has no confirmed deletions', async () => {
    const connector = connectorStub();
    const plugin = createPlugin(connector);
    const bContext = createBatchSyncContext(
      new Map([
        ['one.md', createSyncContext([], 'one.md', '')],
        ['two.md', createSyncContext([], 'two.md', '')],
      ])
    );

    await plugin.syncBatchCards(bContext, true, new Map([['two.md', ['22']]]));

    expect(connector.syncCards).toHaveBeenNthCalledWith(
      1,
      [],
      'one.md',
      '',
      true,
      [],
      true,
      undefined
    );
    expect(connector.syncCards).toHaveBeenNthCalledWith(
      2,
      [],
      'two.md',
      '',
      true,
      ['22'],
      true,
      undefined
    );
  });

  it('does not delete notes that were not confirmed in the batch', async () => {
    requestUrl.mockReset();
    const connector = new AnkiConnector({ ...DEFAULT_SETTINGS, useNoteBased: false }, {} as never);
    const sourceTag = (connector as unknown as { getSourceTag(path: string): string }).getSourceTag(
      'one.md'
    );
    requestUrl.mockImplementation(async (options: { body: string }) => {
      const request = JSON.parse(options.body) as { action: string };
      if (request.action === 'version') return { status: 200, json: { result: 6, error: null } };
      // Anything else would mean the connector re-analysed an unconfirmed note.
      if (request.action === 'findNotes')
        return { status: 200, json: { result: ['11'], error: null } };
      if (request.action === 'notesInfo') {
        return {
          status: 200,
          json: {
            result: [
              {
                noteId: '11',
                fields: { Front: { value: 'Stale' }, Back: { value: 'answer' } },
                tags: [sourceTag],
              },
            ],
            error: null,
          },
        };
      }
      if (request.action === 'deleteNotes') {
        return { status: 200, json: { result: null, error: null } };
      }
      throw new Error(`Unexpected action: ${request.action}`);
    });
    const plugin = createPlugin(connectorStub());
    (plugin as unknown as { ankiConnector: AnkiConnector }).ankiConnector = connector;
    const bContext = createBatchSyncContext(
      new Map([['one.md', createSyncContext([], 'one.md', '')]])
    );

    // The map only confirms deletions for another note.
    await plugin.syncBatchCards(bContext, true, new Map([['other.md', ['99']]]));

    const actions = requestUrl.mock.calls.map(
      (call) => (JSON.parse((call[0] as { body: string }).body) as { action: string }).action
    );
    expect(actions).toEqual(['version']);
    expect(actions).not.toContain('deleteNotes');
  });
});

describe('batch capture of empty notes', () => {
  const notes = { 'empty.md': '# Nothing to sync', 'cards.md': 'Q: Q\nA: A' };

  it('keeps a selected note that has no cards so it can clean up', async () => {
    const plugin = createPlugin(connectorStub(), notes);

    const bContext = await plugin.captureBatchSyncContext(['empty.md', 'cards.md']);

    expect([...bContext.contexts.keys()]).toEqual(['empty.md', 'cards.md']);
    expect(bContext.contexts.get('empty.md')?.cards).toEqual([]);
    expect(bContext.totalCards).toBe(1);
  });

  it('skips a note with no cards for sync-all', async () => {
    const plugin = createPlugin(connectorStub(), notes);

    const bContext = await plugin.captureBatchSyncContext(['empty.md', 'cards.md'], false);

    expect([...bContext.contexts.keys()]).toEqual(['cards.md']);
    expect(bContext.totalCards).toBe(1);
  });
});

describe('sync dialog single instance', () => {
  beforeEach(() => {
    notices.length = 0;
    openSyncModal.mockReset();
  });

  it('reuses the open dialog instead of opening a second one', () => {
    const plugin = createPlugin(connectorStub());
    const open = vi.fn();
    plugin.showSyncModal({ open } as unknown as SyncModal);

    plugin.openSyncDialog();

    expect(open).toHaveBeenCalledTimes(1);
    expect(openSyncModal).not.toHaveBeenCalled();
    expect(notices).toContain(
      'A sync dialog is already open. Cancel the running sync or close the dialog.'
    );
  });

  it('does not keep a modal that failed to open', () => {
    const plugin = createPlugin(connectorStub());
    const broken = {
      open: () => {
        throw new Error('open failed');
      },
    } as unknown as SyncModal;

    expect(() => plugin.showSyncModal(broken)).toThrow('open failed');

    plugin.openSyncDialog();
    expect(openSyncModal).toHaveBeenCalledTimes(1);
  });

  it('opens a new dialog after the active modal closed', () => {
    const plugin = createPlugin(connectorStub());
    const closed = { open: vi.fn() } as unknown as SyncModal;
    plugin.showSyncModal(closed);
    plugin.clearActiveSyncModal(closed);

    plugin.openSyncDialog();

    expect(openSyncModal).toHaveBeenCalledTimes(1);
  });

  it('keeps the active modal when a different modal is cleared', () => {
    const plugin = createPlugin(connectorStub());
    const active = { open: vi.fn() } as unknown as SyncModal;
    plugin.showSyncModal(active);

    plugin.clearActiveSyncModal({ open: vi.fn() } as unknown as SyncModal);
    plugin.openSyncDialog();

    expect(openSyncModal).not.toHaveBeenCalled();
  });
});

describe('batch sync progress and cancellation', () => {
  function threeNotes() {
    return createBatchSyncContext(
      new Map(
        ['one.md', 'two.md', 'three.md'].map((path) => [
          path,
          createSyncContext([{ question: 'Q', answer: 'A' }], path),
        ])
      )
    );
  }

  it('reports progress across the whole batch', async () => {
    const connector = connectorStub();
    connector.syncCards.mockImplementation(async (...args: unknown[]) => {
      const runOptions = args[6] as SyncRunOptions | undefined;
      runOptions?.onProgress?.(1, 1);
      return { cards: [] };
    });
    const plugin = createPlugin(connector);
    const progress: Array<[number, number]> = [];

    await plugin.syncBatchCards(threeNotes(), false, undefined, {
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('stops before the next note when cancelled', async () => {
    const connector = connectorStub();
    connector.syncCards.mockImplementation(async (...args: unknown[]) => {
      const runOptions = args[6] as SyncRunOptions | undefined;
      if (runOptions?.abort) runOptions.abort.cancelled = true;
      return { cards: [] };
    });
    const plugin = createPlugin(connector);

    await plugin.syncBatchCards(threeNotes(), false, undefined, {
      abort: { cancelled: false },
    });

    expect(connector.syncCards).toHaveBeenCalledTimes(1);
    expect(connector.invalidateCache).toHaveBeenCalledTimes(1);
  });
});
