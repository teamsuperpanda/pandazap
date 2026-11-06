import { Modal, App, Notice } from 'obsidian';
import PandaZapPlugin from '../main';
import {
  SyncAnalysis,
  SyncContext,
  BatchSyncContext,
  createSyncContext,
  SyncResult,
  AnkiConnectionState,
  describeConnection,
  describeSyncModalStatus,
  formatSyncCardResult,
} from '../sync/types';
import { ANKI_CONNECT_VERSION } from '../constants';
import { PreviewModal } from './PreviewModal';
import { markerLabels } from '../settings';

// Interface to properly type the App's setting property
interface AppWithSetting extends App {
  setting: {
    open(): void;
    openTabById(id: string): void;
  };
}

export class SyncModal extends Modal {
  plugin: PandaZapPlugin;
  private syncAnalysis: SyncAnalysis | null = null;
  private connection: AnkiConnectionState | null = null;
  private analysisError: string | null = null;
  private isSyncing: boolean = false;
  private readonly syncContext: SyncContext;
  private readonly batchSyncContext?: BatchSyncContext;
  private readonly isBatchMode: boolean;

  constructor(app: App, plugin: PandaZapPlugin, batchContext?: BatchSyncContext) {
    super(app);
    this.plugin = plugin;
    this.batchSyncContext = batchContext;
    this.isBatchMode = batchContext !== undefined;
    this.syncContext = this.isBatchMode
      ? createSyncContext([], undefined, undefined)
      : plugin.captureSyncContext();
  }

  private get isConnected(): boolean {
    return this.connection?.status === 'ok';
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('panda-zap-sync-modal');

    const header = contentEl.createDiv('panda-zap-header');

    const gearBtn = contentEl.createEl('button', { cls: 'panda-zap-settings-gear', text: '⚙️' });
    gearBtn.setAttr('aria-label', 'Open Panda Zap settings');
    gearBtn.setAttr('title', 'Open plugin settings');
    gearBtn.onclick = () => this.openSettings();

    header.createEl('h2', { text: 'Panda Zap' });

    // Render status and action containers immediately
    const statusContainer = contentEl.createDiv('panda-zap-status-container');
    contentEl.createDiv('panda-zap-summary');
    contentEl.createDiv('panda-zap-button-container');
    contentEl.createDiv('panda-zap-results hidden');

    // Show initial loading state
    const loadingDiv = statusContainer.createDiv('panda-zap-status-minimal');
    loadingDiv.createSpan({ text: 'Connecting to Anki...', cls: 'panda-zap-status-text' });

    // The connection check classifies its own failures, so keep the state as
    // returned. Analysis failures are tracked separately and must not be
    // reported as a connection problem.
    this.connection = await this.plugin.testAnkiConnectionStatus();
    if (this.isConnected) {
      try {
        this.syncAnalysis = await this.runAnalysis();
      } catch (error: unknown) {
        this.analysisError = errorMessage(error);
      }
    }

    // Update UI
    this.renderUi();
  }

  private async runAnalysis(): Promise<SyncAnalysis> {
    if (this.isBatchMode && this.batchSyncContext) {
      return this.plugin.analyzeBatchSyncOperation(this.batchSyncContext);
    }
    return this.plugin.analyzeSyncOperation(this.syncContext);
  }

  private renderUi() {
    const statusContainer = this.contentEl.querySelector('.panda-zap-status-container');
    const summaryContainer = this.contentEl.querySelector('.panda-zap-summary');
    const buttonContainer = this.contentEl.querySelector('.panda-zap-button-container');
    if (statusContainer?.instanceOf(HTMLElement)) this.renderStatus(statusContainer);
    if (summaryContainer?.instanceOf(HTMLElement)) this.renderSyncSummary(summaryContainer);
    if (buttonContainer?.instanceOf(HTMLElement)) this.renderButtons(buttonContainer);
  }

