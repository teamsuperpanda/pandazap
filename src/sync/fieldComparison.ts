/** Field value compared for equality: trimmed, nothing else. */
export function normalizeField(value: string): string {
  return (value || '').toString().trim();
}

/** Field value with Anki's HTML entity and markup differences flattened away. */
export function normalizeHtmlField(value: string): string {
  let result = value.trim();
  result = result.replace(/&nbsp;/g, ' ');
  result = result.replace(/&amp;/g, '&');
  result = result.replace(/&lt;/g, '<');
  result = result.replace(/&gt;/g, '>');
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/<br\s*\/?>/gi, '\n');
  result = result.replace(/<\/?div>/gi, '\n');
  result = result.replace(/<\/?p>/gi, '\n');
  result = result.replace(/<\/?span[^>]*>/gi, '');
  result = result.replace(/\r\n/g, '\n');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();
  return result;
}

/** True when two fields hold the same content once normalised. */
export function fieldsMatch(a: string, b: string): boolean {
  return normalizeHtmlField(a) === normalizeHtmlField(b);
}
