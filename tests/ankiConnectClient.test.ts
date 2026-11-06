import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

import {
  AnkiConnectClient,
  AnkiConnectError,
  isNetworkError,
  isTimeoutError,
  type AnkiConnectTransportRequest,
  type AnkiConnectTransportResponse,
} from '../src/sync/AnkiConnectClient';

const ENDPOINT = 'http://127.0.0.1:8765/';
const BACKOFF_BASE_MS = 100;

interface Harness {
  client: AnkiConnectClient;
  request: ReturnType<typeof vi.fn>;
  delay: ReturnType<typeof vi.fn>;
  delays: number[];
}

function harness(overrides: { timeoutMs?: number } = {}): Harness {
  const delays: number[] = [];
  const request =
    vi.fn<(request: AnkiConnectTransportRequest) => Promise<AnkiConnectTransportResponse>>();
  const delay = vi.fn(async (ms: number) => {
    delays.push(ms);
  });
  const client = new AnkiConnectClient(ENDPOINT, {
    request,
    delay,
    random: () => 0.5,
    timeoutMs: overrides.timeoutMs ?? 1000,
    maxRetries: 2,
    backoffBaseMs: BACKOFF_BASE_MS,
  });
  return { client, request, delay, delays };
}

function response(result: unknown, error: string | null = null, status = 200) {
  return { status, json: { result, error } };
}

function never() {
  return new Promise<never>(() => {});
}

async function rejection(promise: Promise<unknown>): Promise<AnkiConnectError> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AnkiConnectError);
    return error as AnkiConnectError;
  }
  throw new Error('expected the request to reject');
}

describe('AnkiConnectClient', () => {
  it('retries an idempotent action with exponential backoff and jitter', async () => {
    const { client, request, delays } = harness();
    request
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response([1]));

    const result = await client.request('findNotes', { query: 'deck:"Default"' });

    expect(result).toEqual([1]);
    expect(request).toHaveBeenCalledTimes(3);
    // 100 + 0.5 * 15, then 200 + 0.5 * 15: no real waiting.
    expect(delays).toEqual([107.5, 207.5]);
  });

  it('gives up after the retry budget', async () => {
    const { client, request, delays } = harness();
    request.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await rejection(client.request('findNotes'));

    expect(error.kind).toBe('network');
    expect(request).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([107.5, 207.5]);
  });

  it.each(['addNote', 'storeMediaFile'])('does not retry %s', async (action) => {
    const { client, request, delay } = harness();
    request.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await rejection(client.request(action));

    expect(error.kind).toBe('network');
    expect(request).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('reports an HTTP status as a typed error and does not retry it', async () => {
    const { client, request, delay } = harness();
    request.mockResolvedValue(response(null, null, 500));

    const error = await rejection(client.request('findNotes'));

    expect(error.kind).toBe('http');
    expect(error.status).toBe(500);
    expect(error.action).toBe('findNotes');
    expect(error.message).toContain('HTTP 500');
    expect(request).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('rejects a malformed envelope as a protocol error', async () => {
    const { client, request } = harness();
    request.mockResolvedValue({ status: 200, json: { value: 6 } });

    const error = await rejection(client.request('version'));

    expect(error.kind).toBe('protocol');
    expect(error.message).toBe('Invalid response from Anki Connect');
  });

  it('rejects a non-string remote error as a protocol error', async () => {
    const { client, request } = harness();
    request.mockResolvedValue({ status: 200, json: { result: null, error: 42 } });

    const error = await rejection(client.request('findNotes'));

    expect(error.kind).toBe('protocol');
  });

  it('reports a remote error with AnkiConnect text', async () => {
    const { client, request } = harness();
    request.mockResolvedValue(response(null, 'cannot create note because it is a duplicate'));

    const error = await rejection(client.request('addNote'));

    expect(error.kind).toBe('remote');
    expect(error.message).toBe('cannot create note because it is a duplicate');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('wraps a network failure with its kind and cause', async () => {
    const { client, request } = harness();
    const cause = new TypeError('Failed to fetch');
    request.mockRejectedValue(cause);

    const error = await rejection(client.request('addNote'));

    expect(error.kind).toBe('network');
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('Failed to fetch');
    expect(isNetworkError(error)).toBe(true);
    expect(isTimeoutError(error)).toBe(false);
  });

  it('does not retry an unexpected transport failure and keeps its message', async () => {
    const { client, request, delay } = harness();
    request.mockRejectedValue(new Error('boom'));

    const error = await rejection(client.request('findNotes'));

    expect(error.kind).toBe('protocol');
    expect(error.message).toBe('boom');
    expect(request).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('reports a timeout as a typed error', async () => {
    const { client, request } = harness({ timeoutMs: 20 });
    request.mockReturnValue(never());

    const error = await rejection(client.request('addNote'));

    expect(error.kind).toBe('timeout');
    expect(isTimeoutError(error)).toBe(true);
    expect(error.message).toContain('timed out after 20 ms');
  });

  it('turns a parser failure into a protocol error without retrying', async () => {
    const { client, request, delays } = harness();
    request.mockResolvedValue(response('6'));

    const error = await rejection(
      client.request('version', undefined, {
        parse: (result) => {
          if (typeof result !== 'number') throw new Error('invalid version');
          return result;
        },
      })
    );

    expect(error.kind).toBe('protocol');
    expect(error.message).toBe('invalid version');
    expect(request).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('returns the parsed result for a matching parse callback', async () => {
    const { client, request } = harness();
    request.mockResolvedValue(response(['a', 'b']));

    const names = await client.request('deckNames', undefined, {
      parse: (result) => {
        if (!Array.isArray(result)) throw new Error('invalid names');
        return result.map(String);
      },
    });

    expect(names).toEqual(['a', 'b']);
  });
});
