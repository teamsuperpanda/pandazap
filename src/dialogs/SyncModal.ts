import { Modal, App, Notice } from 'obsidian';
import PandaZapPlugin from '../main';
import {
  SyncAnalysis,
  BatchSyncContext,
  createSyncContext,
  SyncResult,
  describeConnection,
  describeSyncModalStatus,
  describeSyncResultNotice,
  formatSyncCardResult,
} from '../sync/types';
import { ANKI_CONNECT_VERSION } from '../constants';
import { PreviewModal } from './PreviewModal';
import { markerLabels } from '../settings';
import { CollapsibleSection } from './CollapsibleSection';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { SyncModalController } from './SyncModalController';

// Interface to properly type the App's setting property
interface AppWithSetting extends App {
  setting: {
    open(): void;
    openTabById(id: string): void;
  };
}

/**
 * View for the sync dialog. All state and decisions live in
 * SyncModalController; this class builds the elements once and re-renders them
 * from the controller's phase.
 */
export class SyncModal extends Modal {
  plugin: PandaZapPlugin;
  readonly controller: SyncModalController;
  private readonly batchContext?: BatchSyncContext;
  /** Set on close so no late await writes into a detached modal. */
  private closed = false;

  private statusEl!: HTMLDivElement;
  private summaryEl!: HTMLDivElement;
  private buttonsEl!: HTMLDivElement;
  private resultsEl!: HTMLDivElement;

  constructor(app: App, plugin: PandaZapPlugin, batchContext?: BatchSyncContext) {
    super(app);
    this.plugin = plugin;
    this.batchContext = batchContext;
    const context = batchContext
      ? createSyncContext([], undefined, undefined)
      : plugin.captureSyncContext();

    this.controller = new SyncModalController({
      context,
      batchContext,
      operations: {
        testConnection: () => plugin.testAnkiConnectionStatus(),
        analyzeSingle: () => plugin.analyzeSyncOperation(context),
        analyzeBatch: () =>
          this.requireBatchContext((batch) => plugin.analyzeBatchSyncOperation(batch)),
        syncSingle: (request) =>
          plugin.syncCardsToAnki(
            request.deleteConfirmed,
            context,
            request.confirmedDeletionIds,
            request.runOptions
          ),
        syncBatch: (request) =>
          this.requireBatchContext((batch) =>
            plugin.syncBatchCards(
              batch,
              request.deleteConfirmed,
              request.confirmedDeletionIdsByNote,
              request.runOptions
            )
          ),
      },
      confirmDeletion: (details) => new ConfirmDeleteModal(app, details).confirm(),
      onChange: () => this.render(),
      onSyncStart: () => new Notice('Syncing cards to Anki...'),
    });
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

    this.statusEl = contentEl.createDiv('panda-zap-status-container');
    this.summaryEl = contentEl.createDiv('panda-zap-summary');
    this.buttonsEl = contentEl.createDiv('panda-zap-button-container');
    this.resultsEl = contentEl.createDiv('panda-zap-results hidden');

    this.render();
    await this.controller.connect();
  }

  private render(): void {
    if (this.closed || !this.statusEl) return;
    this.renderStatus();
    this.renderSummary();
    this.renderButtons();
    this.renderResults();
  }

