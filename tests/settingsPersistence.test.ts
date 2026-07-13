import { describe, expect, it, vi } from 'vitest';

const { saveData } = vi.hoisted(() => ({ saveData: vi.fn() }));

vi.mock('obsidian', () => ({
  MarkdownView: class {},
  Plugin: class {
    saveData = saveData;
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
