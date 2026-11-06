import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrl, notices, confirm, confirmOptions } = vi.hoisted(() => ({
  requestUrl: vi.fn(),
  notices: [] as string[],
  confirm: vi.fn(),
  confirmOptions: [] as Array<{ title: string; message: string; items?: readonly string[] }>,
}));

vi.mock('obsidian', () => ({
  Plugin: class {},
  MarkdownView: class {},
  TFile: class {},
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
    constructor(_app: unknown, options: { title: string; message: string; items?: string[] }) {
      confirmOptions.push(options);
    }
    confirm(): Promise<boolean> {
      return confirm();
    }
  },
}));

import PandaZapPlugin from '../src/main';
import { AnkiConnector } from '../src/sync/AnkiConnector';
import { DEFAULT_SETTINGS, type PandaZapSettings } from '../src/sync/types';
import { installFakeAnki, type FakeAnkiState } from './fakeAnki';

function createConnector(): AnkiConnector {
  return new AnkiConnector({ ...DEFAULT_SETTINGS } as PandaZapSettings, {} as never);
}

function createPlugin(connector: AnkiConnector): PandaZapPlugin {
  const plugin = Object.create(PandaZapPlugin.prototype) as PandaZapPlugin;
  const internals = plugin as unknown as {
    settings: PandaZapSettings;
    ankiConnector: AnkiConnector;
    app: unknown;
  };
  internals.settings = { ...DEFAULT_SETTINGS };
  internals.ankiConnector = connector;
  internals.app = {};
  return plugin;
}

function addNote(state: FakeAnkiState, noteId: string, fields: Record<string, string>): void {
  const values = Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [name, { value }])
  );
  state.notes.push({
    noteId,
    front: fields.Front ?? '',
    back: fields.Back ?? '',
    tags: ['panda-zap'],
    cards: [],
    fields: values,
  });
}

function deleteRequests(state: FakeAnkiState) {
  return state.requests.filter((request) => request.action === 'deleteMediaFile');
}

let anki: FakeAnkiState;

beforeEach(() => {
  notices.length = 0;
  confirmOptions.length = 0;
  confirm.mockReset();
  confirm.mockResolvedValue(true);
  requestUrl.mockReset();
  anki = installFakeAnki(requestUrl);
});

describe('referenced media extraction', () => {
  it('collects local image filenames from every field and ignores remote sources', async () => {
    addNote(anki, '1', {
      Front: 'A question',
      Back: '<img src="pandazap_one.png"><br><img src=\'pandazap_two.png\'>',
      Extra:
        '<img src="pandazap_one.png"><img src="https://cdn.example.com/photo.png"><img src="data:image/png;base64,AAAA">',
    });

    const referenced = await createConnector().getReferencedMediaFiles();

    expect(referenced.has('pandazap_one.png')).toBe(true);
    expect(referenced.has('pandazap_two.png')).toBe(true);
    expect(referenced.has('photo.png')).toBe(false);
  });

  it('counts a plugin filename mentioned anywhere in an unparsable field', async () => {
    addNote(anki, '1', {
      Front: 'Q',
      Back: 'broken markup <img src=pandazap_loose.png',
    });

    const referenced = await createConnector().getReferencedMediaFiles();

    expect(referenced.has('pandazap_loose.png')).toBe(true);
  });

  it('returns nothing when no plugin-tagged note exists', async () => {
    const referenced = await createConnector().getReferencedMediaFiles();

    expect(referenced.size).toBe(0);
    expect(anki.requests.map((request) => request.action)).toEqual(['findNotes']);
  });
});

describe('orphaned media cleanup', () => {
  it('deletes only the media no note references', async () => {
    addNote(anki, '1', {
      Back: '<img src="pandazap_kept.png"><img src="pandazap_also_kept.png">',
    });
    anki.media = ['pandazap_kept.png', 'pandazap_also_kept.png', 'pandazap_old.png'];
    const plugin = createPlugin(createConnector());

    await plugin.cleanUpOrphanedMedia();

    expect(deleteRequests(anki)).toHaveLength(1);
    expect(deleteRequests(anki)[0].params).toEqual({ filename: 'pandazap_old.png' });
    expect(anki.media).toEqual(['pandazap_kept.png', 'pandazap_also_kept.png']);
    expect(notices).toContain('Deleted 1 orphaned Panda Zap media file');
    expect(confirmOptions[0].message).toContain('Delete 1 Panda Zap media file');
    expect(confirmOptions[0].items).toEqual(['pandazap_old.png']);
  });

  it('deletes nothing when the user cancels', async () => {
    anki.media = ['pandazap_old.png'];
    confirm.mockResolvedValue(false);
    const plugin = createPlugin(createConnector());

    await plugin.cleanUpOrphanedMedia();

    expect(deleteRequests(anki)).toEqual([]);
    expect(anki.media).toEqual(['pandazap_old.png']);
  });

  it('aborts without deleting when the media listing fails', async () => {
    anki.media = ['pandazap_old.png'];
    anki.failActions.add('getMediaFilesNames');
    const plugin = createPlugin(createConnector());

    await plugin.cleanUpOrphanedMedia();

    expect(deleteRequests(anki)).toEqual([]);
    expect(anki.media).toEqual(['pandazap_old.png']);
    expect(confirm).not.toHaveBeenCalled();
    expect(notices).toContain('Could not read Anki media: getMediaFilesNames failed');
  });

  it('aborts without deleting when the referenced listing fails', async () => {
    anki.media = ['pandazap_old.png'];
    anki.failActions.add('findNotes');
    const plugin = createPlugin(createConnector());

    await plugin.cleanUpOrphanedMedia();

    expect(deleteRequests(anki)).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
    expect(notices).toContain('Could not read Anki media: findNotes failed');
  });

  it('reports that there is nothing to do and deletes nothing on a second run', async () => {
    anki.media = ['pandazap_old.png'];
    const plugin = createPlugin(createConnector());

    await plugin.cleanUpOrphanedMedia();
    await plugin.cleanUpOrphanedMedia();

    expect(deleteRequests(anki)).toHaveLength(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(notices).toContain('No orphaned Panda Zap media to delete');
  });

  it('shows a notice without a dialog when the plugin has no media', async () => {
    const plugin = createPlugin(createConnector());

    await plugin.cleanUpOrphanedMedia();

    expect(confirm).not.toHaveBeenCalled();
    expect(notices).toContain('No orphaned Panda Zap media to delete');
  });
});
