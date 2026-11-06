import {
  AnkiConnectionState,
  BatchSyncContext,
  SyncAbortToken,
  SyncAnalysis,
  SyncContext,
  SyncResult,
  SyncResultProgress,
  SyncRunOptions,
} from '../sync/types';
import { SYNC_PROGRESS_RENDER_INTERVAL_MS } from '../constants';

/** Every state the sync dialog can be in. The view renders from this. */
export type SyncPhase = 'connecting' | 'analyzing' | 'ready' | 'syncing' | 'done' | 'failed';

/** Deletion counts and IDs for one analysis, the single aggregation path. */
export interface DeletionPlan {
  /** Number of cards to remove, including those changed in Anki. */
  count: number;
  /** Distinct source notes among the deletion candidates. */
  noteCount: number;
  /** Deletion candidates whose Anki note changed outside the plugin. */
  editedCount: number;
  /** Confirmed Anki note IDs, for single-note sync. */
  ids: readonly string[];
  /** Confirmed Anki note IDs grouped by source note, for batch sync. */
  idsByNote: ReadonlyMap<string, readonly string[]>;
}

/** What the deletion confirmation needs to know, independent of any modal. */
export interface DeletionPrompt {
  count: number;
  /** Distinct notes affected, set for batch sync only. */
  noteCount?: number;
  editedCount: number;
}

export interface SingleSyncRequest {
  deleteConfirmed: boolean;
  confirmedDeletionIds?: readonly string[];
  runOptions: SyncRunOptions;
}

export interface BatchSyncRequest {
  deleteConfirmed: boolean;
  confirmedDeletionIdsByNote?: ReadonlyMap<string, readonly string[]>;
  runOptions: SyncRunOptions;
}

/**
 * Plugin operations the controller depends on. Injecting them keeps the
 * controller free of Obsidian and plugin instances.
 */
export interface SyncModalOperations {
  testConnection: () => Promise<AnkiConnectionState>;
  analyzeSingle: () => Promise<SyncAnalysis>;
  analyzeBatch: () => Promise<SyncAnalysis>;
  syncSingle: (request: SingleSyncRequest) => Promise<SyncResult>;
  syncBatch: (request: BatchSyncRequest) => Promise<SyncResult>;
}

/** What happened when a sync was asked to run. */
export type SyncRunOutcome =
  | { status: 'completed'; result: SyncResult }
  /** Nothing in the selection can be added, updated or removed. */
  | { status: 'nothing-to-sync' }
  /** The user dismissed the deletion prompt; the sync never started. */
  | { status: 'deletion-cancelled' }
  | { status: 'unavailable'; reason: 'connection' | 'analysis' }
  | { status: 'failed'; message: string }
  /** A run was already in flight, so the request was ignored. */
  | { status: 'busy' };

export interface SyncModalControllerOptions {
  /** Snapshot for single-note sync. Ignored in batch mode. */
  context: SyncContext;
  /** Batch snapshot; its presence selects batch mode. */
  batchContext?: BatchSyncContext;
  operations: SyncModalOperations;
  confirmDeletion: (details: DeletionPrompt) => Promise<boolean>;
  /** Called after every state change so the view can re-render. */
  onChange?: () => void;
  /** Called right before a sync run starts, for the user-facing notice. */
  onSyncStart?: () => void;
  /** Injectable clock, so progress throttling is testable. */
  now?: () => number;
}

/**
 * Owns the sync dialog's state and decisions: connection, analysis, deletion
 * confirmation and the sync run. It knows nothing about the DOM, notices or
 * marker labels; the view turns its phase and state into UI.
 */
export class SyncModalController {
  readonly context: SyncContext;
  readonly batchContext?: BatchSyncContext;

  phase: SyncPhase = 'connecting';
  connection: AnkiConnectionState | null = null;
  analysis: SyncAnalysis | null = null;
  analysisError: string | null = null;
  result: SyncResult | null = null;
  lastError: string | null = null;
  /** Abort token of the run in flight, null when no run is active. */
  abort: SyncAbortToken | null = null;
  /** Set after a cancelled run, so the completion notice reports the partial result. */
  progress: SyncResultProgress | null = null;
  processed = 0;
  total = 0;

