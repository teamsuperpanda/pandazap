import { DEFAULT_SETTINGS } from './sync/types';
import type { PandaZapSettings, PendingTagMigration } from './sync/types';

export const ANKI_CONNECT_PORT_MIN = 1;
export const ANKI_CONNECT_PORT_MAX = 65535;

/** Marker words used for display and matching, always valid and trimmed. */
export interface MarkerLabels {
  q: string;
  a: string;
  i: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Turns a typed http(s) URL or bare host (e.g. `localhost:8765`) into an http(s)
 * URL. Bare hosts are given the `http://` scheme the connector needs; anything
 * unusable returns null.
 */
export function parseAnkiConnectUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isValidHttpUrl(trimmed)) return trimmed;
  if (trimmed.includes('://')) return null;
  const withScheme = `http://${trimmed}`;
  return isValidHttpUrl(withScheme) ? withScheme : null;
}

function normalizeAnkiConnectUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.ankiConnectUrl;
  return parseAnkiConnectUrl(value) ?? DEFAULT_SETTINGS.ankiConnectUrl;
}

function portFromString(value: unknown): number {
  if (typeof value !== 'string') return Number.NaN;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Keeps a whole-number port inside 1-65535; anything else uses the default port. */
function normalizeAnkiConnectPort(value: unknown): number {
  const port = typeof value === 'number' ? value : portFromString(value);
  if (!Number.isInteger(port) || port < ANKI_CONNECT_PORT_MIN || port > ANKI_CONNECT_PORT_MAX) {
    return DEFAULT_SETTINGS.ankiConnectPort;
  }
  return port;
}

function normalizeText(value: unknown, fallback: string): string {
  const text = trimmedString(value);
  return text ? text : fallback;
}

function normalizeMarkerWord(value: unknown, fallback: string): string {
  const word = trimmedString(value);
  return word && validateMarkerWord(word) === null ? word : fallback;
}

/** Deck names go into a `deck:"..."` query, so they cannot contain line breaks. */
function normalizeDeckName(value: unknown, fallback: string): string {
  const name = trimmedString(value);
  return name && validateDeckName(name) === null ? name : fallback;
}

/**
 * The deck override word is matched before `::`, so it is plain text: it may
 * contain a colon but not a line break, and it must not be empty.
 */
function normalizeDeckOverrideWord(value: unknown, fallback: string): string {
  const word = trimmedString(value);
  return word && validateDeckOverrideWord(word) === null ? word : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Keeps only complete rename pairs. The queue is internal state, so a corrupt
 * entry (a string, a half-written object, a non-string path) is dropped rather
 * than repaired into a migration that would retag the wrong notes. Paths are
 * kept verbatim because the source tag is derived from the exact string.
 */
function normalizePendingTagMigrations(value: unknown): PendingTagMigration[] {
  if (!Array.isArray(value)) return [];
  const migrations: PendingTagMigration[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { fromPath, toPath } = entry;
    if (typeof fromPath !== 'string' || typeof toPath !== 'string') continue;
    if (!fromPath.trim() || !toPath.trim() || fromPath === toPath) continue;
    migrations.push({ fromPath, toPath });
  }
  return migrations;
}

/**
 * Turns untrusted `data.json` content into a complete, valid settings object.
 * Unknown keys are dropped and every value is a known key with the expected type.
 */
export function normalizeSettings(raw: unknown): PandaZapSettings {
  const source = isRecord(raw) ? raw : {};
  return {
    ankiConnectUrl: normalizeAnkiConnectUrl(source.ankiConnectUrl),
    ankiConnectPort: normalizeAnkiConnectPort(source.ankiConnectPort),
    defaultDeck: normalizeDeckName(source.defaultDeck, DEFAULT_SETTINGS.defaultDeck),
    deckOverrideWord: normalizeDeckOverrideWord(
      source.deckOverrideWord,
      DEFAULT_SETTINGS.deckOverrideWord
    ),
    questionWord: normalizeMarkerWord(source.questionWord, DEFAULT_SETTINGS.questionWord),
    answerWord: normalizeMarkerWord(source.answerWord, DEFAULT_SETTINGS.answerWord),
    imageWord: normalizeMarkerWord(source.imageWord, DEFAULT_SETTINGS.imageWord),
    noteType: normalizeText(source.noteType, DEFAULT_SETTINGS.noteType),
    useNoteBased: normalizeBoolean(source.useNoteBased, DEFAULT_SETTINGS.useNoteBased),
    boldQuestionInReadingMode: normalizeBoolean(
      source.boldQuestionInReadingMode,
      DEFAULT_SETTINGS.boldQuestionInReadingMode
    ),
    syncOnSave: normalizeBoolean(source.syncOnSave, DEFAULT_SETTINGS.syncOnSave),
    pendingTagMigrations: normalizePendingTagMigrations(source.pendingTagMigrations),
  };
}

/**
 * User settings reset to their defaults. Pending rename migrations are internal
 * state, so a reset must not drop renames that have not reached Anki yet.
 */
export function restoreDefaultSettings(settings: PandaZapSettings): PandaZapSettings {
  return { ...DEFAULT_SETTINGS, pendingTagMigrations: settings.pendingTagMigrations };
}

/** The marker words every matcher and label must use, with defaults applied. */
export function markerLabels(settings: PandaZapSettings): MarkerLabels {
  return {
    q: normalizeMarkerWord(settings.questionWord, DEFAULT_SETTINGS.questionWord),
    a: normalizeMarkerWord(settings.answerWord, DEFAULT_SETTINGS.answerWord),
    i: normalizeMarkerWord(settings.imageWord, DEFAULT_SETTINGS.imageWord),
  };
}

/** Returns a user-facing error for a marker word that cannot be parsed, else null. */
export function validateMarkerWord(word: string): string | null {
  if (!word.trim()) return 'Marker word cannot be empty.';
  if (/[\r\n]/.test(word)) return 'Marker word cannot contain a line break.';
  if (word.includes(':')) return 'Marker word cannot contain a colon.';
  return null;
}

/** Returns a user-facing error for a deck override word, else null. */
export function validateDeckOverrideWord(word: string): string | null {
  if (!word.trim()) return 'Deck override word cannot be empty.';
  if (/[\r\n]/.test(word)) return 'Deck override word cannot contain a line break.';
  return null;
}

/** Returns a user-facing error for a target deck name, else null. */
export function validateDeckName(name: string): string | null {
  if (!name.trim()) return 'Deck name cannot be empty.';
  if (/[\r\n]/.test(name)) return 'Deck name cannot contain a line break.';
  return null;
}

/** Parses a port typed into the settings UI; null when it is not 1-65535. */
export function parsePort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < ANKI_CONNECT_PORT_MIN || port > ANKI_CONNECT_PORT_MAX) {
    return null;
  }
  return port;
}

/** True when the configured string already carries a port (including :80 and :443). */
function hasExplicitPort(value: string): boolean {
  const authority = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
  return /:\d+$/.test(authority);
}

/** Builds the AnkiConnect endpoint, applying the configured port when the URL has none. */
export function buildAnkiConnectUrl(settings: PandaZapSettings): string {
  const configuredUrl = settings.ankiConnectUrl || DEFAULT_SETTINGS.ankiConnectUrl;
  const port = settings.ankiConnectPort || DEFAULT_SETTINGS.ankiConnectPort;
  try {
    let url: URL;
    try {
      url = new URL(configuredUrl);
    } catch {
      url = new URL(`http://${configuredUrl}`);
    }
    if (!hasExplicitPort(configuredUrl)) url.port = String(port);
    return url.toString();
  } catch {
    return `${DEFAULT_SETTINGS.ankiConnectUrl}:${port}`;
  }
}