  private renderStatus(statusContainer: HTMLElement) {
    statusContainer.empty();
    if (!this.connection) return;
    const status = describeSyncModalStatus(
      this.connection,
      this.analysisError,
      ANKI_CONNECT_VERSION
    );

    if (!this.isConnected) {
      const statusDiv = statusContainer.createDiv('panda-zap-status-minimal');
      statusDiv.createSpan({ cls: 'panda-zap-status-dot error' });
      statusDiv.createSpan({ text: status.title, cls: 'panda-zap-status-text error' });
      if (status.detail) {
        const detailDiv = statusContainer.createDiv('panda-zap-status-minimal');
        detailDiv.createSpan({ text: status.detail, cls: 'panda-zap-status-text' });
      }
      return;
    }

    const statusDiv = statusContainer.createDiv('panda-zap-status-minimal');
    statusDiv.createSpan({ cls: 'panda-zap-status-dot success' });
    statusDiv.createSpan({ text: status.title, cls: 'panda-zap-status-text success' });

    if (this.isBatchMode && this.batchSyncContext) {
      const batchInfo = statusContainer.createDiv('panda-zap-batch-info');
      const nNotes = this.batchSyncContext.notePaths.length;
      const nCards = this.batchSyncContext.totalCards;
      batchInfo.createSpan({
        text: `${nNotes} note${nNotes !== 1 ? 's' : ''} selected, ${nCards} card${nCards !== 1 ? 's' : ''} total`,
        cls: 'panda-zap-batch-stats',
      });
    }

    if (status.analysisError) {
      const errorDiv = statusContainer.createDiv('panda-zap-status-minimal');
      errorDiv.createSpan({ cls: 'panda-zap-status-dot error' });
      errorDiv.createSpan({ text: status.analysisError, cls: 'panda-zap-status-text error' });
    }
  }

  private renderSyncSummary(container: HTMLElement) {
    container.empty();
    if (!this.syncAnalysis) {
      if (this.isConnected) {
        const emptyState = container.createDiv('panda-zap-empty-state');
        emptyState.createSpan({ text: 'No sync analysis available' });
      }
      return;
    }
    const summary = container.createDiv('panda-zap-sync-summary');
    summary.createEl('h3', { text: 'Summary' });
    const pillsContainer = summary.createDiv('panda-zap-pills-container');
    const addPill = pillsContainer.createDiv('panda-zap-pill add');
    addPill.createSpan({
      text: this.syncAnalysis.cardsToAdd.length.toString(),
      cls: 'panda-zap-pill-number',
    });
    addPill.createSpan({ text: ' to add', cls: 'panda-zap-pill-label' });
    const updatePill = pillsContainer.createDiv('panda-zap-pill update');
    updatePill.createSpan({
      text: this.syncAnalysis.cardsToUpdate.length.toString(),
      cls: 'panda-zap-pill-number',
    });
    updatePill.createSpan({ text: ' to update', cls: 'panda-zap-pill-label' });
    const deletePill = pillsContainer.createDiv('panda-zap-pill delete');
    deletePill.createSpan({
      text: this.syncAnalysis.cardsToDelete.length.toString(),
      cls: 'panda-zap-pill-number',
    });
    deletePill.createSpan({ text: ' to remove', cls: 'panda-zap-pill-label' });
  }

  private renderButtons(container: HTMLElement) {
    container.empty();
    const buttonGroup = container.createDiv('panda-zap-button-group');
    if (!this.isConnected) {
      const testBtn = buttonGroup.createEl('button', {
        text: 'Test connection',
        cls: 'panda-zap-btn panda-zap-btn-secondary',
      });
      testBtn.onclick = async () => {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';
        const state = await this.plugin.testAnkiConnectionStatus();
        if (state.status === 'ok') {
          new Notice('Connected to Anki!');
          this.close();
          new SyncModal(this.app, this.plugin, this.batchSyncContext).open();
        } else {
          new Notice(describeConnection(state, ANKI_CONNECT_VERSION));
        }
        testBtn.disabled = false;
        testBtn.textContent = 'Test connection';
      };
    } else {
      const analysisFailed = this.analysisError !== null;
      if (analysisFailed) {
        const retryBtn = buttonGroup.createEl('button', {
          text: 'Retry analysis',
          cls: 'panda-zap-btn panda-zap-btn-secondary',
        });
        retryBtn.onclick = () => this.retryAnalysis(retryBtn);
      }
      const previewBtn = buttonGroup.createEl('button', {
        text: 'Preview changes',
        cls: 'panda-zap-btn panda-zap-btn-secondary',
      });
      previewBtn.disabled = analysisFailed;
      previewBtn.onclick = () => this.showPreview();
      const syncBtn = buttonGroup.createEl('button', {
        text: 'Sync to Anki',
        cls: 'panda-zap-btn panda-zap-btn-primary',
      });
      syncBtn.disabled = analysisFailed;
      syncBtn.onclick = () => this.performSync();
    }
  }

