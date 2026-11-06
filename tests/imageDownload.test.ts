import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock('obsidian', () => ({ requestUrl }));

import { downloadImageToBase64 } from '../src/sync/imageUtils';

const MAX_SIZE = 10 * 1024 * 1024;

function imageResponse(body: string, headers: Record<string, string> = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    status: 200,
    headers,
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe('downloadImageToBase64', () => {
  beforeEach(() => {
    requestUrl.mockReset();
  });

  it('returns base64 for an allowed http(s) image', async () => {
    requestUrl.mockResolvedValue(imageResponse('panda'));

    await expect(downloadImageToBase64('https://example.com/panda.png')).resolves.toBe('cGFuZGE=');
    expect(requestUrl).toHaveBeenCalledWith({
      url: 'https://example.com/panda.png',
      method: 'GET',
      throw: false,
    });
  });

  it('rejects a disallowed scheme before making any request', async () => {
    await expect(downloadImageToBase64('file:///etc/passwd')).rejects.toThrow(
      'Blocked download from disallowed scheme: file:'
    );
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it('rejects an HTTP error status', async () => {
    requestUrl.mockResolvedValue({ ...imageResponse('missing'), status: 404 });

    await expect(downloadImageToBase64('https://example.com/missing.png')).rejects.toThrow(
      'Download failed with status 404'
    );
  });

  it('rejects an image whose content-length exceeds the limit', async () => {
    requestUrl.mockResolvedValue(imageResponse('tiny', { 'content-length': String(MAX_SIZE + 1) }));

    await expect(downloadImageToBase64('https://example.com/huge.png')).rejects.toThrow(
      `Image too large (${MAX_SIZE + 1} bytes, max ${MAX_SIZE})`
    );
  });

  it('rejects an image whose body exceeds the limit when no content-length is sent', async () => {
    requestUrl.mockResolvedValue({
      status: 200,
      headers: {},
      arrayBuffer: new ArrayBuffer(MAX_SIZE + 1),
    });

    await expect(downloadImageToBase64('https://example.com/huge.png')).rejects.toThrow(
      `Downloaded image exceeds size limit (${MAX_SIZE + 1} bytes)`
    );
  });

  it('wraps a non-Error rejection with the URL and keeps it as the cause', async () => {
    requestUrl.mockRejectedValue('network down');

    await expect(downloadImageToBase64('https://example.com/panda.png')).rejects.toMatchObject({
      message: 'Failed to download image from https://example.com/panda.png',
      cause: 'network down',
    });
  });
});