  private readonly operations: SyncModalOperations;
  private readonly confirmDeletion: (details: DeletionPrompt) => Promise<boolean>;
  private readonly onChange: (() => void) | undefined;
  private readonly onSyncStart: (() => void) | undefined;
  private readonly now: () => number;
  private lastRender = 0;

  constructor(options: SyncModalControllerOptions) {
    this.context = options.context;
    this.batchContext = options.batchContext;
    this.operations = options.operations;
    this.confirmDeletion = options.confirmDeletion;
    this.onChange = options.onChange;
    this.onSyncStart = options.onSyncStart;
    this.now = options.now ?? (() => Date.now());
  }

  get isBatchMode(): boolean {
    return this.batchContext !== undefined;
  }

  get isConnected(): boolean {
    return this.connection?.status === 'ok';
  }

  /** True while the connector run is in flight, so close can be blocked. */
  get isRunning(): boolean {
    return this.phase === 'syncing';
  }

  get isCancelling(): boolean {
    return this.abort?.cancelled === true;
  }

  get canRetryAnalysis(): boolean {
    return this.isConnected && this.analysisError !== null && !this.isRunning;
  }

  get canPreview(): boolean {
    return this.isConnected && this.analysis !== null && this.analysisError === null;
  }

  get canSync(): boolean {
    return this.isConnected && this.analysisError === null && !this.isRunning;
  }

  /** Tests the connection and, when it works, runs the analysis. */
  async connect(): Promise<AnkiConnectionState> {
    this.reset();
    this.phase = 'connecting';
    this.notify();

    this.connection = await this.operations.testConnection();
    if (this.connection.status !== 'ok') {
      this.phase = 'failed';
      this.notify();
      return this.connection;
    }
    await this.analyze();
    return this.connection;
  }

  /**
   * Retests the connection on the existing dialog. On success the analysis runs
   * in place, so a stale failed view is repaired instead of rebuilt.
   */
  async retryConnection(): Promise<AnkiConnectionState> {
    this.phase = 'connecting';
    this.lastError = null;
    this.notify();

    this.connection = await this.operations.testConnection();
    if (this.connection.status !== 'ok') {
      this.phase = 'failed';
      this.notify();
      return this.connection;
    }
    await this.analyze();
    return this.connection;
  }

  /** Clears a failed analysis and runs it again. */
  async retryAnalysis(): Promise<void> {
    if (!this.isConnected || this.isRunning) return;
    await this.analyze();
  }

  /**
   * Runs the sync after confirming any deletions. The caller maps the outcome
   * to notices and decides what closing means for its mode.
   */
  async runSync(): Promise<SyncRunOutcome> {
    if (this.isRunning) return { status: 'busy' };
    if (!this.isConnected) return { status: 'unavailable', reason: 'connection' };
    if (this.analysisError) return { status: 'unavailable', reason: 'analysis' };

    // The analysis can still be missing (a failed load is ignored on older
    // paths); load it so deletions can be prompted for.
    if (!this.analysis) {
      try {
        this.analysis = await this.runAnalysis();
        this.phase = 'ready';
      } catch {
        this.analysis = null;
      }
    }

    if (!this.hasAnythingToSync()) return { status: 'nothing-to-sync' };

    const deletions = this.collectDeletions(this.analysis);
    let deleteConfirmed = false;
    if (deletions.count > 0) {
      const confirmed = await this.confirmDeletion({
        count: deletions.count,
        noteCount: this.isBatchMode ? deletions.noteCount : undefined,
        editedCount: deletions.editedCount,
      });
      if (!confirmed) return { status: 'deletion-cancelled' };
      deleteConfirmed = true;
    }

    this.phase = 'syncing';
    this.result = null;
    this.progress = null;
    this.lastError = null;
    this.processed = 0;
    this.total = 0;
    this.lastRender = 0;
    const abort: SyncAbortToken = { cancelled: false };
    this.abort = abort;
    this.onSyncStart?.();
    this.notify();

    const runOptions: SyncRunOptions = {
      abort,
      onProgress: (done, total) => this.handleProgress(done, total),
    };

    let result: SyncResult;
    try {
      result = this.isBatchMode
        ? await this.operations.syncBatch({
            deleteConfirmed,
            confirmedDeletionIdsByNote: deleteConfirmed ? deletions.idsByNote : undefined,
            runOptions,
          })
        : await this.operations.syncSingle({
            deleteConfirmed,
            confirmedDeletionIds: deleteConfirmed ? deletions.ids : undefined,
            runOptions,
          });
    } catch (error: unknown) {
      this.phase = 'failed';
      this.lastError = errorMessage(error);
      this.abort = null;
      this.notify();
      return { status: 'failed', message: this.lastError };
    }

    this.result = result;
    // A click on Cancel that lands after the last card cancels nothing: the run
    // already processed everything.
    this.progress =
      abort.cancelled && this.processed < this.total
        ? { done: this.processed, total: this.total, cancelled: true }
        : null;
    this.abort = null;
    this.phase = 'done';
    this.notify();
    return { status: 'completed', result };
  }