  private async retryAnalysis(button: HTMLButtonElement) {
    button.disabled = true;
    button.textContent = 'Analysing...';
    this.syncAnalysis = null;
    this.analysisError = null;
    try {
      this.syncAnalysis = await this.runAnalysis();
    } catch (error: unknown) {
      this.analysisError = errorMessage(error);
    }
    this.renderUi();
  }

  private showPreview() {
    if (!this.syncAnalysis) {
      new Notice('No analysis available');
      return;
    }
    let noteLabels: Map<string, string> | undefined;
    if (this.isBatchMode && this.batchSyncContext) {
      noteLabels = new Map(
        this.batchSyncContext.notePaths.map((p) => {
          const name = p.split('/').pop()?.replace(/\.md$/, '') ?? p;
          return [p, name] as [string, string];
        })
      );
    }
    new PreviewModal(this.app, this.syncAnalysis, this.plugin.settings, noteLabels).open();
  }

  // Show a styled Obsidian modal to confirm deletion, returns true if user confirms
  private showDeleteConfirmation(count: number, noteCount?: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const m = new Modal(this.app);
      let settled = false;
      const settle = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        resolve(confirmed);
      };
      m.onClose = () => settle(false);
      // Build content
      m.contentEl.addClass('panda-zap-delete-confirm');
      m.contentEl.createEl('h3', { text: 'Confirm deletion' });
      const msg = m.contentEl.createDiv('panda-zap-delete-msg');
      msg.textContent =
        noteCount && noteCount > 1
          ? `This will delete ${count} cards from ${noteCount} notes that were removed from your notes. Proceed?`
          : `This will delete ${count} cards from Anki that were removed from this note. Proceed?`;
      const btnRow = m.contentEl.createDiv('panda-zap-button-row');

      const cancel = btnRow.createEl('button', {
        cls: 'panda-zap-btn panda-zap-btn-tertiary',
        text: 'Cancel',
      });
      const confirm = btnRow.createEl('button', {
        cls: 'panda-zap-btn panda-zap-btn-primary',
        text: 'Delete',
      });

      cancel.onclick = () => {
        settle(false);
        m.close();
      };
      confirm.onclick = () => {
        settle(true);
        m.close();
      };

