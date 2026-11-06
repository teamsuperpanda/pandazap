import { Plugin, MarkdownView, TFile, Notice } from 'obsidian';
import { SyncModal } from './dialogs/SyncModal';
import { PandaZapSettingTab } from './dialogs/SettingsTab';
import { AnkiConnector } from './sync/AnkiConnector';
import { CardExtractor } from './sync/CardExtractor';
import {
  PandaZapSettings,
  AnkiCard,
  SyncAnalysis,
  SyncContext,
  CardSyncInfo,
  BatchSyncContext,
  createSyncContext,
  createBatchSyncContext,
  SyncResult,
  SyncRunOptions,
  AnkiConnectionState,
  describeConnection,
} from './sync/types';
import { extractQACardsFromText } from './sync/extractionUtils';
import { ANKI_CONNECT_VERSION } from './constants';
import { normalizeSettings } from './settings';

export default class PandaZapPlugin extends Plugin {
  settings: PandaZapSettings;
  private ankiConnector: AnkiConnector;
  private cardExtractor: CardExtractor;
  private settingsSaveQueue: Promise<void> = Promise.resolve();
  private activeSyncModal: SyncModal | null = null;

  async onload() {
    await this.loadSettings();

    this.ankiConnector = new AnkiConnector(this.settings, this.app);
    this.cardExtractor = new CardExtractor(this.app, this.settings);

    this.addRibbonIcon('zap', 'Sync notes to Anki', () => {
      void this.openSyncDialog();
    });

    this.addCommand({
      id: 'sync',
      name: 'Open sync dialog',
      callback: () => {
        void this.openSyncDialog();
      },
    });

    this.addCommand({
      id: 'sync-selected-notes',
      name: 'Sync selected notes to Anki',
      callback: () => {
        void this.handleSyncSelectedNotes();
      },
    });

    this.addCommand({
      id: 'sync-all-notes',
      name: 'Sync all notes to Anki',
      callback: () => {
        const paths = this.app.vault.getMarkdownFiles().map((f) => f.path);
        // An untouched note with no cards can only be skipped here: checking
        // every empty note against Anki would mean one lookup per note.
        void this.openBatchSyncDialog(paths, false);
      },
    });

    this.addSettingTab(new PandaZapSettingTab(this.app, this));

    this.registerMarkdownPostProcessor((element, _context) => {
      this.cardExtractor.processQACards(element, this);
    });
  }

  openSyncDialog() {
    if (this.activeSyncModal) {
      this.reportSyncDialogOpen();
      return;
    }
    this.showSyncModal(new SyncModal(this.app, this));
  }

  async openBatchSyncDialog(notePaths: string[], includeEmptyNotes = true): Promise<void> {
    if (this.activeSyncModal) {
      this.reportSyncDialogOpen();
      return;
    }
    const bContext = await this.captureBatchSyncContext(notePaths, includeEmptyNotes);
    if (bContext.contexts.size === 0) {
      new Notice('No Markdown notes with cards found');
      return;
    }
    this.showSyncModal(new SyncModal(this.app, this, bContext));
  }

  /**
   * Opens a sync dialog, unless one is already open. A second command reuses
   * the open dialog instead of starting a second, concurrent run.
   */
  showSyncModal(modal: SyncModal): void {
    if (this.activeSyncModal) {
      this.reportSyncDialogOpen();
      return;
    }
    this.activeSyncModal = modal;
    modal.open();
  }

  /** Called by the modal on close, so the next command can open a dialog. */
  clearActiveSyncModal(modal: SyncModal): void {
    if (this.activeSyncModal === modal) this.activeSyncModal = null;
  }

  private reportSyncDialogOpen(): void {
    new Notice('A sync dialog is already open. Close it before starting another sync.');
  }