  private renderStatus(): void {
    this.statusEl.empty();
    const connection = this.controller.connection;
    if (!connection) {
      const loadingDiv = this.statusEl.createDiv('panda-zap-status-minimal');
      loadingDiv.createSpan({ text: 'Connecting to Anki...', cls: 'panda-zap-status-text' });
      return;
    }

    // The connection check classifies its own failures, so keep the state as
    // returned. Analysis failures are tracked separately and must not be
    // reported as a connection problem.
    const status = describeSyncModalStatus(
      connection,
      this.controller.analysisError,
      ANKI_CONNECT_VERSION
    );

    if (!this.controller.isConnected) {
      const statusDiv = this.statusEl.createDiv('panda-zap-status-minimal');
      statusDiv.createSpan({ cls: 'panda-zap-status-dot error' });
      statusDiv.createSpan({ text: status.title, cls: 'panda-zap-status-text error' });
      if (status.detail) {
        const detailDiv = this.statusEl.createDiv('panda-zap-status-minimal');
        detailDiv.createSpan({ text: status.detail, cls: 'panda-zap-status-text' });
      }
      return;
    }

    const statusDiv = this.statusEl.createDiv('panda-zap-status-minimal');
    statusDiv.createSpan({ cls: 'panda-zap-status-dot success' });
    statusDiv.createSpan({ text: status.title, cls: 'panda-zap-status-text success' });

    if (this.batchContext) {
      const batchInfo = this.statusEl.createDiv('panda-zap-batch-info');
      const nNotes = this.batchContext.notePaths.length;
      const nCards = this.batchContext.totalCards;
      batchInfo.createSpan({
        text: `${nNotes} note${nNotes !== 1 ? 's' : ''} selected, ${nCards} card${nCards !== 1 ? 's' : ''} total`,
        cls: 'panda-zap-batch-stats',
      });
    }

    if (status.analysisError) {
      const errorDiv = this.statusEl.createDiv('panda-zap-status-minimal');
      errorDiv.createSpan({ cls: 'panda-zap-status-dot error' });
      errorDiv.createSpan({ text: status.analysisError, cls: 'panda-zap-status-text error' });
    }
  }

  private renderSummary(): void {
    const hide = this.controller.phase === 'syncing' || this.controller.phase === 'done';
    this.toggleHidden(this.summaryEl, hide);
    this.summaryEl.empty();
    if (hide) return;

    const analysis = this.controller.analysis;
    if (!analysis) {
      if (this.controller.isConnected) {
        const emptyState = this.summaryEl.createDiv('panda-zap-empty-state');
        emptyState.createSpan({ text: 'No sync analysis available' });
      }
      return;
    }
    this.renderAnalysisSummary(this.summaryEl, analysis);
  }

  private renderAnalysisSummary(container: HTMLElement, analysis: SyncAnalysis): void {
    const summary = container.createDiv('panda-zap-sync-summary');
    summary.createEl('h3', { text: 'Summary' });
    const pillsContainer = summary.createDiv('panda-zap-pills-container');
    const addPill = pillsContainer.createDiv('panda-zap-pill add');
    addPill.createSpan({
      text: analysis.cardsToAdd.length.toString(),
      cls: 'panda-zap-pill-number',
    });
    addPill.createSpan({ text: ' to add', cls: 'panda-zap-pill-label' });
    const updatePill = pillsContainer.createDiv('panda-zap-pill update');
    updatePill.createSpan({
      text: analysis.cardsToUpdate.length.toString(),
      cls: 'panda-zap-pill-number',
    });
    updatePill.createSpan({ text: ' to update', cls: 'panda-zap-pill-label' });
    if (analysis.cardsInConflict.length > 0) {
      const conflictPill = pillsContainer.createDiv('panda-zap-pill conflict');
      conflictPill.createSpan({
        text: analysis.cardsInConflict.length.toString(),
        cls: 'panda-zap-pill-number',
      });
      conflictPill.createSpan({ text: ' changed in Anki', cls: 'panda-zap-pill-label' });
    }
    const deletePill = pillsContainer.createDiv('panda-zap-pill delete');
    deletePill.createSpan({
      text: analysis.cardsToDelete.length.toString(),
      cls: 'panda-zap-pill-number',
    });
    deletePill.createSpan({ text: ' to remove', cls: 'panda-zap-pill-label' });
  }

