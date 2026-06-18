import { describe, it, expect, vi } from 'vitest';
vi.mock('obsidian', () => ({}));
import { sanitizeMediaFilename, getImageFilename } from '../src/sync/imageUtils';

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

  it('replaces unsafe characters with underscores', () => {
    const result = sanitizeMediaFilename('my image file!.png', 'note.md');
    expect(result).not.toContain(' ');
    expect(result).not.toContain('!');
    expect(result).toMatch(/\.png$/);
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
