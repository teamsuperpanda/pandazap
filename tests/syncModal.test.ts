import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notices } = vi.hoisted(() => ({ notices: [] as string[] }));

vi.mock('obsidian', () => ({
  App: class {},
  setIcon: vi.fn(),
  Modal: class {
    contentEl = { querySelector: () => null, empty: () => undefined };
    open() {
      // no-op
    }
    close() {
      // no-op
    }
  },
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
}));

vi.mock('../src/main', () => ({ default: class {} }));

import { SyncModal } from '../src/dialogs/SyncModal';
import { Modal } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  createBatchSyncContext,
  createSyncContext,
  type BatchSyncContext,
  type CardSyncInfo,
  type SyncAnalysis,
  type SyncContext,
  type SyncRunOptions,
} from '../src/sync/types';

type ModalInternals = {
  performSingleSync(): Promise<void>;
  performBatchSync(context: BatchSyncContext): Promise<void>;
  showDeleteConfirmation(count: number, noteCount?: number): Promise<boolean>;
  close(): void;
};

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

function pluginStub(
  context: SyncContext,
  singleAnalysis: SyncAnalysis,
  batchAnalysis: SyncAnalysis
) {
  return {
    settings: { ...DEFAULT_SETTINGS, useNoteBased: false },
    captureSyncContext: vi.fn(() => context),
    analyzeSyncOperation: vi.fn().mockResolvedValue(singleAnalysis),
    syncCardsToAnki: vi.fn().mockResolvedValue({ cards: [] }),
    analyzeBatchSyncOperation: vi.fn().mockResolvedValue(batchAnalysis),
    syncBatchCards: vi.fn().mockResolvedValue({ cards: [] }),
    showSyncModal: vi.fn(),
    clearActiveSyncModal: vi.fn(),
  };
}

function createModal(
  plugin: ReturnType<typeof pluginStub>,
  batchContext?: BatchSyncContext
): ModalInternals {
  return new SyncModal({} as never, plugin as never, batchContext) as unknown as ModalInternals;
}

describe('SyncModal deletion handling', () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it('confirms and deletes the cards of a note that was emptied', async () => {
    const context = createSyncContext([], 'mine.md', 'Nothing left here');
    const plugin = pluginStub(context, analysis({ cardsToDelete: [deletion(11)] }), analysis());
    const modal = createModal(plugin);
    const confirm = vi.spyOn(modal, 'showDeleteConfirmation').mockResolvedValue(true);

    await modal.performSingleSync();

    expect(confirm).toHaveBeenCalledWith(1, undefined, 0);
    expect(plugin.syncCardsToAnki).toHaveBeenCalledWith(
      true,
      context,
      [11],
      // The casts are type-only: expect.objectContaining returns any, which the
      // nested-matcher rule rejects inside objectContaining's generic parameter.
      expect.objectContaining({
        abort: expect.objectContaining({ cancelled: false }) as SyncRunOptions['abort'],
        onProgress: expect.any(Function) as SyncRunOptions['onProgress'],
      })
    );
  });

  it('shows the no-cards notice for a note that was never synced', async () => {
    const context = createSyncContext([], 'fresh.md', 'No cards at all');
    const plugin = pluginStub(context, analysis(), analysis());
    const modal = createModal(plugin);
    const close = vi.spyOn(modal, 'close');

    await modal.performSingleSync();

    expect(notices).toContain('No Q: A: cards found in current note');
    expect(close).toHaveBeenCalled();
    expect(plugin.syncCardsToAnki).not.toHaveBeenCalled();
  });

  it('flags externally edited cards in the deletion confirmation', async () => {
    const context = createSyncContext([], 'mine.md', 'Nothing left here');
    const plugin = pluginStub(
      context,
      analysis({ cardsToDelete: [deletion(11, undefined, true)] }),
      analysis()
    );
    const modal = createModal(plugin);
    const confirm = vi.spyOn(modal, 'showDeleteConfirmation').mockResolvedValue(true);

    await modal.performSingleSync();

    expect(confirm).toHaveBeenCalledWith(1, undefined, 1);
  });

  it('aborts without syncing when the deletion is not confirmed', async () => {
    const context = createSyncContext([], 'mine.md', '');
    const plugin = pluginStub(context, analysis({ cardsToDelete: [deletion(11)] }), analysis());
    const modal = createModal(plugin);
    vi.spyOn(modal, 'showDeleteConfirmation').mockResolvedValue(false);

    await modal.performSingleSync();

    expect(plugin.syncCardsToAnki).not.toHaveBeenCalled();
  });

  it('deletes the cards of an emptied note in a selected batch', async () => {
    const batchContext = createBatchSyncContext(
      new Map([['one.md', createSyncContext([], 'one.md', '')]])
    );
    const plugin = pluginStub(
      createSyncContext([]),
      analysis(),
      analysis({ cardsToDelete: [deletion(11, 'one.md')] })
    );
    const modal = createModal(plugin, batchContext);
    const confirm = vi.spyOn(modal, 'showDeleteConfirmation').mockResolvedValue(true);

    await modal.performBatchSync(batchContext);

    expect(confirm).toHaveBeenCalledWith(1, 1, 0);
    const [, deleteConfirmed, idsByNote] = plugin.syncBatchCards.mock.calls[0] as [
      BatchSyncContext,
      boolean,
      ReadonlyMap<string, readonly string[]>,
    ];
    expect(deleteConfirmed).toBe(true);
    expect([...idsByNote.entries()]).toEqual([['one.md', [11]]]);
  });

  it('does not sync a selected batch with no cards and no deletions', async () => {
    const batchContext = createBatchSyncContext(
      new Map([['one.md', createSyncContext([], 'one.md', '')]])
    );
    const plugin = pluginStub(createSyncContext([]), analysis(), analysis());
    const modal = createModal(plugin, batchContext);

    await modal.performBatchSync(batchContext);

    expect(notices).toContain('No cards found in selected notes');
    expect(plugin.syncBatchCards).not.toHaveBeenCalled();
  });

  it('blocks closing while a sync is running', async () => {
    const context = createSyncContext([{ question: 'Q', answer: 'A' }], 'mine.md');
    const plugin = pluginStub(context, analysis(), analysis());
    let release: (() => void) | undefined;
    plugin.syncCardsToAnki.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ cards: [] });
        })
    );
    const modal = createModal(plugin);
    const closeSpy = vi.spyOn(Modal.prototype, 'close');

    const run = modal.performSingleSync();
    await vi.waitFor(() => expect(plugin.syncCardsToAnki).toHaveBeenCalled());

    modal.close();

    expect(notices).toContain('Cancel the sync first');
    expect(closeSpy).not.toHaveBeenCalled();

    release?.();
    await run;
  });

  it('does not start a sync once the modal closed', async () => {
    const context = createSyncContext([{ question: 'Q', answer: 'A' }], 'mine.md');
    const plugin = pluginStub(context, analysis(), analysis());
    const modal = createModal(plugin);
    (modal as unknown as { closed: boolean }).closed = true;

    await modal.performSingleSync();

    expect(plugin.syncCardsToAnki).not.toHaveBeenCalled();
  });

  it('clears the active modal when it closes', () => {
    const plugin = pluginStub(createSyncContext([]), analysis(), analysis());
    const modal = new SyncModal({} as never, plugin as never);

    (modal as unknown as { onClose(): void }).onClose();

    expect(plugin.clearActiveSyncModal).toHaveBeenCalledWith(modal);
  });
});