  private getSelectedNotePaths(): string[] {
    // Try FileExplorer view's getSelectedFiles API
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    for (const leaf of leaves) {
      const view = leaf.view as unknown as { getSelectedFiles?: () => unknown };
      if (typeof view.getSelectedFiles === 'function') {
        const selected: unknown = view.getSelectedFiles();
        if (selected instanceof Set) {
          return [...selected]
            .filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
            .map((f) => f.path);
        }
        if (Array.isArray(selected)) {
          return selected
            .filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
            .map((f) => f.path);
        }
      }
    }

    // DOM fallback: query highlighted file items
    const paths: string[] = [];
    activeDocument.querySelectorAll('.nav-file.is-selected').forEach((el) => {
      const path = el.getAttribute('data-path');
      if (path && path.endsWith('.md')) paths.push(path);
    });
    return paths;
  }

  private async handleSyncSelectedNotes(): Promise<void> {
    const paths = this.getSelectedNotePaths();
    if (paths.length > 0) {
      await this.openBatchSyncDialog(paths);
    } else {
      new Notice('No files selected in file explorer');
    }
  }

  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }

  saveSettings(): Promise<void> {
    // Rejected in-memory values (a port typed as 70000, an empty note type) must
    // never reach disk, and memory must keep matching what disk holds.
    this.settings = normalizeSettings(this.settings);
    const settingsSnapshot = { ...this.settings };
    const saveAttempt = this.settingsSaveQueue.then(() => this.saveData(settingsSnapshot));

    // Keep later saves moving after a failure and handle ignored promises from
    // settings controls. Callers that await this attempt still receive the error.
    this.settingsSaveQueue = saveAttempt.catch((error: unknown) => {
      console.error('Failed to save Panda Zap settings', error);
    });

    return saveAttempt;
  }

  async testAnkiConnectionStatus(): Promise<AnkiConnectionState> {
    this.ankiConnector.updateSettings(this.settings);
    return this.ankiConnector.testConnection();
  }

  async testAnkiConnection(): Promise<boolean> {
    return (await this.testAnkiConnectionStatus()).status === 'ok';
  }

  captureSyncContext(): SyncContext {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return createSyncContext([]);

    const noteContent = activeView.editor.getValue();
    const notePath = activeView.file?.path;
    const cards = extractQACardsFromText(noteContent, this.settings);
    return createSyncContext(cards, notePath, noteContent);
  }

  async captureBatchSyncContext(
    notePaths: string[],
    includeEmptyNotes = true
  ): Promise<BatchSyncContext> {
    const captured = await Promise.all(
      notePaths.map(async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        const content = await this.app.vault.read(file);
        const cards = extractQACardsFromText(content, this.settings);
        if (cards.length === 0 && !includeEmptyNotes) return null;
        return createSyncContext(cards, path, content);
      })
    );
    const contexts = new Map<string, SyncContext>();
    captured.forEach((context, i) => {
      if (context) contexts.set(notePaths[i], context);
    });
    return createBatchSyncContext(contexts);
  }

  async analyzeBatchSyncOperation(bContext: BatchSyncContext): Promise<SyncAnalysis> {
    this.ankiConnector.updateSettings(this.settings);
    const connection = await this.ankiConnector.testConnection();
    if (connection.status !== 'ok') {
      throw new Error(describeConnection(connection, ANKI_CONNECT_VERSION));
    }
    const allCardsToAdd: CardSyncInfo[] = [];
    const allCardsToUpdate: CardSyncInfo[] = [];
    const allCardsToDelete: CardSyncInfo[] = [];
    let totalCards = 0;

    for (const [notePath, context] of bContext.contexts) {
      const analysis = await this.ankiConnector.analyzeSyncOperation(
        context.cards,
        context.notePath,
        context.noteContent,
        true
      );
      totalCards += analysis.totalCards;
      const tag = (items: CardSyncInfo[]) =>
        items.forEach((info) => {
          info.notePath = notePath;
        });
      tag(analysis.cardsToAdd);
      tag(analysis.cardsToUpdate);
      tag(analysis.cardsToDelete);
      allCardsToAdd.push(...analysis.cardsToAdd);
      allCardsToUpdate.push(...analysis.cardsToUpdate);
      allCardsToDelete.push(...analysis.cardsToDelete);
    }

    return {
      cardsToAdd: allCardsToAdd,
      cardsToUpdate: allCardsToUpdate,
      cardsToDelete: allCardsToDelete,
      totalCards,
    };
  }

  async syncBatchCards(
    bContext: BatchSyncContext,
    preview: boolean = false,
    deleteConfirmed: boolean = false,
    confirmedDeletionIdsByNote?: ReadonlyMap<string, readonly string[]>,
    runOptions?: SyncRunOptions
  ): Promise<SyncResult> {
    this.ankiConnector.updateSettings(this.settings);
    const connection = await this.ankiConnector.testConnection();
    if (connection.status !== 'ok') {
      throw new Error(describeConnection(connection, ANKI_CONNECT_VERSION));
    }
    const result: SyncResult = { cards: [] };
    const totalCards = bContext.totalCards;
    const onProgress = runOptions?.onProgress;
    const abort = runOptions?.abort;

    try {
      let noteStart = 0;
      for (const [notePath, context] of bContext.contexts) {
        if (abort?.cancelled) break;
        // Progress is reported per note, so the offsets keep it cumulative for
        // the whole batch.
        const base = noteStart;
        const noteOptions: SyncRunOptions | undefined =
          onProgress || abort
            ? {
                abort,
                onProgress: onProgress
                  ? (done: number) => {
                      onProgress(base + done, totalCards);
                    }
                  : undefined,
              }
            : undefined;
        // A note with no confirmed deletions must receive an explicit empty list.
        // Passing undefined would let the connector re-analyse and delete notes
        // the user never saw in the confirmation.
        const confirmedDeletionIds = confirmedDeletionIdsByNote
          ? (confirmedDeletionIdsByNote.get(notePath) ?? [])
          : undefined;
        const noteResult = await this.ankiConnector.syncCards(
          context.cards,
          preview,
          notePath,
          context.noteContent,
          deleteConfirmed,
          confirmedDeletionIds,
          true,
          noteOptions
        );
        result.cards.push(...noteResult.cards);
        if (noteResult.deletion) {
          const previous = result.deletion;
          result.deletion = {
            deletedCount: (previous?.deletedCount ?? 0) + noteResult.deletion.deletedCount,
            failed: Boolean(previous?.failed) || noteResult.deletion.failed,
            reason:
              [previous?.reason, noteResult.deletion.reason].filter(Boolean).join('; ') ||
              undefined,
          };
        }
        noteStart += context.cards.length;
      }

      return result;
    } finally {
      // One refresh for the whole batch, even when a note throws.
      this.ankiConnector.invalidateCache();
    }
  }

  async analyzeSyncOperation(context?: SyncContext): Promise<SyncAnalysis> {
    this.ankiConnector.updateSettings(this.settings);

    const syncContext = context ?? this.captureSyncContext();
    return this.ankiConnector.analyzeSyncOperation(
      syncContext.cards,
      syncContext.notePath,
      syncContext.noteContent
    );
  }

  extractCardsFromCurrentNote(): AnkiCard[] {
    return this.cardExtractor.extractCardsFromCurrentNote();
  }

  async syncCardsToAnki(
    preview: boolean = false,
    deleteConfirmed: boolean = false,
    context?: SyncContext,
    confirmedDeletionIds?: readonly string[],
    runOptions?: SyncRunOptions
  ): Promise<SyncResult> {
    this.ankiConnector.updateSettings(this.settings);
    const syncContext = context ?? this.captureSyncContext();
    try {
      return await this.ankiConnector.syncCards(
        syncContext.cards,
        preview,
        syncContext.notePath,
        syncContext.noteContent,
        deleteConfirmed,
        confirmedDeletionIds,
        false,
        runOptions
      );
    } finally {
      // A sync run writes notes, so re-read Anki on the next user action.
      this.ankiConnector.invalidateCache();
    }
  }
}
