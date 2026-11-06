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

function connectorStub() {
  return {
    updateSettings: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ status: 'ok', version: 6 }),
    syncCards: vi.fn().mockResolvedValue({ cards: [] }),
    invalidateCache: vi.fn(),
  };
}

function createPlugin(connector: ReturnType<typeof connectorStub>): PandaZapPlugin {
  const plugin = Object.create(PandaZapPlugin.prototype) as PandaZapPlugin;
  const internals = plugin as unknown as {
    settings: PandaZapSettings;
    ankiConnector: ReturnType<typeof connectorStub>;
  };
  internals.settings = DEFAULT_SETTINGS;
  internals.ankiConnector = connector;
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
