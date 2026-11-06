import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, findByClass, findByTagAndText, textOf } from './fakeDom';

const { notices } = vi.hoisted(() => ({ notices: [] as string[] }));

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {
    contentEl = new FakeEl();
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
  setIcon: () => undefined,
}));

vi.mock('../src/main', () => ({ default: class {} }));

import { Modal } from 'obsidian';
import { SyncModal } from '../src/dialogs/SyncModal';
import { PreviewModal } from '../src/dialogs/PreviewModal';
import { ConfirmDeleteModal, describeDeleteConfirmation } from '../src/dialogs/ConfirmDeleteModal';
import {
  DEFAULT_SETTINGS,
  createBatchSyncContext,
  createSyncContext,
  type AnkiConnectionState,
  type BatchSyncContext,
  type CardSyncInfo,
  type SyncAnalysis,
  type SyncContext,
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

function card(question: string): CardSyncInfo {
  return { card: { question, answer: 'Answer' }, deckName: 'Default' };
}

function deletion(id: string, notePath?: string, externallyEdited = false): CardSyncInfo {
  return {
    card: { question: 'Removed question', answer: 'Removed answer' },
    deckName: 'Default',
    existingCardId: id,
    notePath,
    externallyEdited,
  };
}

interface PluginStubOptions {
  context?: SyncContext;
  connections?: AnkiConnectionState[];
  singleAnalysis?: SyncAnalysis;
  batchAnalysis?: SyncAnalysis;
}

function pluginStub(options: PluginStubOptions = {}) {
  const context = options.context ?? createSyncContext([], 'mine.md', '');
  const connections = options.connections ?? [{ status: 'ok', version: 6 }];
  let connectionIndex = 0;
  return {
    settings: { ...DEFAULT_SETTINGS, useNoteBased: false },
    manifest: { id: 'panda-zap' },
    captureSyncContext: vi.fn(() => context),
    testAnkiConnectionStatus: vi.fn(() =>
      Promise.resolve(connections[Math.min(connectionIndex++, connections.length - 1)])
    ),
    analyzeSyncOperation: vi.fn(() => Promise.resolve(options.singleAnalysis ?? analysis())),
    analyzeBatchSyncOperation: vi.fn(() => Promise.resolve(options.batchAnalysis ?? analysis())),
    syncCardsToAnki: vi.fn(() => Promise.resolve<SyncResult>({ cards: [] })),
    syncBatchCards: vi.fn(() => Promise.resolve<SyncResult>({ cards: [] })),
    clearActiveSyncModal: vi.fn(),
  };
}

function content(modal: SyncModal): FakeEl {
  return modal.contentEl as unknown as FakeEl;
}

async function openModal(
  plugin: ReturnType<typeof pluginStub>,
  batchContext?: BatchSyncContext
): Promise<SyncModal> {
  const modal = new SyncModal({} as never, plugin as never, batchContext);
  await modal.onOpen();
  return modal;
}

function clickButton(root: FakeEl, text: string): void {
  const button = findByTagAndText(root, 'button', text);
  if (!button) throw new Error(`button "${text}" not found`);
  button.onclick?.();
}

/**
 * A rendered section, by its header. Kept short so the view assertions stay
 * about behaviour rather than the fake element tree.
 */
function sections(root: FakeEl): FakeEl[] {
  return findByClass(root, 'panda-zap-section-header');
}

describe('SyncModal view', () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it('renders the connection status, summary and buttons from the controller', async () => {
    const plugin = pluginStub({
      context: createSyncContext([{ question: 'Q', answer: 'A' }], 'mine.md'),
      singleAnalysis: analysis({ cardsToAdd: [card('Added')], cardsToDelete: [deletion('11')] }),
    });

    const modal = await openModal(plugin);

    expect(modal.controller.phase).toBe('ready');
    const rendered = textOf(content(modal));
    expect(rendered).toContain('Connected to Anki');
    expect(rendered).toContain('Summary');
    expect(
      findByClass(content(modal), 'panda-zap-pill-number').map((pill) => pill.textContent)
    ).toEqual(['1', '0', '1']);
    expect(findByTagAndText(content(modal), 'button', 'Sync to Anki')?.disabled).toBe(false);
    expect(findByTagAndText(content(modal), 'button', 'Preview changes')?.disabled).toBe(false);
  });

  it('repairs a failed connection in the existing modal instead of rebuilding it', async () => {
    const plugin = pluginStub({
      context: createSyncContext([], 'mine.md', ''),
      connections: [{ status: 'unreachable' }, { status: 'ok', version: 6 }],
    });
    const modal = await openModal(plugin);
    const element = content(modal);

    expect(modal.controller.phase).toBe('failed');
    expect(textOf(element)).toContain('Not connected to Anki');
    expect(findByTagAndText(element, 'button', 'Test connection')).toBeDefined();

    clickButton(element, 'Test connection');
    await vi.waitFor(() => expect(modal.controller.phase).toBe('ready'));

    expect(notices).toContain('Connected to Anki!');
    expect(textOf(element)).toContain('Connected to Anki');
    expect(findByTagAndText(element, 'button', 'Sync to Anki')).toBeDefined();
    expect(content(modal)).toBe(element);
    expect(plugin.analyzeSyncOperation).toHaveBeenCalledTimes(1);
  });

  it('disables the sync action and blocks closing while a run is in flight', async () => {
    const plugin = pluginStub({
      context: createSyncContext([{ question: 'Q', answer: 'A' }], 'mine.md'),
    });
    let release: ((result: SyncResult) => void) | undefined;
    plugin.syncCardsToAnki.mockImplementation(
      () =>
        new Promise<SyncResult>((resolve) => {
          release = resolve;
        })
    );
    const modal = await openModal(plugin);
    const closeSpy = vi.spyOn(Modal.prototype, 'close');

    clickButton(content(modal), 'Sync to Anki');
    await vi.waitFor(() => expect(plugin.syncCardsToAnki).toHaveBeenCalled());

    expect(modal.controller.phase).toBe('syncing');
    expect(modal.controller.canSync).toBe(false);
    expect(findByClass(content(modal), 'panda-zap-button-container')[0].classes.has('hidden')).toBe(
      true
    );
    expect(findByTagAndText(content(modal), 'button', 'Sync to Anki')).toBeUndefined();
    expect(findByTagAndText(content(modal), 'button', 'Cancel')).toBeDefined();
    expect(textOf(content(modal))).toContain('Syncing...');

    modal.close();
    expect(notices).toContain('Cancel the sync first');
    expect(closeSpy).not.toHaveBeenCalled();

    release?.({ cards: [] });
    await vi.waitFor(() => expect(modal.controller.phase).toBe('done'));
    expect(textOf(content(modal))).toContain('Sync results');
  });

  it('confirms deletions before syncing a note', async () => {
    const context = createSyncContext([], 'mine.md', 'Nothing left here');
    const plugin = pluginStub({
      context,
      singleAnalysis: analysis({ cardsToDelete: [deletion('11')] }),
    });
    const confirm = vi.spyOn(ConfirmDeleteModal.prototype, 'confirm').mockResolvedValue(true);
    const modal = await openModal(plugin);

    clickButton(content(modal), 'Sync to Anki');
    await vi.waitFor(() => expect(plugin.syncCardsToAnki).toHaveBeenCalled());

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(plugin.syncCardsToAnki).toHaveBeenCalledWith(
      true,
      context,
      ['11'],
      expect.objectContaining({
        abort: expect.objectContaining({ cancelled: false }) as SyncRunOptions['abort'],
        onProgress: expect.any(Function) as SyncRunOptions['onProgress'],
      })
    );
  });

  it('closes and reports a note that has nothing to sync', async () => {
    const plugin = pluginStub({ context: createSyncContext([], 'fresh.md', 'No cards at all') });
    const modal = await openModal(plugin);
    const closeSpy = vi.spyOn(Modal.prototype, 'close');

    clickButton(content(modal), 'Sync to Anki');
    await vi.waitFor(() => expect(notices).toContain('No Q: A: cards found in current note'));

    expect(closeSpy).toHaveBeenCalled();
    expect(plugin.syncCardsToAnki).not.toHaveBeenCalled();
  });

  it('keeps a batch with nothing to sync open', async () => {
    const batchContext = createBatchSyncContext(
      new Map([['one.md', createSyncContext([], 'one.md', '')]])
    );
    const plugin = pluginStub({});
    const modal = await openModal(plugin, batchContext);
    const closeSpy = vi.spyOn(Modal.prototype, 'close');

    clickButton(content(modal), 'Sync to Anki');
    await vi.waitFor(() => expect(notices).toContain('No cards found in selected notes'));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(plugin.syncBatchCards).not.toHaveBeenCalled();
  });

  it('renders the skipped results in a keyboard-operable collapsible section', async () => {
    const result: SyncResult = {
      cards: [{ card: { question: 'Q', answer: 'A' }, status: 'skipped-existing' }],
    };
    const plugin = pluginStub({
      context: createSyncContext([{ question: 'Q', answer: 'A' }], 'mine.md'),
    });
    plugin.syncCardsToAnki.mockResolvedValue(result);
    const modal = await openModal(plugin);

    clickButton(content(modal), 'Sync to Anki');
    await vi.waitFor(() => expect(modal.controller.phase).toBe('done'));

    const [header] = sections(content(modal));
    expect(header).toBeDefined();
    expect(header.getAttr('role')).toBe('button');
    expect(header.getAttr('tabindex')).toBe('0');
    expect(header.getAttr('aria-expanded')).toBe('false');
    expect(textOf(header)).toContain('Skipped (1)');

    const skippedList = findByClass(content(modal), 'panda-zap-skipped-list')[0];
    expect(skippedList.classList.contains('hidden')).toBe(true);

    const preventDefault = vi.fn();
    header.onkeydown?.({ key: 'Enter', preventDefault } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(header.getAttr('aria-expanded')).toBe('true');
    expect(skippedList.classList.contains('hidden')).toBe(false);
    expect(skippedList.classList.contains('expanded')).toBe(true);
  });

  it('clears the active modal when it closes', () => {
    const plugin = pluginStub({});
    const modal = new SyncModal({} as never, plugin as never);

    modal.onClose();

    expect(plugin.clearActiveSyncModal).toHaveBeenCalledWith(modal);
  });
});

describe('ConfirmDeleteModal wording', () => {
  it('names the note count only when several notes are affected', () => {
    expect(describeDeleteConfirmation({ count: 2, editedCount: 0 })).toBe(
      'This will delete 2 cards from Anki that were removed from this note. Proceed?'
    );
    expect(describeDeleteConfirmation({ count: 2, noteCount: 1, editedCount: 0 })).toBe(
      'This will delete 2 cards from Anki that were removed from this note. Proceed?'
    );
    expect(describeDeleteConfirmation({ count: 2, noteCount: 3, editedCount: 0 })).toBe(
      'This will delete 2 cards from 3 notes that were removed from your notes. Proceed?'
    );
  });

  it('warns about cards that changed in Anki', () => {
    expect(describeDeleteConfirmation({ count: 2, noteCount: 3, editedCount: 1 })).toBe(
      'This will delete 2 cards from 3 notes that were removed from your notes. 1 of these cards were changed in Anki and will be deleted. Proceed?'
    );
  });
});

describe('PreviewModal collapsible sections', () => {
  it('renders expanded, accessible sections and toggles them', () => {
    const modal = new PreviewModal(
      {} as never,
      analysis({ cardsToAdd: [card('Added')] }),
      DEFAULT_SETTINGS
    );
    modal.onOpen();
    const element = modal.contentEl as unknown as FakeEl;

    const [header] = sections(element);
    expect(header.getAttr('role')).toBe('button');
    expect(header.getAttr('tabindex')).toBe('0');
    expect(header.getAttr('aria-expanded')).toBe('true');
    expect(textOf(header)).toContain('📝 Cards to Add (1)');

    header.onclick?.();

    expect(header.getAttr('aria-expanded')).toBe('false');
    const cardsContainer = findByClass(element, 'panda-zap-cards-container')[0];
    expect(cardsContainer.classList.contains('collapsed')).toBe(true);
    expect(cardsContainer.classList.contains('hidden')).toBe(true);
  });
});
