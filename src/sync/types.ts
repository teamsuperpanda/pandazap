import { ANKI_CONNECT_DEFAULT_URL, ANKI_CONNECT_DEFAULT_PORT } from '../constants';

export interface AnkiCard {
  question: string;
  answer: string;
  image?: string;
  line: number;
}

/** Shape of a single note returned by Anki Connect's notesInfo action */
export interface AnkiNoteInfo {
  noteId: string;
  noteIds?: string[];
  id?: string;
  fields: {
    Front?: { value: string };
    Back?: { value: string };
    [key: string]: { value: string } | undefined;
  };
  tags?: string[];
  /** Card IDs generated from the note, used to find and move its deck. */
  cards?: number[];
}

/** Shape of a single card returned by Anki Connect's cardsInfo action */
export interface AnkiCardInfo {
  cardId: number;
  note?: number;
  deckName?: string;
}

/**
 * A renamed note whose Anki source tags still need migrating. Internal state,
 * not a user setting: it is kept so a rename that happens while Anki is
 * unreachable is retried instead of producing duplicate cards.
 */
export interface PendingTagMigration {
  fromPath: string;
  toPath: string;
}

/** Shape of the Anki Connect JSON response */
export interface AnkiConnectResponse {
  result: unknown;
  error: string | null;
}

/** Cache entry for a single note keyed by its Front field */
export interface NoteCacheEntry {
  noteId: string;
  fields: AnkiNoteInfo['fields'];
  raw: AnkiNoteInfo;
}

export interface PandaZapSettings {
  ankiConnectUrl: string;
  ankiConnectPort: number;
  defaultDeck: string;
  // Word placed before the required '::' on the first line of a note to explicitly set the target deck (e.g. "Deck")
  deckOverrideWord: string;
  // Word used to mark questions (left side before required ':'), e.g. 'Q'
  questionWord: string;
  // Word used to mark answers (left side before required ':'), e.g. 'A'
  answerWord: string;
  // Word used to mark images (left side before required ':'), e.g. 'I'
  imageWord: string;
  noteType: string;
  useNoteBased: boolean;
  boldQuestionInReadingMode: boolean;
  pendingTagMigrations: PendingTagMigration[];
}

export enum CardAction {
  ADD = 'add',
  UPDATE = 'update',
  DELETE = 'delete',
}

export interface CardSyncInfo {
  card: AnkiCard;
  action: CardAction;
  deckName: string;
  existingCardId?: string;
  /** Source note path, set during batch sync to identify which note a card belongs to. */
  notePath?: string;
}

export interface SyncAnalysis {
  cardsToAdd: CardSyncInfo[];
  cardsToUpdate: CardSyncInfo[];
  cardsToDelete: CardSyncInfo[];
  totalCards: number;
}

/** Outcome of processing one card during a sync run. */
export type SyncCardStatus =
  | 'added'
  | 'updated'
  | 'skipped-existing'
  | 'skipped-identical'
  | 'image-failed'
  | 'failed'
  | 'preview';

export interface SyncCardResult {
  card: AnkiCard;
  status: SyncCardStatus;
  /** Target deck, when the card was processed against one. */
  deckName?: string;
  /** Human-readable detail for failed or skipped outcomes. */
  reason?: string;
}

export interface SyncDeletionResult {
  deletedCount: number;
  failed: boolean;
  reason?: string;
}

/** Result of a sync run: one entry per card plus an optional deletion outcome. */
export interface SyncResult {
  cards: SyncCardResult[];
  deletion?: SyncDeletionResult;
}

/**
 * Cooperative cancellation token for a sync run. The caller sets `cancelled`;
 * the sync stops before the next Anki mutation and returns what it has so far.
 */
export interface SyncAbortToken {
  cancelled: boolean;
}

/** Optional hooks a caller can pass into a sync run. */
export interface SyncRunOptions {
  /** Called after each processed card with the running count and the run total. */
  onProgress?: (done: number, total: number) => void;
  /** Checked between cards and before deletions; setting `cancelled` stops the run. */
  abort?: SyncAbortToken;
}

/** State of a sync run that was cancelled by the user. */
export interface SyncResultProgress {
  done: number;
  total: number;
  cancelled: boolean;
}

/** Connection state reported by AnkiConnect, including the version when known. */
export type AnkiConnectionStatus = 'ok' | 'unreachable' | 'version-too-old' | 'protocol-error';

export interface AnkiConnectionState {
  status: AnkiConnectionStatus;
  version?: number;
  /** Extra user-facing detail for a failure, such as a request timeout. */
  detail?: string;
}

/** Single source of user-facing wording for every connection state. */
export function describeConnection(state: AnkiConnectionState, requiredVersion: number): string {
  let message: string;
  switch (state.status) {
    case 'ok':
      return 'Connected to AnkiConnect';
    case 'version-too-old':
      message = `AnkiConnect ${state.version ?? 'unknown'} is too old. Panda Zap requires AnkiConnect ${requiredVersion} or newer.`;
      break;
    case 'protocol-error':
      message = 'AnkiConnect returned an unexpected response. Check the URL and port.';
      break;
    case 'unreachable':
      message =
        'Cannot reach AnkiConnect. Make sure Anki is running with the AnkiConnect addon installed.';
      break;
  }
  return state.detail ? `${message} ${state.detail}` : message;
}

export interface SyncModalStatus {
  /** Main connection status line. */
  title: string;
  /** Secondary connection detail, only when not connected. */
  detail?: string;
  /** Analysis failure line, rendered separately from the connection state. */
  analysisError?: string;
}

/**
 * Wording for the sync modal status block. Connection state and analysis
 * failure are kept apart so a failed analysis never changes the connection
 * diagnosis.
 */
