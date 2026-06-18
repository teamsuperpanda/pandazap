import { App, TFile, requestUrl } from 'obsidian';

function shortHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function sanitizeMediaFilename(filename: string, notePath: string): string {
  const base = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const h = shortHash(notePath);
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

export function resolveImageSource(
  app: App,
  imagePath: string,
  notePath: string
): TFile | string | null {
  if (!imagePath) return null;

  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath;
  }

  const file = app.metadataCache.getFirstLinkpathDest(imagePath, notePath);
  return file;
}

export async function readImageFileToBase64(app: App, file: TFile): Promise<string> {
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


