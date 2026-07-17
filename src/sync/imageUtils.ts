import { App, TFile, requestUrl } from 'obsidian';
import { stableHash } from './hashUtils';

/**
 * Dual FNV-like hash producing a 14-character base-36 string.
 * More collision-resistant than the 7-character stableHash, used for
 * media filenames where uniqueness across paths matters.
 */
function mediaFileHash(value: string): string {
  let second = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${stableHash(value)}${(second >>> 0).toString(36).padStart(7, '0')}`;
}

export function sanitizeMediaFilename(
  filename: string,
  notePath: string,
  sourceIdentity?: string
): string {
  const base = (filename || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '_');
  const normalizedNotePath = notePath.replace(/\\/g, '/');
  const normalizedSource = sourceIdentity?.replace(/\\/g, '/');
  const h = mediaFileHash(
    normalizedSource === undefined
      ? normalizedNotePath
      : `${normalizedNotePath}\0${normalizedSource}`
  );
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx > 0) {
    const name = base.substring(0, dotIdx);
    const ext = base.substring(dotIdx);
    return `pandazap_${h}_${name}${ext}`;
  }
  return `pandazap_${h}_${base}`;
}

export function getImageFilename(pathOrUrl: string): string {
  try {
    const url = new URL(pathOrUrl, 'http://dummy.com');
    const pathname = url.pathname;
    const parts = pathname.split('/');
    const filename = parts[parts.length - 1];
    return filename || 'image.png';
  } catch {
    const parts = pathOrUrl.split('/');
    return parts[parts.length - 1] || 'image.png';
  }
}

const MAX_DOWNLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_SCHEMES = ['http:', 'https:'];

function isHttpUrl(value: string): boolean {
  try {
    return ALLOWED_SCHEMES.includes(new URL(value).protocol.toLowerCase());
  } catch {
    return false;
  }
}

export function resolveImageSource(
  app: App,
  imagePath: string,
  notePath: string
): TFile | string | null {
  if (!imagePath) return null;

  if (isHttpUrl(imagePath)) {
    return imagePath;
  }

  const file = app.metadataCache.getFirstLinkpathDest(imagePath, notePath);
  return file;
}

export function getStoredMediaFilename(
  app: App,
  imagePath: string,
  notePath: string
): string | null {
  const source = resolveImageSource(app, imagePath, notePath);
  if (!source) return null;

  return getStoredMediaFilenameForSource(source, notePath);
}

export function getStoredMediaFilenameForSource(source: TFile | string, notePath: string): string {
  if (typeof source === 'string') {
    return sanitizeMediaFilename(getImageFilename(source), notePath, source);
  }

  const filename = source.name || getImageFilename(source.path);
  return sanitizeMediaFilename(filename, notePath, source.path);
}

export async function readImageFileToBase64(app: App, file: TFile): Promise<string> {
  if (file.stat?.size > MAX_DOWNLOAD_SIZE_BYTES) {
    throw new Error(`Image too large (${file.stat.size} bytes, max ${MAX_DOWNLOAD_SIZE_BYTES})`);
  }

  try {
    const arrayBuffer = await app.vault.readBinary(file);
    return arrayBufferToBase64(arrayBuffer);
  } catch (e: unknown) {
    console.warn('PandaZap: failed to read image file', file.path, e);
    throw new Error(`Failed to read image file: ${file.path}`);
  }
}

export async function downloadImageToBase64(url: string): Promise<string> {
  const parsed = new URL(url);
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    throw new Error(`Blocked download from disallowed scheme: ${parsed.protocol}`);
  }

  try {
    const response = await requestUrl({ url, method: 'GET', throw: false });

    if (response.status >= 400) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const contentLength = response.headers?.['content-length'];
    if (contentLength && parseInt(contentLength) > MAX_DOWNLOAD_SIZE_BYTES) {
      throw new Error(`Image too large (${contentLength} bytes, max ${MAX_DOWNLOAD_SIZE_BYTES})`);
    }

    const arrayBuffer = response.arrayBuffer;
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_SIZE_BYTES) {
      throw new Error(`Downloaded image exceeds size limit (${arrayBuffer.byteLength} bytes)`);
    }

    return arrayBufferToBase64(arrayBuffer);
  } catch (e: unknown) {
    console.warn('PandaZap: failed to download image', url, e);
    if (e instanceof Error) throw e;
    throw new Error(`Failed to download image from ${url}`);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
