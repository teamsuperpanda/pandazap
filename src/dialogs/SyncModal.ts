import { Modal, App, Notice } from 'obsidian';
import PandaZapPlugin from '../main';
import { SyncAnalysis } from '../sync/types';
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

  constructor(app: App, plugin: PandaZapPlugin) {
    super(app);
    this.plugin = plugin;
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

    const loadingOverlay = contentEl.createDiv('panda-zap-spinner-overlay panda-zap-loading-overlay');
    const loadingText = loadingOverlay.createDiv('panda-zap-loading-text');
    loadingText.textContent = 'Loading...';

    await this.checkConnectionAndLoadAnalysis();

    loadingOverlay.remove();

    const statusContainer = contentEl.createDiv('panda-zap-status-container');
    this.renderStatus(statusContainer);
    const summaryContainer = contentEl.createDiv('panda-zap-summary');
    this.renderSyncSummary(summaryContainer);
    const buttonContainer = contentEl.createDiv('panda-zap-button-container');
    this.renderButtons(buttonContainer);
    // Create results container (hidden by default)
    contentEl.createDiv('panda-zap-results hidden');
  }

  private async checkConnectionAndLoadAnalysis() {
    try {
      this.isConnected = await this.plugin.testAnkiConnection();
      if (this.isConnected) {
        this.syncAnalysis = await this.plugin.analyzeSyncOperation();
      }
    } catch {
      this.isConnected = false;
    }
  }

  private renderStatus(statusContainer: HTMLElement) {
    statusContainer.empty();
    if (!this.isConnected) {
      const statusDiv = statusContainer.createDiv('panda-zap-status-minimal');
      const dot = statusDiv.createSpan({ cls: 'panda-zap-status-dot error' });
      if (!this.isCssAvailable(dot))
        statusDiv.createSpan({ text: '• ', cls: 'panda-zap-status-text error' });
      statusDiv.createSpan({
        text: 'Not connected to Anki',
        cls: 'panda-zap-status-text error',
      });
      return;
    }
    const statusDiv = statusContainer.createDiv('panda-zap-status-minimal');
    const dot = statusDiv.createSpan({ cls: 'panda-zap-status-dot success' });
    if (!this.isCssAvailable(dot))
      statusDiv.createSpan({ text: '• ', cls: 'panda-zap-status-text success' });
    statusDiv.createSpan({ text: 'Connected to Anki', cls: 'panda-zap-status-text success' });
  }

  private isCssAvailable(testEl: HTMLElement): boolean {
    const w = testEl.offsetWidth;
    const h = testEl.offsetHeight;
    return w >= 8 && h >= 8;
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

    if (!this.isCssAvailable(addPill)) {
      summary.empty();
      const list = summary.createEl('ul');
      list.createEl('li', { text: `${this.syncAnalysis.cardsToAdd.length} to add` });
      list.createEl('li', { text: `${this.syncAnalysis.cardsToUpdate.length} to update` });
      list.createEl('li', { text: `${this.syncAnalysis.cardsToDelete.length} to remove` });
    }
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
            new SyncModal(this.app, this.plugin).open();
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
    new PreviewModal(this.app, this.syncAnalysis, this.plugin.settings).open();
  }

  // Show a styled Obsidian modal to confirm deletion, returns true if user confirms
  private showDeleteConfirmation(count: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const m = new Modal(this.app);
      // Build content
      m.contentEl.addClass('panda-zap-delete-confirm');
      m.contentEl.createEl('h3', { text: 'Confirm deletion' });
      const msg = m.contentEl.createDiv('panda-zap-delete-msg');
      msg.textContent = `This will delete ${count} cards from Anki that were removed from this note. Proceed?`;
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
        resolve(false);
        m.close();
      };
      confirm.onclick = () => {
        resolve(true);
        m.close();
      };

      m.open();
    });
  }

  private async performSync() {
    if (!this.isConnected) {
      new Notice('Cannot sync: no connection to Anki');
      return;
    }

    // Extract cards first
    try {
      const cards = this.plugin.extractCardsFromCurrentNote();
      if (cards.length === 0) {
        const qTag = `${this.plugin.settings.questionWord}:`;
        const aTag = `${this.plugin.settings.answerWord}:`;
        new Notice(`No ${qTag} ${aTag} cards found in current note`);
        return;
      }

      // If we don't have analysis loaded, try to load it so we can prompt for deletions
      if (!this.syncAnalysis) {
        try {
          this.syncAnalysis = await this.plugin.analyzeSyncOperation();
        } catch {
          // ignore analysis failure — we'll proceed without deletion prompt
        }
      }

      // If there are deletions detected, ask the user to confirm before proceeding.
      // If the user cancels, close the modal and abort the sync entirely.
      let deleteConfirmed = false;
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
      }

      // Hide summary and action buttons now that the user has confirmed (or there were no deletions)
      const summaryContainer = this.contentEl.querySelector('.panda-zap-summary');
      const buttonContainer = this.contentEl.querySelector(
        '.panda-zap-button-container'
      );
      const resultContainer = this.contentEl.querySelector('.panda-zap-results');
      if (summaryContainer instanceof HTMLElement) summaryContainer.classList.add('hidden');
      if (buttonContainer instanceof HTMLElement) buttonContainer.classList.add('hidden');
      if (resultContainer instanceof HTMLElement) {
        resultContainer.classList.remove('hidden');
        resultContainer.classList.add('visible');
        resultContainer.empty();
        const loadingList = resultContainer.createDiv('panda-zap-results-list');
        const loadingItem = loadingList.createDiv('panda-zap-result-item');
        loadingItem.createSpan({ text: 'Syncing...' });
      }

      new Notice('Syncing cards to Anki...');
      const results = await this.plugin.syncCardsToAnki(cards, false, deleteConfirmed);
      const finalResultContainer = this.contentEl.querySelector(
        '.panda-zap-results'
      );
      if (!(finalResultContainer instanceof HTMLElement)) return;
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
        const skippedList = finalResultContainer.createDiv('panda-zap-results-list panda-zap-skipped-list hidden');
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

      // After a sync completes, keep summary/buttons hidden and show deletion details if available
      const deletedLine = results.find(
        (r) => /deleted\s+\d+\s+notes/i.test(r) || (r.includes('Deleted') && r.includes('notes'))
      );
      if (deleteConfirmed && deletedLine) {
        // Try to use the previously loaded analysis for details, otherwise fetch a fresh one
        let deletionAnalysis = this.syncAnalysis;
        if (!deletionAnalysis) {
          try {
            deletionAnalysis = await this.plugin.analyzeSyncOperation();
          } catch {
            // ignore — we'll still show the generic deleted summary
          }
        }

        if (
          deletionAnalysis &&
          deletionAnalysis.cardsToDelete &&
          deletionAnalysis.cardsToDelete.length > 0
        ) {
          const deletedSection = finalResultContainer.createDiv('panda-zap-deleted-section');
          deletedSection.createEl('h4', {
            text: `Deleted notes (${deletionAnalysis.cardsToDelete.length})`,
          });
          const deletedList = deletedSection.createDiv('panda-zap-results-list');
          deletionAnalysis.cardsToDelete.forEach((cd) => {
            const item = deletedList.createDiv('panda-zap-result-item');
            const id = cd.existingCardId || 'unknown-id';
            const q = cd.card && cd.card.question ? cd.card.question : '<no question>';
            const a = cd.card && cd.card.answer ? cd.card.answer : '<no answer>';
            item.createSpan({ text: `🗑️ ${q} → ${cd.deckName} (id: ${id})` });
            // optionally show the answer on the next line when available
            if (a) {
              const meta = item.createDiv({ cls: 'panda-zap-card-meta' });
              meta.createSpan({ text: `Answer: ${a}`, cls: 'panda-zap-card-line' });
            }
          });
        }
      }

      new Notice(`✅ Sync completed! ${cards.length} cards processed`);
    } catch (error: unknown) {
      // restore UI elements so the user can try again
      try {
        const summaryContainer = this.contentEl.querySelector(
          '.panda-zap-summary'
        );
        const buttonContainer = this.contentEl.querySelector(
          '.panda-zap-button-container'
        );
        if (summaryContainer instanceof HTMLElement) summaryContainer.classList.remove('hidden');
        if (buttonContainer instanceof HTMLElement) buttonContainer.classList.remove('hidden');
      } catch {
        // ignore sync error
      }
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`❌ Sync failed: ${errorMsg}`);
    }
  }

  private openSettings() {
    this.close();
    const appWithSetting = this.app as AppWithSetting;
    appWithSetting.setting.open();
    appWithSetting.setting.openTabById('panda-zap');
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