      m.open();
    });
  }

  private async performSync() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      await this.performSyncOnce();
    } finally {
      this.isSyncing = false;
    }
  }

  private async performSyncOnce() {
    if (!this.isConnected) {
      new Notice('Cannot sync: no connection to Anki');
      return;
    }
    if (this.analysisError) {
      new Notice(`Cannot sync: analysis failed (${this.analysisError})`);
      return;
    }

    try {
      // In batch mode, aggregate all cards from the batch context
      if (this.isBatchMode && this.batchSyncContext) {
        await this.performBatchSync(this.batchSyncContext);
      } else {
        await this.performSingleSync();
      }
    } catch (error: unknown) {
      // restore UI elements so the user can try again
      try {
        const summaryContainer = this.contentEl.querySelector('.panda-zap-summary');
        const buttonContainer = this.contentEl.querySelector('.panda-zap-button-container');
        if (summaryContainer?.instanceOf(HTMLElement)) summaryContainer.classList.remove('hidden');
        if (buttonContainer?.instanceOf(HTMLElement)) buttonContainer.classList.remove('hidden');
      } catch {
        // ignore sync error
      }
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`❌ Sync failed: ${errorMsg}`);
    }
  }

  private async performSingleSync() {
    if (this.syncContext.cards.length === 0) {
      const labels = markerLabels(this.plugin.settings);
      const qTag = `${labels.q}:`;
      const aTag = `${labels.a}:`;
      new Notice(`No ${qTag} ${aTag} cards found in current note`);
      return;
    }

    // If we don't have analysis loaded, try to load it so we can prompt for deletions
    if (!this.syncAnalysis) {
      try {
        this.syncAnalysis = await this.plugin.analyzeSyncOperation(this.syncContext);
      } catch {
        // ignore analysis failure, proceed without deletion prompt
      }
    }

    // If there are deletions detected, ask the user to confirm before proceeding.
    // If the user cancels, close the modal and abort the sync entirely.
    let deleteConfirmed = false;
    let confirmedDeletionIds: readonly string[] | undefined;
    if (this.syncAnalysis && this.syncAnalysis.cardsToDelete.length > 0) {
      const userConfirmed = await this.showDeleteConfirmation(
        this.syncAnalysis.cardsToDelete.length
      );
      if (!userConfirmed) {
        // User cancelled deletion -> close modal and abort sync
        this.close();
        return;
      }
      deleteConfirmed = true;
      confirmedDeletionIds = Object.freeze(
        this.syncAnalysis.cardsToDelete
          .map((card) => card.existingCardId)
          .filter((id): id is string => Boolean(id))
      );
    }

    await this.hideUiAndSync(async () =>
      this.plugin.syncCardsToAnki(false, deleteConfirmed, this.syncContext, confirmedDeletionIds)
    );
  }

  private async performBatchSync(bContext: BatchSyncContext) {
    if (bContext.totalCards === 0) {
      new Notice('No cards found in selected notes');
      return;
    }

    // If we don't have analysis loaded, try to load it
    if (!this.syncAnalysis) {
      try {
        this.syncAnalysis = await this.plugin.analyzeBatchSyncOperation(bContext);
      } catch {
        // ignore
      }
    }

    // Handle deletions per-note
    let deleteConfirmed = false;
    let confirmedDeletionIdsByNote: Map<string, readonly string[]> | undefined;
    if (this.syncAnalysis && this.syncAnalysis.cardsToDelete.length > 0) {
      const noteCount = new Set(
        this.syncAnalysis.cardsToDelete
          .map((cd) => cd.notePath)
          .filter((p): p is string => Boolean(p))
      ).size;
      const userConfirmed = await this.showDeleteConfirmation(
        this.syncAnalysis.cardsToDelete.length,
        noteCount
      );
      if (!userConfirmed) {
        this.close();
        return;
      }
      deleteConfirmed = true;
      // Build per-note deletion ID map
      const byNote = new Map<string, string[]>();
      for (const cd of this.syncAnalysis.cardsToDelete) {
        if (cd.notePath && cd.existingCardId) {
          const list = byNote.get(cd.notePath) ?? [];
          list.push(cd.existingCardId);
          byNote.set(cd.notePath, list);
        }
      }
      confirmedDeletionIdsByNote = new Map(
        [...byNote.entries()].map(([k, v]) => [k, Object.freeze(v)] as const)
      );
    }

    await this.hideUiAndSync(async () =>
      this.plugin.syncBatchCards(bContext, false, deleteConfirmed, confirmedDeletionIdsByNote)
    );
  }

  private async hideUiAndSync(syncFn: () => Promise<SyncResult>) {
    // Hide summary and action buttons now that the user has confirmed (or there were no deletions)
    const summaryContainer = this.contentEl.querySelector('.panda-zap-summary');
    const buttonContainerEl = this.contentEl.querySelector('.panda-zap-button-container');
    const resultContainer = this.contentEl.querySelector('.panda-zap-results');
    if (summaryContainer?.instanceOf(HTMLElement)) summaryContainer.classList.add('hidden');
    if (buttonContainerEl?.instanceOf(HTMLElement)) buttonContainerEl.classList.add('hidden');
    if (resultContainer?.instanceOf(HTMLElement)) {
      resultContainer.classList.remove('hidden');
      resultContainer.classList.add('visible');
      resultContainer.empty();
      const loadingList = resultContainer.createDiv('panda-zap-results-list');
      const loadingItem = loadingList.createDiv('panda-zap-result-item');
      loadingItem.createSpan({ text: 'Syncing...' });
    }

    new Notice('Syncing cards to Anki...');
    const result = await syncFn();
    const finalResultContainer = this.contentEl.querySelector('.panda-zap-results');
    if (!finalResultContainer?.instanceOf(HTMLElement)) return;
    finalResultContainer.classList.remove('hidden');
    finalResultContainer.classList.add('visible');
    finalResultContainer.empty();
    finalResultContainer.createEl('h3', { text: 'Sync results' });
    const resultsList = finalResultContainer.createDiv('panda-zap-results-list');
    // Separate skipped entries from main results and render skipped in a collapsible section
    const skipped = result.cards.filter(
      (card) => card.status === 'skipped-existing' || card.status === 'skipped-identical'
    );
    const skippedSet = new Set(skipped);
    result.cards
      .filter((card) => !skippedSet.has(card))
      .forEach((card) => {
        const item = resultsList.createDiv('panda-zap-result-item');
        item.createSpan({ text: formatSyncCardResult(card, this.plugin.settings) });
      });
    if (result.deletion?.failed) {
      const item = resultsList.createDiv('panda-zap-result-item');
      item.createSpan({
        text: `Failed to delete notes: ${result.deletion.reason ?? 'Unknown error'}`,
      });
    }

    if (skipped.length > 0) {
      const skipHeader = finalResultContainer.createDiv('panda-zap-section-header');
      const toggle = skipHeader.createSpan({ cls: 'panda-zap-toggle-icon', text: '▸' });
      skipHeader.createDiv({
        cls: 'panda-zap-section-title',
        text: `Skipped (${skipped.length})`,
      });
      const skippedList = finalResultContainer.createDiv(
        'panda-zap-results-list panda-zap-skipped-list hidden'
      );
      skipped.forEach((card) => {
        const item = skippedList.createDiv('panda-zap-result-item');
        item.createSpan({ text: formatSyncCardResult(card, this.plugin.settings) });
      });
      skipHeader.onclick = () => {
        const isHidden = skippedList.classList.contains('hidden');
        if (isHidden) {
          skippedList.classList.remove('hidden');
          skippedList.classList.add('visible');
        } else {
          skippedList.classList.remove('visible');
          skippedList.classList.add('hidden');
        }
        toggle.textContent = isHidden ? '▾' : '▸';
      };
    }

    // Show deletion details if deletions were actually performed
    if (
      result.deletion &&
      !result.deletion.failed &&
      result.deletion.deletedCount > 0 &&
      this.syncAnalysis?.cardsToDelete.length
    ) {
      const deletedSection = finalResultContainer.createDiv('panda-zap-deleted-section');
      deletedSection.createEl('h4', {
        text: `Deleted notes (${result.deletion.deletedCount})`,
      });
      const deletedList = deletedSection.createDiv('panda-zap-results-list');
      this.syncAnalysis.cardsToDelete.forEach((cd) => {
        const item = deletedList.createDiv('panda-zap-result-item');
        const id = cd.existingCardId || 'unknown-id';
        const q = cd.card && cd.card.question ? cd.card.question : '<no question>';
        item.createSpan({ text: `Deleted: ${q} (id: ${id})` });
      });
    }

    const total = result.cards.length;
    const succeeded = result.cards.filter(
      (card) => card.status === 'added' || card.status === 'updated'
    ).length;
    const failed = result.cards.filter(
      (card) => card.status === 'failed' || card.status === 'image-failed'
    ).length;
    const deleted = result.deletion && !result.deletion.failed ? result.deletion.deletedCount : 0;
    const deletionNote = deleted > 0 ? `, ${deleted} deleted` : '';
    const deletionFailedNote = result.deletion?.failed ? '; deletion failed' : '';

    if (total > 0 && failed === total) {
      new Notice(
        `Sync failed: ${failed} of ${total} cards failed${deletionNote}${deletionFailedNote}`
      );
    } else if (failed > 0 || result.deletion?.failed) {
      new Notice(
        `Sync completed with issues: ${succeeded} succeeded, ${failed} failed, ${skipped.length} skipped${deletionNote}${deletionFailedNote}`
      );
    } else {
      new Notice(
        `Sync completed: ${succeeded} succeeded, ${skipped.length} skipped${deletionNote}`
      );
    }
  }

  private openSettings() {
    this.close();
    const appWithSetting = this.app as AppWithSetting;
    appWithSetting.setting.open();
    appWithSetting.setting.openTabById(this.plugin.manifest.id);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
