import { describe, expect, it, vi } from 'vitest';

const { saveData, loadData } = vi.hoisted(() => ({ saveData: vi.fn(), loadData: vi.fn() }));

vi.mock('obsidian', () => ({
  MarkdownView: class {},
  Plugin: class {
    saveData = saveData;
    loadData = loadData;
  },
}));

vi.mock('../src/dialogs/SyncModal', () => ({ SyncModal: class {} }));
vi.mock('../src/dialogs/SettingsTab', () => ({ PandaZapSettingTab: class {} }));
vi.mock('../src/sync/AnkiConnector', () => ({ AnkiConnector: class {} }));
vi.mock('../src/sync/CardExtractor', () => ({ CardExtractor: class {} }));

import PandaZapPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/sync/types';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createPlugin(): PandaZapPlugin {
  const plugin = new PandaZapPlugin({} as never, {} as never);
  plugin.settings = { ...DEFAULT_SETTINGS };
  return plugin;
}

describe('settings persistence', () => {
  it('normalizes corrupt stored data on load', async () => {
    loadData.mockReset();
    loadData.mockResolvedValue({
      ankiConnectPort: '9000',
      questionWord: '  ',
      noteType: null,
      unknownKey: 'ignored',
    });
    const plugin = new PandaZapPlugin({} as never, {} as never);

    await plugin.loadSettings();

    expect(plugin.settings).toEqual({
      ...DEFAULT_SETTINGS,
      ankiConnectPort: 9000,
    });
  });

  it('normalizes settings in memory and on disk before writing', async () => {
    saveData.mockReset();
    saveData.mockResolvedValue(undefined);
    const plugin = createPlugin();
    plugin.settings.ankiConnectPort = 70000;
    plugin.settings.questionWord = 'Q:';

    await plugin.saveSettings();

    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    expect(saveData).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('serializes point-in-time snapshots so the newest edit is saved last', async () => {
    const firstWrite = deferred();
    saveData.mockReset();
    saveData.mockImplementationOnce(() => firstWrite.promise).mockResolvedValueOnce(undefined);
    const plugin = createPlugin();

    plugin.settings.questionWord = 'First';
    const firstSave = plugin.saveSettings();
    plugin.settings.questionWord = 'Second';
    const secondSave = plugin.saveSettings();

    await Promise.resolve();
    expect(saveData).toHaveBeenCalledTimes(1);
    expect(saveData).toHaveBeenNthCalledWith(1, {
      ...DEFAULT_SETTINGS,
      questionWord: 'First',
    });

    firstWrite.resolve();
    await Promise.all([firstSave, secondSave]);
    expect(saveData).toHaveBeenNthCalledWith(2, {
      ...DEFAULT_SETTINGS,
      questionWord: 'Second',
    });
  });

  it('continues with the next queued save after a write fails', async () => {
    const error = new Error('disk unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    saveData.mockReset();
    saveData.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const plugin = createPlugin();

    const firstSave = plugin.saveSettings();
    plugin.settings.answerWord = 'Answer';
    const secondSave = plugin.saveSettings();

    await expect(firstSave).rejects.toBe(error);
    await expect(secondSave).resolves.toBeUndefined();
    expect(saveData).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith('Failed to save Panda Zap settings', error);
    consoleError.mockRestore();
  });
});
