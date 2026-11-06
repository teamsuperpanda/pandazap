import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  Plugin: class {},
  MarkdownView: class {},
  TFile: class {},
  Notice: class {},
}));
vi.mock('../src/dialogs/SyncModal', () => ({ SyncModal: class {} }));
vi.mock('../src/dialogs/SettingsTab', () => ({ PandaZapSettingTab: class {} }));

import PandaZapPlugin from '../src/main';
import {
  DEFAULT_SETTINGS,
  createBatchSyncContext,
  createSyncContext,
  type PandaZapSettings,
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
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => unknown;
        read: (file: TFile) => Promise<string>;
      };
    };
  };
  internals.settings = DEFAULT_SETTINGS;
  internals.ankiConnector = connector;
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
        ['one.md', createSyncContext([{ question: 'Q', answer: 'A', line: 1 }], 'one.md')],
        ['two.md', createSyncContext([{ question: 'Q', answer: 'A', line: 1 }], 'two.md')],
        ['three.md', createSyncContext([{ question: 'Q', answer: 'A', line: 1 }], 'three.md')],
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
      new Map([['one.md', createSyncContext([{ question: 'Q', answer: 'A', line: 1 }], 'one.md')]])
    );

    await expect(plugin.syncBatchCards(bContext)).rejects.toThrow('batch failed');
    expect(connector.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates once after a single-note sync', async () => {
    const connector = connectorStub();
    const plugin = createPlugin(connector);

    await plugin.syncCardsToAnki(
      false,
      false,
      createSyncContext([{ question: 'Q', answer: 'A', line: 1 }], 'mine.md')
    );

    expect(connector.syncCards).toHaveBeenCalledTimes(1);
    expect(connector.invalidateCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates after a single-note sync that throws', async () => {
    const connector = connectorStub();
    connector.syncCards.mockRejectedValueOnce(new Error('sync failed'));
    const plugin = createPlugin(connector);

    await expect(
      plugin.syncCardsToAnki(
        false,
        false,
        createSyncContext([{ question: 'Q', answer: 'A', line: 1 }], 'mine.md')
      )
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

    await plugin.syncBatchCards(bContext, false, true, new Map([['one.md', ['11']]]));

    expect(connector.syncCards).toHaveBeenCalledWith([], false, 'one.md', '', true, ['11'], true);
    expect(connector.invalidateCache).toHaveBeenCalledTimes(1);
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
