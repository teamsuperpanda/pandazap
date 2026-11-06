import { describe, expect, it, vi } from 'vitest';
import {
  SyncModalController,
  type SyncModalOperations,
  type SyncPhase,
} from '../src/dialogs/SyncModalController';
import {
  createBatchSyncContext,
  createSyncContext,
  type BatchSyncContext,
  type CardSyncInfo,
  type SyncAnalysis,
  type SyncResult,
  type SyncRunOptions,
} from '../src/sync/types';

function analysis(overrides: Partial<SyncAnalysis> = {}): SyncAnalysis {
  return {
    cardsToAdd: [],
    cardsToUpdate: [],
    cardsToDelete: [],
    cardsInConflict: [],
    totalCards: 0,
    ...overrides,
  };
}

function deletion(id: number, notePath?: string, externallyEdited = false): CardSyncInfo {
  return {
    card: { question: 'Removed question', answer: 'Removed answer' },
    deckName: 'Default',
    existingCardId: id,
    notePath,
    externallyEdited,
  };
}

function operations(overrides: Partial<SyncModalOperations> = {}): SyncModalOperations {
  return {
    testConnection: vi.fn().mockResolvedValue({ status: 'ok', version: 6 }),
    analyzeSingle: vi.fn().mockResolvedValue(analysis()),
    analyzeBatch: vi.fn().mockResolvedValue(analysis()),
    syncSingle: vi.fn().mockResolvedValue({ cards: [] }),
    syncBatch: vi.fn().mockResolvedValue({ cards: [] }),
    ...overrides,
  };
}

function createController(
  options: {
    operations?: SyncModalOperations;
    batchContext?: BatchSyncContext;
    confirmDeletion?: (details: {
      count: number;
      noteCount?: number;
      editedCount: number;
    }) => Promise<boolean>;
    onChange?: () => void;
  } = {}
): SyncModalController {
  return new SyncModalController({
    context: createSyncContext([{ question: 'Q', answer: 'A' }], 'mine.md'),
    batchContext: options.batchContext,
    operations: options.operations ?? operations(),
    confirmDeletion: options.confirmDeletion ?? vi.fn().mockResolvedValue(true),
    onChange: options.onChange,
  });
}

function phases(controller: SyncModalController, onChange: ReturnType<typeof vi.fn>): SyncPhase[] {
  const seen: SyncPhase[] = [];
  onChange.mockImplementation(() => {
    if (seen[seen.length - 1] !== controller.phase) seen.push(controller.phase);
  });
  return seen;
}

describe('SyncModalController connection and analysis', () => {
  it('goes connecting -> analyzing -> ready', async () => {
    const ops = operations();
    const onChange = vi.fn();
    const controller = createController({ operations: ops, onChange });
    const seen = phases(controller, onChange);

    await controller.connect();

    expect(seen).toEqual(['connecting', 'analyzing', 'ready']);
    expect(controller.phase).toBe('ready');
    expect(ops.testConnection).toHaveBeenCalledTimes(1);
    expect(ops.analyzeSingle).toHaveBeenCalledTimes(1);
    expect(controller.analysis).not.toBeNull();
    expect(controller.canSync).toBe(true);
  });

  it('reports a failed connection without running the analysis', async () => {
    const ops = operations({
      testConnection: vi.fn().mockResolvedValue({ status: 'unreachable' }),
    });
    const controller = createController({ operations: ops });

    await controller.connect();

    expect(controller.phase).toBe('failed');
    expect(controller.connection?.status).toBe('unreachable');
    expect(ops.analyzeSingle).not.toHaveBeenCalled();
    expect(controller.canSync).toBe(false);
  });

  it('tracks an analysis failure and clears it on retry', async () => {
    const analyzeSingle = vi
      .fn()
      .mockRejectedValueOnce(new Error('findNotes failed'))
      .mockResolvedValueOnce(analysis({ cardsToAdd: [] }));
    const controller = createController({ operations: operations({ analyzeSingle }) });

    await controller.connect();
    expect(controller.phase).toBe('failed');
    expect(controller.connection?.status).toBe('ok');
    expect(controller.analysisError).toBe('findNotes failed');
    expect(controller.canRetryAnalysis).toBe(true);
    expect(controller.canSync).toBe(false);

    await controller.retryAnalysis();

    expect(controller.phase).toBe('ready');
    expect(controller.analysisError).toBeNull();
    expect(controller.canSync).toBe(true);
  });

  it('repairs a failed connection on the existing controller', async () => {
    const testConnection = vi
      .fn()
      .mockResolvedValueOnce({ status: 'unreachable' })
      .mockResolvedValueOnce({ status: 'ok', version: 6 });
    const controller = createController({ operations: operations({ testConnection }) });

    await controller.connect();
    expect(controller.phase).toBe('failed');

    const state = await controller.retryConnection();

    expect(state.status).toBe('ok');
    expect(controller.phase).toBe('ready');
    expect(controller.canSync).toBe(true);
  });
});

