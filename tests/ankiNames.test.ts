import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({
  App: class {},
  TFile: class {},
  requestUrl,
}));

import { AnkiConnector } from '../src/sync/AnkiConnector';
import { DEFAULT_SETTINGS } from '../src/sync/types';
import { RETRY_BACKOFF_BASE_MS } from '../src/constants';
import { installFakeAnki } from './fakeAnki';

const settings = { ...DEFAULT_SETTINGS };
const app = {} as ConstructorParameters<typeof AnkiConnector>[1];

function response(result: unknown) {
  return { status: 200, json: { result, error: null } };
}

describe('AnkiConnector name lists', () => {
  beforeEach(() => {
    requestUrl.mockReset();
    vi.unstubAllGlobals();
  });

  it('lists deck and note type names from Anki', async () => {
    const fake = installFakeAnki(requestUrl, {
      decks: ['Default', 'Spanish::Vocab'],
      models: ['Basic', 'Cloze'],
    });
    const connector = new AnkiConnector(settings, app);

    await expect(connector.listDeckNames()).resolves.toEqual(['Default', 'Spanish::Vocab']);
    await expect(connector.listModelNames()).resolves.toEqual(['Basic', 'Cloze']);
    expect(fake.requests.map((request) => request.action)).toEqual(['deckNames', 'modelNames']);
  });

  it('rejects a name list that is not an array of strings', async () => {
    requestUrl.mockResolvedValue(response(['Deck', 7]));
    const connector = new AnkiConnector(settings, app);

    await expect(connector.listDeckNames()).rejects.toThrow('Anki returned invalid deck names');
  });

  it('rejects a note type list that is not an array', async () => {
    requestUrl.mockResolvedValue(response('Basic'));
    const connector = new AnkiConnector(settings, app);

    await expect(connector.listModelNames()).rejects.toThrow(
      'Anki returned invalid note type names'
    );
  });

  it('retries a name read after a network error', async () => {
    vi.useFakeTimers();
    try {
      requestUrl
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(response(['Default']));
      const names = new AnkiConnector(settings, app).listDeckNames();

      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_BASE_MS * 2);

      await expect(names).resolves.toEqual(['Default']);
      expect(requestUrl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
