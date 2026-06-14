import { App, TFile, requestUrl } from 'obsidian';
import { sanitizeMediaFilename, getImageFilename } from './mediaUtils';

export { sanitizeMediaFilename, getImageFilename };

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
  try {
    const response = await requestUrl({ url });
    return arrayBufferToBase64(response.arrayBuffer);
  } catch (e: unknown) {
    console.warn('PandaZap: failed to download image', url, e);
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


