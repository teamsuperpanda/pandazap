import { stableHash } from './hashUtils';

/**
 * Anki caps a tag at this many characters. The legacy tag is truncated to it,
 * which can drop the part of a path that made it unique.
 */
export const MAX_SOURCE_TAG_LENGTH = 80;

const SOURCE_TAG_PREFIX = 'source:';

/** The untruncated legacy tag body: the path with separators made tag-safe. */
function legacyTagBase(notePath: string): string {
  const normalized = notePath.replace(/[/\\]/g, '_').replace(/[\s,]+/g, '_');
  return `${SOURCE_TAG_PREFIX}${normalized}`;
}

/** Truncated, per-path tag used before the hashed tag existed. */
export function legacySourceTag(notePath: string): string {
  return legacyTagBase(notePath).slice(0, MAX_SOURCE_TAG_LENGTH);
}

/** Unique per-path tag: the legacy tag truncated to leave room for a hash. */
export function sourceTag(notePath: string): string {
  const hash = stableHash(notePath.replace(/\\/g, '/'));
  return `${legacySourceTag(notePath).slice(0, MAX_SOURCE_TAG_LENGTH - hash.length - 1)}_${hash}`;
}

/** Both tags a note can be known by, hashed first. */
export function sourceTags(notePath: string): [string, string] {
  return [sourceTag(notePath), legacySourceTag(notePath)];
}

/** True when truncation keeps every character of the path, so the tag is unique. */
export function isLegacySourceTagLossless(notePath: string): boolean {
  return legacyTagBase(notePath).length <= MAX_SOURCE_TAG_LENGTH;
}

export interface SourceTagContext {
  notePath: string;
  useNoteBased: boolean;
  /** Deck the note is being synced into. */
  deckName: string;
  /** Deck the note's path alone targets. */
  notePathDeck: string;
  deckOverride?: string;
}

/**
 * A legacy tag can be truncated before the unique part of a long path. It is
 * therefore only authoritative when the note's path also determines a unique
 * deck. A deck override can place multiple source notes in one shared deck.
 */
export function canUseLegacySourceTag({
  notePath,
  useNoteBased,
  deckName,
  notePathDeck,
  deckOverride,
}: SourceTagContext): boolean {
  if (!useNoteBased) return false;
  if (isLegacySourceTagLossless(notePath)) return true;
  return Boolean(deckName && deckName === notePathDeck) && !deckOverride;
}

/** Source tags that may own the note's Anki notes, hashed first. */
export function eligibleSourceTags(context: SourceTagContext): string[] {
  const [hashed, legacy] = sourceTags(context.notePath);
  return canUseLegacySourceTag(context) ? [hashed, legacy] : [hashed];
}