  private renderButtons(): void {
    const phase = this.controller.phase;
    const hide = phase === 'syncing' || phase === 'done';
    this.toggleHidden(this.buttonsEl, hide);
    this.buttonsEl.empty();
    if (hide) return;

    const buttonGroup = this.buttonsEl.createDiv('panda-zap-button-group');
    if (!this.controller.isConnected) {
      // Nothing to offer while the first connection check is still running.
      if (phase === 'connecting' && this.controller.connection === null) return;
      const testBtn = buttonGroup.createEl('button', {
        text: 'Test connection',
        cls: 'panda-zap-btn panda-zap-btn-secondary',
      });
      testBtn.disabled = phase === 'connecting';
      if (testBtn.disabled) testBtn.textContent = 'Testing...';
      testBtn.onclick = () => {
        void this.testConnection();
      };
      return;
    }

    if (this.controller.canRetryAnalysis) {
      const retryBtn = buttonGroup.createEl('button', {
        text: 'Retry analysis',
        cls: 'panda-zap-btn panda-zap-btn-secondary',
      });
      retryBtn.onclick = () => {
        void this.controller.retryAnalysis();
      };
    }
    const previewBtn = buttonGroup.createEl('button', {
      text: 'Preview changes',
      cls: 'panda-zap-btn panda-zap-btn-secondary',
    });
    previewBtn.disabled = !this.controller.canPreview;
    previewBtn.onclick = () => this.showPreview();
    const syncBtn = buttonGroup.createEl('button', {
      text: 'Sync to Anki',
      cls: 'panda-zap-btn panda-zap-btn-primary',
    });
    syncBtn.disabled = !this.controller.canSync;
    syncBtn.onclick = () => {
      void this.performSync();
    };
  }

  private renderResults(): void {
    const phase = this.controller.phase;
    const visible = phase === 'syncing' || phase === 'done';
    this.toggleHidden(this.resultsEl, !visible);
    this.resultsEl.empty();
    if (!visible) return;

    if (phase === 'syncing') {
      this.renderProgress();
      return;
    }
    if (this.controller.result) this.renderSyncResults(this.controller.result);
  }

  private renderProgress(): void {
    const progressRow = this.resultsEl.createDiv('panda-zap-result-item');
    const { processed, total } = this.controller;
    // The run may finish before the first progress callback, so keep a plain
    // label until there is a count to show.
    const progressText = total > 0 ? `Processed ${processed} / ${total} cards` : 'Syncing...';
    progressRow.createSpan({ text: progressText });

    const cancelRow = this.resultsEl.createDiv('panda-zap-button-group');
    const cancelBtn = cancelRow.createEl('button', {
      text: this.controller.isCancelling ? 'Cancelling...' : 'Cancel',
      cls: 'panda-zap-btn panda-zap-btn-tertiary',
    });
    cancelBtn.disabled = this.controller.isCancelling;
    cancelBtn.onclick = () => this.controller.cancelSync();
  }

  private renderSyncResults(result: SyncResult): void {
    this.resultsEl.createEl('h3', { text: 'Sync results' });
    const resultsList = this.resultsEl.createDiv('panda-zap-results-list');
    // Separate skipped entries from main results and render skipped in a collapsible section
    const skipped = result.cards.filter(
      (card) =>
        card.status === 'skipped-existing' ||
        card.status === 'skipped-identical' ||
        card.status === 'conflict'
    );
    const skippedSet = new Set(skipped);
    result.cards
      .filter((card) => !skippedSet.has(card))
      .forEach((card) => {
        const item = resultsList.createDiv('panda-zap-result-item');
        item.createSpan({ text: formatSyncCardResult(card) });
      });
    if (result.deletion?.failed) {
      const item = resultsList.createDiv('panda-zap-result-item');
      item.createSpan({
        text: `Failed to delete notes: ${result.deletion.reason ?? 'Unknown error'}`,
      });
    }

    if (skipped.length > 0) {
      const section = new CollapsibleSection(this.resultsEl, {
        title: 'Skipped',
        count: skipped.length,
        contentClasses: 'panda-zap-results-list panda-zap-skipped-list',
        expanded: false,
        icons: { expanded: '▾', collapsed: '▸' },
      });
      skipped.forEach((card) => {
        const item = section.contentEl.createDiv('panda-zap-result-item');
        item.createSpan({ text: formatSyncCardResult(card) });
      });
    }

    // Show deletion details if deletions were actually performed
    const cardsToDelete = this.controller.analysis?.cardsToDelete ?? [];
    if (
      result.deletion &&
      !result.deletion.failed &&
      result.deletion.deletedCount > 0 &&
      cardsToDelete.length > 0
    ) {
      const deletedSection = this.resultsEl.createDiv('panda-zap-deleted-section');
      deletedSection.createEl('h4', {
        text: `Deleted notes (${result.deletion.deletedCount})`,
      });
      const deletedList = deletedSection.createDiv('panda-zap-results-list');
      cardsToDelete.forEach((cd) => {
        const item = deletedList.createDiv('panda-zap-result-item');
        const id = cd.existingCardId || 'unknown-id';
        const q = cd.card && cd.card.question ? cd.card.question : '<no question>';
        item.createSpan({ text: `Deleted: ${q} (id: ${id})` });
      });
    }
  }