export function describeSyncModalStatus(
  connection: AnkiConnectionState,
  analysisError: string | null,
  requiredVersion: number
): SyncModalStatus {
  if (connection.status === 'ok') {
    return {
      title: 'Connected to Anki',
      analysisError: analysisError ? `Analysis failed: ${analysisError}` : undefined,
    };
  }
  return {
    title:
      connection.status === 'version-too-old'
        ? 'AnkiConnect is out of date'
        : 'Not connected to Anki',
    detail: describeConnection(connection, requiredVersion),
  };
}

/** Render one card result as a human-readable line. */
export function formatSyncCardResult(result: SyncCardResult, settings?: PandaZapSettings): string {
  const { card, status, deckName, reason } = result;
  const target = deckName ? ` -> ${deckName}` : '';
  switch (status) {
    case 'added':
      return `Added: ${card.question}${target}`;
    case 'updated':
      return `Updated: ${card.question}${target}`;
    case 'skipped-existing':
      return `Skipped (already exists): ${card.question}${target}`;
    case 'skipped-identical':
      return `Skipped (already up-to-date): ${card.question}${target}`;
    case 'image-failed':
      return `Image failed (${card.image}): ${reason ?? 'Unknown error'}`;
    case 'failed':
      return `Failed: ${card.question} - ${reason ?? 'Unknown error'}`;
    case 'preview': {
      const qWord = (settings?.questionWord || '').trim() || 'Q';
      const aWord = (settings?.answerWord || '').trim() || 'A';
      const imageInfo = card.image ? ` | Image: ${card.image}` : '';
      const answerInfo = card.answer ? card.answer : '(image only)';
      return `Preview: ${qWord}: ${card.question} | ${aWord}: ${answerInfo}${imageInfo} | Deck: ${deckName ?? ''}`;
    }
  }
}

/** Render a whole sync result as human-readable lines. */
export function formatSyncResult(result: SyncResult, settings?: PandaZapSettings): string[] {
  const lines = result.cards.map((card) => formatSyncCardResult(card, settings));
  if (result.deletion) {
    lines.push(
      result.deletion.failed
        ? `Failed to delete notes: ${result.deletion.reason ?? 'Unknown error'}`
        : `Deleted ${result.deletion.deletedCount} notes from Anki`
    );
  }
  return lines;
}

/**
 * Wording for the completion notice. A cancelled run reports the partial
 * result, so cancelling never hides what already happened in Anki.
 */
export function describeSyncResultNotice(
  result: SyncResult,
  progress?: SyncResultProgress
): string {
  const total = result.cards.length;
  const succeeded = result.cards.filter(
    (card) => card.status === 'added' || card.status === 'updated'
  ).length;
  const failed = result.cards.filter(
    (card) => card.status === 'failed' || card.status === 'image-failed'
  ).length;
  const skipped = result.cards.filter(
    (card) => card.status === 'skipped-existing' || card.status === 'skipped-identical'
  ).length;
  const deleted = result.deletion && !result.deletion.failed ? result.deletion.deletedCount : 0;
  const deletionNote = deleted > 0 ? `, ${deleted} deleted` : '';
  const deletionFailedNote = result.deletion?.failed ? '; deletion failed' : '';
  const summary = `${succeeded} succeeded, ${failed} failed, ${skipped} skipped`;

  if (progress?.cancelled) {
    return `Cancelled after ${progress.done} of ${progress.total} cards: ${summary}${deletionNote}${deletionFailedNote}`;
  }
  if (total > 0 && failed === total) {
    return `Sync failed: ${failed} of ${total} cards failed${deletionNote}${deletionFailedNote}`;
  }
  if (failed > 0 || result.deletion?.failed) {
    return `Sync completed with issues: ${summary}${deletionNote}${deletionFailedNote}`;
  }
  return `Sync completed: ${succeeded} succeeded, ${skipped} skipped${deletionNote}`;
}

/** A point-in-time snapshot of the note used for one analysis/sync flow. */
export interface SyncContext {
  readonly cards: readonly AnkiCard[];
  readonly notePath?: string;
  readonly noteContent?: string;
}

export function createSyncContext(
  cards: readonly AnkiCard[],
  notePath?: string,
  noteContent?: string
): SyncContext {
  const cardSnapshot = cards.map((card) => Object.freeze({ ...card }));
  return Object.freeze({
    cards: Object.freeze(cardSnapshot),
    notePath,
    noteContent,
  });
}

/**
 * Point-in-time snapshot of multiple notes for batch analysis/sync.
 * Each entry maps note path to its extracted card context.
 */
export interface BatchSyncContext {
  readonly contexts: ReadonlyMap<string, SyncContext>;
  readonly notePaths: readonly string[];
  readonly totalCards: number;
}

export function createBatchSyncContext(contexts: Map<string, SyncContext>): BatchSyncContext {
  const frozenContexts = new Map(contexts);
  const notePaths = [...frozenContexts.keys()];
  const totalCards = [...frozenContexts.values()].reduce((sum, ctx) => sum + ctx.cards.length, 0);
  return Object.freeze({
    contexts: frozenContexts,
    notePaths,
    totalCards,
  });
}

export const DEFAULT_SETTINGS: PandaZapSettings = {
  ankiConnectUrl: ANKI_CONNECT_DEFAULT_URL,
  ankiConnectPort: ANKI_CONNECT_DEFAULT_PORT,
  defaultDeck: 'Default',
  deckOverrideWord: 'Deck',
  imageWord: 'I',
  questionWord: 'Q',
  answerWord: 'A',
  noteType: 'Basic',
  useNoteBased: true,
  boldQuestionInReadingMode: true,
  pendingTagMigrations: [],
};