describe('SyncModalController deletion aggregation', () => {
  it('confirms single-note deletions once and passes their IDs', async () => {
    const syncSingle = vi.fn().mockResolvedValue({ cards: [] });
    const confirmDeletion = vi.fn().mockResolvedValue(true);
    const controller = createController({
      operations: operations({
        analyzeSingle: vi
          .fn()
          .mockResolvedValue(
            analysis({ cardsToDelete: [deletion(11), deletion(12, undefined, true)] })
          ),
        syncSingle,
      }),
      confirmDeletion,
    });

    await controller.connect();
    const outcome = await controller.runSync();

    expect(confirmDeletion).toHaveBeenCalledWith({
      count: 2,
      noteCount: undefined,
      editedCount: 1,
    });
    expect(syncSingle).toHaveBeenCalledTimes(1);
    const request = syncSingle.mock.calls[0][0] as {
      deleteConfirmed: boolean;
      confirmedDeletionIds?: readonly string[];
      runOptions: SyncRunOptions;
    };
    expect(request.deleteConfirmed).toBe(true);
    expect(request.confirmedDeletionIds).toEqual([11, 12]);
    expect(outcome.status).toBe('completed');
  });

  it('groups batch deletions by note and reports the note count', async () => {
    const batchContext = createBatchSyncContext(
      new Map([
        ['one.md', createSyncContext([], 'one.md', '')],
        ['two.md', createSyncContext([], 'two.md', '')],
      ])
    );
    const syncBatch = vi.fn().mockResolvedValue({ cards: [] });
    const confirmDeletion = vi.fn().mockResolvedValue(true);
    const controller = createController({
      batchContext,
      operations: operations({
        analyzeBatch: vi
          .fn()
          .mockResolvedValue(
            analysis({ cardsToDelete: [deletion(11, 'one.md'), deletion(12, 'two.md')] })
          ),
        syncBatch,
      }),
      confirmDeletion,
    });

    await controller.connect();
    const outcome = await controller.runSync();

    expect(confirmDeletion).toHaveBeenCalledWith({ count: 2, noteCount: 2, editedCount: 0 });
    const request = syncBatch.mock.calls[0][0] as {
      deleteConfirmed: boolean;
      confirmedDeletionIdsByNote?: ReadonlyMap<string, readonly string[]>;
    };
    expect(request.deleteConfirmed).toBe(true);
    expect([...(request.confirmedDeletionIdsByNote ?? new Map()).entries()]).toEqual([
      ['one.md', [11]],
      ['two.md', [12]],
    ]);
    expect(outcome.status).toBe('completed');
  });

  it('does not open a second deletion prompt while one is pending', async () => {
    let resolveConfirm: ((confirmed: boolean) => void) | undefined;
    const confirmDeletion = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        })
    );
    const syncSingle = vi.fn().mockResolvedValue({ cards: [] });
    const controller = createController({
      operations: operations({
        analyzeSingle: vi.fn().mockResolvedValue(analysis({ cardsToDelete: [deletion(11)] })),
        syncSingle,
      }),
      confirmDeletion,
    });

    await controller.connect();
    const firstRun = controller.runSync();
    await vi.waitFor(() => expect(confirmDeletion).toHaveBeenCalledTimes(1));

    expect(await controller.runSync()).toEqual({ status: 'busy' });
    expect(confirmDeletion).toHaveBeenCalledTimes(1);
    expect(controller.canSync).toBe(false);

    resolveConfirm?.(true);
    await firstRun;
    expect(syncSingle).toHaveBeenCalledTimes(1);
  });

  it('never starts a run when the deletion is not confirmed', async () => {
    const syncSingle = vi.fn().mockResolvedValue({ cards: [] });
    const controller = createController({
      operations: operations({
        analyzeSingle: vi.fn().mockResolvedValue(analysis({ cardsToDelete: [deletion(11)] })),
        syncSingle,
      }),
      confirmDeletion: vi.fn().mockResolvedValue(false),
    });

    await controller.connect();
    const outcome = await controller.runSync();

    expect(outcome.status).toBe('deletion-cancelled');
    expect(syncSingle).not.toHaveBeenCalled();
    expect(controller.phase).toBe('ready');
  });
});

