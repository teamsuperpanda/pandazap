import { Modal, App, Notice } from 'obsidian';
import PandaZapPlugin from '../main';
import { SyncAnalysis, SyncContext, BatchSyncContext, createSyncContext } from '../sync/types';
import { PreviewModal } from './PreviewModal';

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
  private isConnected: boolean = false;
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

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('panda-zap-sync-modal');

    const header = contentEl.createDiv('panda-zap-header');

    const gearBtn = contentEl.createEl('button', { cls: 'panda-zap-settings-gear', text: '⚙️' });
    gearBtn.setAttr('aria-label', 'Open Panda Zap settings');
    gearBtn.setAttr('title', 'Open plugin settings');
    gearBtn.onclick = () => this.openSettings();

    header.createEl('h2', { text: 'Panda zap' });

    // Render status and action containers immediately
    const statusContainer = contentEl.createDiv('panda-zap-status-container');
    const summaryContainer = contentEl.createDiv('panda-zap-summary');
    const buttonContainer = contentEl.createDiv('panda-zap-button-container');
    contentEl.createDiv('panda-zap-results hidden');

    // Show initial loading state
    const loadingDiv = statusContainer.createDiv('panda-zap-status-minimal');
    loadingDiv.createSpan({ text: 'Connecting to Anki...', cls: 'panda-zap-status-text' });

    // Then load data asynchronously
    try {
      this.isConnected = await this.plugin.testAnkiConnection();
      if (this.isConnected) {
        if (this.isBatchMode && this.batchSyncContext) {
          this.syncAnalysis = await this.plugin.analyzeBatchSyncOperation(this.batchSyncContext);
        } else {
          this.syncAnalysis = await this.plugin.analyzeSyncOperation(this.syncContext);
        }
      }
    } catch {
      this.isConnected = false;
    }

    // Update UI
    this.renderStatus(statusContainer);
    this.renderSyncSummary(summaryContainer);
    this.renderButtons(buttonContainer);
  }

  private renderStatus(statusContainer: HTMLElement) {
    statusContainer.empty();
    if (!this.isConnected) {
      const statusDiv = statusContainer.createDiv('panda-zap-status-minimal');
      statusDiv.createSpan({ cls: 'panda-zap-status-dot error' });
      statusDiv.createSpan({
        text: 'Not connected to Anki',
        cls: 'panda-zap-status-text error',
      });
      return;
    }
    const statusDiv = statusContainer.createDiv('panda-zap-status-minimal');
    statusDiv.createSpan({ cls: 'panda-zap-status-dot success' });
    statusDiv.createSpan({ text: 'Connected to Anki', cls: 'panda-zap-status-text success' });

    if (this.isBatchMode && this.batchSyncContext) {
      const batchInfo = statusContainer.createDiv('panda-zap-batch-info');
      const nNotes = this.batchSyncContext.notePaths.length;
      const nCards = this.batchSyncContext.totalCards;
      batchInfo.createSpan({
        text: `${nNotes} note${nNotes !== 1 ? 's' : ''} selected, ${nCards} card${nCards !== 1 ? 's' : ''} total`,
        cls: 'panda-zap-batch-stats',
      });
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
        try {
          const connected = await this.plugin.testAnkiConnection();
          if (connected) {
            new Notice('Connected to Anki!');
            this.close();
            new SyncModal(this.app, this.plugin, this.batchSyncContext).open();
          } else {
            new Notice('Still not connected to Anki');
          }
        } catch {
          new Notice('Connection test failed');
        }
        testBtn.disabled = false;
        testBtn.textContent = 'Test connection';
      };
    } else {
      const previewBtn = buttonGroup.createEl('button', {
        text: 'Preview changes',
        cls: 'panda-zap-btn panda-zap-btn-secondary',
      });
      previewBtn.onclick = () => this.showPreview();
      const syncBtn = buttonGroup.createEl('button', {
        text: 'Sync to Anki',
        cls: 'panda-zap-btn panda-zap-btn-primary',
      });
      syncBtn.onclick = () => this.performSync();
    }
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
      const qTag = `${this.plugin.settings.questionWord}:`;
      const aTag = `${this.plugin.settings.answerWord}:`;
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

    await this.hideUiAndSync(
      async () =>
        this.plugin.syncCardsToAnki(false, deleteConfirmed, this.syncContext, confirmedDeletionIds),
      this.syncContext.cards.length,
      deleteConfirmed
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

    await this.hideUiAndSync(
      async () =>
        this.plugin.syncBatchCards(bContext, false, deleteConfirmed, confirmedDeletionIdsByNote),
      bContext.totalCards,
      deleteConfirmed
    );
  }

  private async hideUiAndSync(
    syncFn: () => Promise<string[]>,
    totalCardCount: number,
    deleteConfirmed: boolean = false
  ) {
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
    const results = await syncFn();
    const finalResultContainer = this.contentEl.querySelector('.panda-zap-results');
    if (!finalResultContainer?.instanceOf(HTMLElement)) return;
    finalResultContainer.classList.remove('hidden');
    finalResultContainer.classList.add('visible');
    finalResultContainer.empty();
    finalResultContainer.createEl('h3', { text: 'Sync results' });
    const resultsList = finalResultContainer.createDiv('panda-zap-results-list');
    // Separate skipped entries from main results and render skipped in a collapsible section
    const skipped: string[] = [];
    results.forEach((result) => {
      const lowered = result.toLowerCase();
      if (
        lowered.includes('skipped') &&
        (lowered.includes('already') || lowered.includes('exists') || lowered.includes('skip'))
      ) {
        skipped.push(result);
      } else {
        const item = resultsList.createDiv('panda-zap-result-item');
        item.createSpan({ text: result });
      }
    });

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
      skipped.forEach((s) => {
        const item = skippedList.createDiv('panda-zap-result-item');
        item.createSpan({ text: s });
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
    const deletionSucceeded =
      deleteConfirmed && results.some((r) => /deleted\s+\d+\s+notes/i.test(r));
    if (deletionSucceeded && this.syncAnalysis?.cardsToDelete.length) {
      const deletedSection = finalResultContainer.createDiv('panda-zap-deleted-section');
      deletedSection.createEl('h4', {
        text: `Deleted notes (${this.syncAnalysis.cardsToDelete.length})`,
      });
      const deletedList = deletedSection.createDiv('panda-zap-results-list');
      this.syncAnalysis.cardsToDelete.forEach((cd) => {
        const item = deletedList.createDiv('panda-zap-result-item');
        const id = cd.existingCardId || 'unknown-id';
        const q = cd.card && cd.card.question ? cd.card.question : '<no question>';
        item.createSpan({ text: `Deleted: ${q} (id: ${id})` });
      });
    }

    new Notice(`✅ Sync completed! ${totalCardCount} cards processed`);
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