  private toggleHidden(element: HTMLElement, hidden: boolean): void {
    element.classList.toggle('hidden', hidden);
  }

  private async testConnection(): Promise<void> {
    const state = await this.controller.retryConnection();
    if (this.closed) return;
    if (state.status === 'ok') {
      new Notice('Connected to Anki!');
      return;
    }
    new Notice(describeConnection(state, ANKI_CONNECT_VERSION));
  }

  private async performSync(): Promise<void> {
    // A closed modal has emptied contentEl: starting the run would change Anki
    // with no progress row, no Cancel button and no way to report back.
    if (this.closed) return;
    const outcome = await this.controller.runSync();
    if (this.closed) return;
    switch (outcome.status) {
      case 'busy':
        return;
      case 'unavailable':
        new Notice(
          outcome.reason === 'connection'
            ? 'Cannot sync: no connection to Anki'
            : `Cannot sync: analysis failed (${this.controller.analysisError})`
        );
        return;
      case 'deletion-cancelled':
        this.close();
        return;
      case 'nothing-to-sync':
        this.reportNothingToSync();
        return;
      case 'failed':
        new Notice(`❌ Sync failed: ${outcome.message}`);
        return;
      case 'completed':
        new Notice(describeSyncResultNotice(outcome.result, this.controller.progress ?? undefined));
        return;
    }
  }

  private reportNothingToSync(): void {
    if (this.controller.isBatchMode) {
      new Notice('No cards found in selected notes');
      return;
    }
    const labels = markerLabels(this.plugin.settings);
    const qTag = `${labels.q}:`;
    const aTag = `${labels.a}:`;
    new Notice(`No ${qTag} ${aTag} cards found in current note`);
    this.close();
  }

  private showPreview(): void {
    const analysis = this.controller.analysis;
    if (!analysis) {
      new Notice('No analysis available');
      return;
    }
    let noteLabels: Map<string, string> | undefined;
    if (this.batchContext) {
      noteLabels = new Map(
        this.batchContext.notePaths.map((p) => {
          const name = p.split('/').pop()?.replace(/\.md$/, '') ?? p;
          return [p, name] as [string, string];
        })
      );
    }
    new PreviewModal(this.app, analysis, this.plugin.settings, noteLabels).open();
  }

  private openSettings(): void {
    if (this.controller.isRunning) {
      // close() is refused mid-run, so opening settings here would stack the
      // settings pane over a live sync.
      new Notice('Cancel the sync first');
      return;
    }
    this.close();
    const appWithSetting = this.app as AppWithSetting;
    appWithSetting.setting.open();
    appWithSetting.setting.openTabById(this.plugin.manifest.id);
  }

  /**
   * Closing mid-sync would detach the progress UI while Anki keeps changing,
   * so the run must be cancelled first.
   */
  close(): void {
    if (this.controller.isRunning) {
      new Notice('Cancel the sync first');
      return;
    }
    super.close();
  }

  onClose() {
    this.closed = true;
    this.plugin.clearActiveSyncModal(this);
    const { contentEl } = this;
    contentEl.empty();
  }

  private requireBatchContext<T>(use: (batch: BatchSyncContext) => T): T {
    if (!this.batchContext) throw new Error('Batch sync context missing');
    return use(this.batchContext);
  }
}
