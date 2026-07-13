import { describe, it, expect, vi } from 'vitest';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl }));

import {
  sanitizeMediaFilename,
  getImageFilename,
  getStoredMediaFilename,
  readImageFileToBase64,
  resolveImageSource,
} from '../src/sync/imageUtils';
import type { App, TFile } from 'obsidian';

describe('sanitizeMediaFilename', () => {
  it('prepends pandazap prefix with hash', () => {
    const result = sanitizeMediaFilename('image.png', 'path/to/note.md');
    expect(result).toMatch(/^pandazap_[a-z0-9]+_image\.png$/);
  });

  it('preserves extension', () => {
    const result = sanitizeMediaFilename('photo.jpg', 'note.md');
    expect(result).toMatch(/\.jpg$/);
  });

  it('generates same result for same inputs', () => {
    const a = sanitizeMediaFilename('img.png', 'same/path.md');
    const b = sanitizeMediaFilename('img.png', 'same/path.md');
    expect(a).toBe(b);
  });

  it('generates different results for different source paths', () => {
    const a = sanitizeMediaFilename('img.png', 'note1.md');
    const b = sanitizeMediaFilename('img.png', 'note2.md');
    expect(a).not.toBe(b);
  });

  it('generates different results for same-named images from different source paths', () => {
    const a = sanitizeMediaFilename('img.png', 'note.md', 'assets/one/img.png');
    const b = sanitizeMediaFilename('img.png', 'note.md', 'assets/two/img.png');
    expect(a).not.toBe(b);
  });

  it('replaces unsafe characters with underscores', () => {
    const result = sanitizeMediaFilename('my image file!.png', 'note.md');
    expect(result).not.toContain(' ');
    expect(result).not.toContain('!');
    expect(result).toMatch(/\.png$/);
  });
});

describe('image source handling', () => {
  const localImage = {
    name: 'image.png',
    path: 'assets/one/image.png',
    stat: { size: 123 },
  } as TFile;
  const app = {
    metadataCache: {
      getFirstLinkpathDest: vi.fn(() => localImage),
    },
    vault: {
      readBinary: vi.fn(),
    },
  } as unknown as App;

  it('recognizes HTTP URLs regardless of scheme casing', () => {
    const source = resolveImageSource(app, 'HTTPS://example.com/image.png', 'note.md');
    expect(source).toBe('HTTPS://example.com/image.png');
    expect(app.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
  });

  it('uses the resolved full source path in the stored filename', () => {
    const first = getStoredMediaFilename(app, 'image.png', 'note.md');
    const secondApp = {
      ...app,
      metadataCache: {
        getFirstLinkpathDest: vi.fn(() => ({
          ...localImage,
          path: 'assets/two/image.png',
        })),
      },
    } as unknown as App;
    const second = getStoredMediaFilename(secondApp, 'image.png', 'note.md');

    expect(first).not.toBe(second);
  });

  it('rejects oversized local images before reading the file', async () => {
    const readBinary = vi.fn();
    const oversized = {
      ...localImage,
      stat: { size: 10 * 1024 * 1024 + 1 },
    } as TFile;
    const oversizedApp = { vault: { readBinary } } as unknown as App;

    await expect(readImageFileToBase64(oversizedApp, oversized)).rejects.toThrow('Image too large');
    expect(readBinary).not.toHaveBeenCalled();
  });
});

describe('getImageFilename', () => {
  it('extracts filename from URL', () => {
    expect(getImageFilename('https://example.com/images/photo.jpg')).toBe('photo.jpg');
  });

  it('extracts filename from path', () => {
    expect(getImageFilename('folder/subfolder/image.png')).toBe('image.png');
  });

  it('returns image.png fallback for empty path', () => {
    expect(getImageFilename('')).toBe('image.png');
  });
});
