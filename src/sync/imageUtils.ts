import { App, TFile, requestUrl } from 'obsidian';

/**
 * Resolves an image path from a note to an absolute vault path or keeps it as URL
 * @param app Obsidian App instance
 * @param imagePath Image path from text (filename, relative path, or URL)
 * @param notePath Path of the note containing the image link
 * @returns The resolved TFile (if local) or string URL (if remote), or null if not found
 */
export function resolveImageSource(
  app: App,
  imagePath: string,
  notePath: string
): TFile | string | null {
  if (!imagePath) return null;

  // Check for external URL
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath; // Return as is
  }

  // Handle local file
  // Use Obsidian's metadata cache to resolve the link
  // getFirstLinkpathDest handles relative paths vs absolute paths logic
  const file = app.metadataCache.getFirstLinkpathDest(imagePath, notePath);
  return file;
}

/**
 * Reads an image file from the vault and converts it to base64
 * @param app Obsidian App instance
 * @param file The TFile to read
 * @returns Promise<string> base64 encoded string
 */
export async function readImageFileToBase64(app: App, file: TFile): Promise<string> {
  try {
    const arrayBuffer = await app.vault.readBinary(file);
    return arrayBufferToBase64(arrayBuffer);
  } catch {
    throw new Error(`Failed to read image file: ${file.path}`);
  }
}

/**
 * Downloads an external image and converts it to base64
 * @param url The URL to download
 * @returns Promise<string> base64 encoded string
 */
export async function downloadImageToBase64(url: string): Promise<string> {
  try {
    const response = await requestUrl({ url });
    return arrayBufferToBase64(response.arrayBuffer);
  } catch {
    throw new Error(`Failed to download image from ${url}`);
  }
}

/**
 * Helper to convert ArrayBuffer to Base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Gets a clean filename from a path or URL
 * @param pathOrUrl String path or URL
 * @returns Filename with extension
 */
export function getImageFilename(pathOrUrl: string): string {
  try {
    const url = new URL(pathOrUrl, 'http://dummy.com'); // use dummy base for relative paths
    const pathname = url.pathname;
    const parts = pathname.split('/');
    const filename = parts[parts.length - 1];
    return filename || 'image.png'; // Fallback
  } catch {
    // Fallback for simple paths
    const parts = pathOrUrl.split('/');
    return parts[parts.length - 1] || 'image.png';
  }
}