describe('SyncModalController sync runs', () => {
  it('reports a successful run with its typed result', async () => {
    const result: SyncResult = {
      cards: [{ card: { question: 'Q', answer: 'A' }, status: 'added' }],
    };
    const controller = createController({
      operations: operations({ syncSingle: vi.fn().mockResolvedValue(result) }),
    });

    await controller.connect();
    const outcome = await controller.runSync();

    expect(outcome).toEqual({ status: 'completed', result });
    expect(controller.phase).toBe('done');
    expect(controller.result).toBe(result);
    expect(controller.lastError).toBeNull();
    expect(controller.progress).toBeNull();
  });

  it('records a failed run without a result', async () => {
    const controller = createController({
      operations: operations({ syncSingle: vi.fn().mockRejectedValue(new Error('Anki is busy')) }),
    });

    await controller.connect();
    const outcome = await controller.runSync();

    expect(outcome).toEqual({ status: 'failed', message: 'Anki is busy' });
    expect(controller.phase).toBe('failed');
    expect(controller.result).toBeNull();
    expect(controller.lastError).toBe('Anki is busy');
    expect(controller.canSync).toBe(true);
  });

  it('reports progress and marks a run cancelled before the last card', async () => {
    const syncSingle = vi.fn().mockImplementation((request: { runOptions: SyncRunOptions }) => {
      request.runOptions.onProgress?.(1, 3);
      if (request.runOptions.abort) request.runOptions.abort.cancelled = true;
      return Promise.resolve({ cards: [] });
    });
    const controller = createController({ operations: operations({ syncSingle }) });

    await controller.connect();
    await controller.runSync();

    expect(controller.processed).toBe(1);
    expect(controller.total).toBe(3);
    expect(controller.progress).toEqual({ done: 1, total: 3, cancelled: true });
  });

  it('treats a cancel after the last card as a completed run', async () => {
    const syncSingle = vi.fn().mockImplementation((request: { runOptions: SyncRunOptions }) => {
      request.runOptions.onProgress?.(3, 3);
      if (request.runOptions.abort) request.runOptions.abort.cancelled = true;
      return Promise.resolve({ cards: [] });
    });
    const controller = createController({ operations: operations({ syncSingle }) });

    await controller.connect();
    await controller.runSync();

    expect(controller.progress).toBeNull();
    expect(controller.phase).toBe('done');
  });

  it('exposes cancellation while the run is in flight', async () => {
    let release: ((result: SyncResult) => void) | undefined;
    const syncSingle = vi.fn().mockImplementation(
      (request: { runOptions: SyncRunOptions }) =>
        new Promise<SyncResult>((resolve) => {
          request.runOptions.onProgress?.(0, 2);
          release = resolve;
        })
    );
    const controller = createController({ operations: operations({ syncSingle }) });

    await controller.connect();
    const run = controller.runSync();
    await vi.waitFor(() => expect(syncSingle).toHaveBeenCalled());

    expect(controller.isRunning).toBe(true);
    expect(controller.canSync).toBe(false);

    controller.cancelSync();
    expect(controller.isCancelling).toBe(true);

    release?.({ cards: [] });
    await run;
    expect(controller.phase).toBe('done');
  });

  it('does not start a second run while one is in flight', async () => {
    let release: ((result: SyncResult) => void) | undefined;
    const syncSingle = vi.fn().mockImplementation(
      () =>
        new Promise<SyncResult>((resolve) => {
          release = resolve;
        })
    );
    const controller = createController({ operations: operations({ syncSingle }) });

    await controller.connect();
    const run = controller.runSync();
    await vi.waitFor(() => expect(syncSingle).toHaveBeenCalled());

    expect(await controller.runSync()).toEqual({ status: 'busy' });
    expect(syncSingle).toHaveBeenCalledTimes(1);

    release?.({ cards: [] });
    await run;
  });

  it('reports nothing to sync for a note without cards or deletions', async () => {
    const syncSingle = vi.fn().mockResolvedValue({ cards: [] });
    const controller = new SyncModalController({
      context: createSyncContext([], 'fresh.md', 'No cards at all'),
      operations: operations({
        analyzeSingle: vi.fn().mockResolvedValue(analysis()),
        syncSingle,
      }),
      confirmDeletion: vi.fn().mockResolvedValue(true),
    });

    await controller.connect();
    const outcome = await controller.runSync();

    expect(outcome).toEqual({ status: 'nothing-to-sync' });
    expect(syncSingle).not.toHaveBeenCalled();
  });

  it('syncs an emptied note that only has deletions', async () => {
    const syncSingle = vi.fn().mockResolvedValue({ cards: [] });
    const controller = new SyncModalController({
      context: createSyncContext([], 'mine.md', ''),
      operations: operations({
        analyzeSingle: vi.fn().mockResolvedValue(analysis({ cardsToDelete: [deletion(11)] })),
        syncSingle,
      }),
      confirmDeletion: vi.fn().mockResolvedValue(true),
    });

    await controller.connect();
    await controller.runSync();

    expect(syncSingle).toHaveBeenCalledTimes(1);
  });
});
