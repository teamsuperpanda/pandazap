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