  /** Asks the run in flight to stop before the next Anki mutation. */
  cancelSync(): void {
    if (!this.abort || this.abort.cancelled) return;
    this.abort.cancelled = true;
    this.notify();
  }

  /** True when a card count or a deletion gives the run something to do. */
  private hasAnythingToSync(): boolean {
    const deletionCount = this.analysis?.cardsToDelete.length ?? 0;
    const cardCount = this.isBatchMode
      ? (this.batchContext?.totalCards ?? 0)
      : this.context.cards.length;
    return cardCount > 0 || deletionCount > 0;
  }

  /**
   * Aggregates deletion candidates once for both modes: counts for the prompt,
   * IDs for the single-note sync and IDs grouped by note for the batch sync.
   */
  private collectDeletions(analysis: SyncAnalysis | null): DeletionPlan {
    const cards = analysis?.cardsToDelete ?? [];
    const ids: string[] = [];
    const notePaths = new Set<string>();
    const byNote = new Map<string, string[]>();
    for (const card of cards) {
      if (card.existingCardId) ids.push(card.existingCardId);
      if (!card.notePath) continue;
      notePaths.add(card.notePath);
      if (!card.existingCardId) continue;
      const list = byNote.get(card.notePath) ?? [];
      list.push(card.existingCardId);
      byNote.set(card.notePath, list);
    }
    return {
      count: cards.length,
      noteCount: notePaths.size,
      editedCount: cards.filter((card) => card.externallyEdited).length,
      ids: Object.freeze(ids),
      idsByNote: new Map(
        [...byNote.entries()].map(([path, list]) => [path, Object.freeze(list)] as const)
      ),
    };
  }

  private reset(): void {
    this.connection = null;
    this.analysis = null;
    this.analysisError = null;
    this.result = null;
    this.lastError = null;
    this.abort = null;
    this.progress = null;
    this.processed = 0;
    this.total = 0;
  }

  private async analyze(): Promise<void> {
    this.phase = 'analyzing';
    this.analysis = null;
    this.analysisError = null;
    this.notify();
    try {
      this.analysis = await this.runAnalysis();
      this.phase = 'ready';
    } catch (error: unknown) {
      this.analysis = null;
      this.analysisError = errorMessage(error);
      this.phase = 'failed';
    }
    this.notify();
  }

  private runAnalysis(): Promise<SyncAnalysis> {
    return this.isBatchMode ? this.operations.analyzeBatch() : this.operations.analyzeSingle();
  }

  private handleProgress(done: number, total: number): void {
    this.processed = done;
    this.total = total;
    const now = this.now();
    // A layout update per card costs more than the sync on large runs, so
    // intermediate counts are throttled and the final count always renders.
    if (done < total && now - this.lastRender < SYNC_PROGRESS_RENDER_INTERVAL_MS) return;
    this.lastRender = now;
    this.notify();
  }

  private notify(): void {
    this.onChange?.();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
