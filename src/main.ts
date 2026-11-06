import { Plugin, MarkdownView, TFile, TAbstractFile, Menu, Notice } from 'obsidian';
import { SyncModal } from './dialogs/SyncModal';
import { PandaZapSettingTab } from './dialogs/SettingsTab';
import { ConfirmModal } from './dialogs/ConfirmModal';
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
  SyncAbortToken,
  AnkiConnectionState,
  PendingTagMigration,
  SourceTagMigrationResult,
  describeConnection,
  describeSyncResultNotice,
} from './sync/types';
import { extractQACardsFromText } from './sync/extractionUtils';
import {
  ANKI_CONNECT_VERSION,
  SYNC_ON_SAVE_DEBOUNCE_MS,
  SYNC_STATUS_ERROR_REPEAT_MS,
} from './constants';
import { markerLabels, normalizeSettings } from './settings';

export default class PandaZapPlugin extends Plugin {
  settings: PandaZapSettings;
  private ankiConnector: AnkiConnector;
  private cardExtractor: CardExtractor;
  private settingsSaveQueue: Promise<void> = Promise.resolve();
  private tagMigrationQueue: Promise<void> = Promise.resolve();
  private mediaCleanupActive = false;
  private activeSyncModal: SyncModal | null = null;
  /** Set on unload so no deferred work touches Anki or the status bar after. */
  private unloaded = false;
  /** Debounce timers for sync-on-save, one per note path. */
  private silentSyncTimers = new Map<string, number>();
  /** Paths with any sync currently running, so runs never stack for a note. */
  private syncInFlight = new Set<string>();
  /** Paths edited while their silent run was still in flight. */
  private silentSyncAgain = new Set<string>();
  /** Abort tokens for silent runs, cancelled when the plugin unloads. */
  private silentSyncAborts = new Map<string, SyncAbortToken>();
  /** Abort tokens for direct runs, cancelled when the plugin unloads. */
  private directSyncAborts = new Set<SyncAbortToken>();
  /** Session cache of whether a note already has Anki notes. */
  private noteHasCardsCache = new Map<string, boolean>();
  private syncStatusItem: HTMLElement | null = null;
  private syncStatusText = '';
  private syncStatusError: { key: string; notePath: string; shownAt: number } | null = null;

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
      id: 'sync-current-note',
      name: 'Sync current note to Anki',
      checkCallback: (checking: boolean): boolean => {
        if (!this.canSyncCurrentNote()) return false;
        if (!checking) void this.syncCurrentNote();
        return true;
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

    this.addCommand({
      id: 'cleanup-orphaned-media',
      // Obsidian prefixes the plugin name, and the lint rules forbid repeating it.
      name: 'Clean up orphaned media',
      callback: () => {
        void this.cleanUpOrphanedMedia();
      },
    });

    this.addSettingTab(new PandaZapSettingTab(this.app, this));

    // Obsidian owns the item's lifetime when it is created during onload.
    this.syncStatusItem = this.addStatusBarItem();
    this.syncStatusItem.addClass('panda-zap-sync-status');
    this.syncStatusItem.setText('');

    this.registerMarkdownPostProcessor((element, _context) => {
      this.cardExtractor.processQACards(element, this);
    });

    // A renamed note keeps its Anki notes only if its source tag follows it.
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== 'md' || file.path === oldPath) return;
        // The handler observes its own failures; this avoids a floating promise.
        void this.handleNoteRename(oldPath, file.path);
      })
    );

    // Markdown files offer a one-step sync from the file menu. The selected
    // notes path is reused so a multi-selection syncs as one batch.
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        this.handleFileMenu(menu, file);
      })
    );

    // Sync on save is gated inside the handler, so toggling the setting takes
    // effect without reloading the plugin.
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        this.handleNoteModify(file);
      })
    );

    // A deleted note can no longer be the source of a status bar error.
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') this.handleNoteDeleted(file.path);
      })
    );

    // A rename made while Anki was unreachable is still waiting in the queue.
    void this.flushPendingTagMigrations();
  }

  onunload(): void {
    this.unloaded = true;
    for (const timer of this.silentSyncTimers.values()) window.clearTimeout(timer);
    this.silentSyncTimers.clear();
    this.silentSyncAgain.clear();
    this.syncInFlight.clear();
    for (const abort of this.silentSyncAborts.values()) abort.cancelled = true;
    this.silentSyncAborts.clear();
    for (const abort of this.directSyncAborts) abort.cancelled = true;
    this.directSyncAborts.clear();
    this.syncStatusItem = null;
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
    if (this.mediaCleanupActive) {
      // A sync during cleanup can re-attach a file that was about to be deleted.
      new Notice('Wait for the media cleanup to finish');
      return;
    }
    if (this.activeSyncModal) {
      this.reportSyncDialogOpen();
      return;
    }
    this.activeSyncModal = modal;
    try {
      modal.open();
    } catch (error) {
      // A synchronous open failure must not poison the guard for the session.
      this.activeSyncModal = null;
      throw error;
    }
  }

  /** Called by the modal on close, so the next command can open a dialog. */
  clearActiveSyncModal(modal: SyncModal): void {
    if (this.activeSyncModal === modal) this.activeSyncModal = null;
  }

  private reportSyncDialogOpen(): void {
    new Notice('A sync dialog is already open. Cancel the running sync or close the dialog.');
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

  private canSyncCurrentNote(): boolean {
    return this.app.workspace.getActiveViewOfType(MarkdownView) !== null;
  }

  /** True when a dialog or cleanup already owns Anki, after telling the user. */
  private syncBlockedByOtherWork(): boolean {
    if (this.activeSyncModal) {
      this.reportSyncDialogOpen();
      return true;
    }
    if (this.mediaCleanupActive) {
      new Notice('Wait for the media cleanup to finish');
      return true;
    }
    return false;
  }

  /**
   * One-step sync of the active note from the editor buffer, so unsaved edits
   * are included. Deletions still ask for confirmation, but an ordinary sync
   * never opens the full dialog.
   */
  async syncCurrentNote(): Promise<void> {
    if (this.unloaded || !this.canSyncCurrentNote()) return;
    if (this.syncBlockedByOtherWork()) return;

    const context = this.captureSyncContext();
    if (!context.notePath) {
      new Notice('No active note found');
      return;
    }

    const labels = markerLabels(this.settings);
    await this.syncNotesDirectly(
      [context.notePath],
      new Map([[context.notePath, context]]),
      `No ${labels.q}: ${labels.a}: cards found in current note`
    );
  }

  /**
   * Adds the file menu entry for Markdown files. A multi-selection syncs all
   * selected notes directly, with one aggregated deletion confirmation.
   */
  private handleFileMenu(menu: Menu, file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    const selected = this.getSelectedNotePaths();
    const paths = selected.includes(file.path) ? selected : [file.path];
    const title = paths.length === 1 ? 'Sync note to Anki' : `Sync ${paths.length} notes to Anki`;
    menu.addItem((item) => {
      item
        .setTitle(title)
        .setIcon('zap')
        .onClick(() => {
          void this.syncNotesDirectly(paths);
        });
    });
  }

  /**
   * Syncs notes without opening the full modal. Deletions are confirmed once,
   * aggregated across every affected note, before the connector is called.
   */
  private async syncNotesDirectly(
    notePaths: readonly string[],
    contexts?: ReadonlyMap<string, SyncContext>,
    emptyMessage = 'No cards found in selected notes'
  ): Promise<void> {
    if (this.unloaded || notePaths.length === 0) return;
    if (this.syncBlockedByOtherWork()) return;
    if (notePaths.some((notePath) => this.syncInFlight.has(notePath))) {
      new Notice('A sync for one of these notes is already running');
      return;
    }

    // Claim every path before the first await, so a second invocation cannot
    // start a second run while this one is still reading notes.
    for (const notePath of notePaths) this.syncInFlight.add(notePath);
    try {
      const bContext = contexts
        ? createBatchSyncContext(new Map(contexts))
        : await this.captureDirectBatchContext(notePaths);
      if (this.unloaded) return;
      if (bContext.contexts.size === 0) {
        new Notice('No Markdown notes with cards found');
        return;
      }

      const analysis = await this.analyzeBatchSyncOperation(bContext);
      if (this.unloaded) return;
      // A dialog or cleanup may have started during the analysis await.
      if (this.syncBlockedByOtherWork()) return;

      if (bContext.totalCards === 0 && analysis.cardsToDelete.length === 0) {
        new Notice(emptyMessage);
        return;
      }

      let confirmedDeletionIdsByNote: ReadonlyMap<string, readonly string[]> | undefined;
      if (analysis.cardsToDelete.length > 0) {
        const confirmed = await this.confirmDirectDeletions(analysis, bContext.notePaths);
        if (!confirmed) {
          new Notice('Sync cancelled');
          return;
        }
        if (this.unloaded) return;
        // The confirmation dialog can stay open while other work starts.
        if (this.syncBlockedByOtherWork()) return;
        confirmedDeletionIdsByNote = confirmed;
      }

      const abort: SyncAbortToken = { cancelled: false };
      this.directSyncAborts.add(abort);
      try {
        const result = await this.syncBatchCards(
          bContext,
          false,
          confirmedDeletionIdsByNote !== undefined,
          confirmedDeletionIdsByNote,
          { abort }
        );
        if (this.unloaded) return;
        new Notice(describeSyncResultNotice(result));
      } finally {
        this.directSyncAborts.delete(abort);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // The migration guard already reported why this note cannot sync.
      const migrationBlocked = notePaths.some(
        (notePath) => message === describeTagMigrationFailure(notePath)
      );
      if (!migrationBlocked) new Notice(`Sync failed: ${message}`);
    } finally {
      for (const notePath of notePaths) {
        this.syncInFlight.delete(notePath);
        this.runDeferredSilentSync(notePath);
      }
    }
  }

  /**
   * One confirmation for every deletion the direct sync analysed. Returns the
   * per-note confirmed IDs, or null when the user cancelled.
   */
  private async confirmDirectDeletions(
    analysis: SyncAnalysis,
    notePaths: readonly string[]
  ): Promise<ReadonlyMap<string, readonly string[]> | null> {
    const byNote = new Map<string, string[]>();
    for (const card of analysis.cardsToDelete) {
      if (!card.existingCardId) continue;
      const notePath = card.notePath ?? notePaths[0];
      if (!notePath) continue;
      const ids = byNote.get(notePath) ?? [];
      ids.push(card.existingCardId);
      byNote.set(notePath, ids);
    }
    if (byNote.size === 0) return new Map();

    const cardCount = [...byNote.values()].reduce((sum, ids) => sum + ids.length, 0);
    const affected = [...byNote.keys()];
    const message =
      affected.length === 1
        ? `This will delete ${cardCount} cards from Anki that were removed from "${noteName(affected[0])}". Proceed?`
        : `This will delete ${cardCount} cards from ${affected.length} notes that were removed from your notes. Proceed?`;
    const items =
      affected.length > 1
        ? affected.map((notePath) => `${noteName(notePath)} (${byNote.get(notePath)?.length ?? 0})`)
        : undefined;
    const confirmed = await new ConfirmModal(this.app, {
      title: 'Confirm deletion',
      message,
      items,
      confirmText: 'Delete',
    }).confirm();
    if (!confirmed) return null;

    return new Map(
      affected.map((notePath) => [notePath, Object.freeze(byNote.get(notePath) ?? [])] as const)
    );
  }

  /** Contexts for a direct sync, preferring the editor buffer when it is open. */
  private async captureDirectBatchContext(notePaths: readonly string[]): Promise<BatchSyncContext> {
    const contexts = new Map<string, SyncContext>();
    for (const notePath of notePaths) {
      const context = await this.captureSyncContextForPath(notePath);
      if (context) contexts.set(notePath, context);
    }
    return createBatchSyncContext(contexts);
  }

  private handleNoteModify(file: TAbstractFile): void {
    if (this.unloaded || !(file instanceof TFile) || file.extension !== 'md') return;
    if (!this.settings.syncOnSave) return;
    this.scheduleSilentSync(file.path);
  }

  private handleNoteDeleted(notePath: string): void {
    const timer = this.silentSyncTimers.get(notePath);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.silentSyncTimers.delete(notePath);
    }
    this.silentSyncAgain.delete(notePath);
    this.noteHasCardsCache.delete(notePath);
    const abort = this.silentSyncAborts.get(notePath);
    if (abort) abort.cancelled = true;
    if (this.syncStatusError?.notePath !== notePath) return;
    this.clearSyncStatusError();
    this.setSyncStatus(
      this.settings.syncOnSave ? 'Panda Zap: idle' : '',
      this.settings.syncOnSave ? 'Sync on save is active' : ''
    );
  }

  /** Coalesces rapid writes to one note into a single silent sync. */
  private scheduleSilentSync(notePath: string): void {
    if (this.unloaded || !this.settings.syncOnSave) return;
    const pending = this.silentSyncTimers.get(notePath);
    if (pending !== undefined) window.clearTimeout(pending);
    const timer = window.setTimeout(() => {
      this.silentSyncTimers.delete(notePath);
      void this.runSilentSync(notePath);
    }, SYNC_ON_SAVE_DEBOUNCE_MS);
    this.silentSyncTimers.set(notePath, timer);
  }

  private async runSilentSync(notePath: string): Promise<void> {
    if (this.unloaded || !this.settings.syncOnSave) return;
    // A dialog or cleanup owns Anki right now; the next save retries instead of
    // surfacing a modal or a notice for an edit the user did not ask to sync.
    if (this.activeSyncModal || this.mediaCleanupActive) {
      this.setSyncStatus(
        'Panda Zap: paused',
        this.activeSyncModal
          ? 'Sync on save is paused while a sync dialog is open'
          : 'Sync on save is paused while media cleanup runs'
      );
      return;
    }
    if (this.syncInFlight.has(notePath)) {
      this.silentSyncAgain.add(notePath);
      return;
    }
    this.syncInFlight.add(notePath);
    try {
      await this.syncNoteSilently(notePath);
    } catch (error: unknown) {
      this.reportSilentSyncFailure(notePath, error);
    } finally {
      this.syncInFlight.delete(notePath);
      this.runDeferredSilentSync(notePath);
    }
  }

  /** Runs one more silent sync when an edit landed during the previous run. */
  private runDeferredSilentSync(notePath: string): void {
    if (this.unloaded || !this.settings.syncOnSave) return;
    if (!this.silentSyncAgain.delete(notePath)) return;
    this.scheduleSilentSync(notePath);
  }

  /**
   * Writes one note to Anki without UI. Only notes that already have cards are
   * touched, and deletion is disabled by passing an explicit empty confirmed
   * deletion list.
   */
  private async syncNoteSilently(notePath: string): Promise<void> {
    if (this.unloaded) return;
    // Honour a changed URL or port before any probe or write.
    this.ankiConnector.updateSettings(this.settings);
    if ((await this.hasBlockingTagMigration(notePath)) || this.unloaded) return;

    const context = await this.captureSyncContextForPath(notePath);
    if (this.unloaded || !context || context.cards.length === 0) return;
    if (!(await this.hasCardsInAnki(notePath, context.noteContent))) return;
    if (this.unloaded) return;

    this.setSyncStatus(`Panda Zap: syncing ${noteName(notePath)}`, `Syncing ${notePath} to Anki`);
    const abort: SyncAbortToken = { cancelled: false };
    this.silentSyncAborts.set(notePath, abort);
    try {
      const result = await this.ankiConnector.syncCards(
        context.cards,
        false,
        notePath,
        context.noteContent,
        // Silent mode never deletes: no confirmation is given, and the explicit
        // empty list keeps the connector from analysing for deletions either.
        false,
        [],
        false,
        { abort }
      );
      if (this.unloaded || !this.settings.syncOnSave) return;
      const failed = result.cards.filter(
        (card) => card.status === 'failed' || card.status === 'image-failed'
      );
      if (failed.length > 0) {
        throw new Error(`${failed.length} of ${result.cards.length} cards failed`);
      }
      // The note now has cards for certain, so the cached answer is stale.
      this.noteHasCardsCache.delete(notePath);
      this.clearSyncStatusError();
      this.setSyncStatus('Panda Zap: idle', 'Sync on save is active');
    } finally {
      this.silentSyncAborts.delete(notePath);
      this.ankiConnector.invalidateCache();
    }
  }

  /** True when the note still needs a queued rename migration before syncing. */
  private async hasBlockingTagMigration(notePath: string): Promise<boolean> {
    const failed = await this.flushPendingTagMigrations();
    return failed.some((migration) => migration.toPath === notePath);
  }

  private async hasCardsInAnki(notePath: string, noteContent?: string): Promise<boolean> {
    const cached = this.noteHasCardsCache.get(notePath);
    if (cached !== undefined) return cached;
    const hasCards = await this.ankiConnector.hasNotesForSourceTag(notePath, noteContent);
    this.noteHasCardsCache.set(notePath, hasCards);
    return hasCards;
  }

  /** Reads a note, preferring the editor buffer so unsaved edits are included. */
  private async captureSyncContextForPath(notePath: string): Promise<SyncContext | null> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const bufferedContent =
      activeView?.file?.path === notePath ? activeView.editor?.getValue() : undefined;
    let content = bufferedContent;
    if (content === undefined) {
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (!(file instanceof TFile)) return null;
      content = await this.app.vault.read(file);
    }
    const cards = extractQACardsFromText(content, this.settings);
    return createSyncContext(cards, notePath, content);
  }

  private setSyncStatus(text: string, tooltip: string): void {
    // The item is created during onload; after unload Obsidian owns its removal.
    if (this.unloaded || !this.syncStatusItem) return;
    this.syncStatusItem.setText(text);
    this.syncStatusItem.setAttribute('aria-label', tooltip);
    this.syncStatusItem.setAttribute('title', tooltip);
    this.syncStatusText = text;
  }

  private reportSilentSyncFailure(notePath: string, error: unknown): void {
    if (this.unloaded) return;
    const message = error instanceof Error ? error.message : 'Unknown error';
    const key = `${notePath}\0${message}`;
    const now = Date.now();
    const repeated =
      this.syncStatusError?.key === key &&
      now - this.syncStatusError.shownAt < SYNC_STATUS_ERROR_REPEAT_MS;
    // Keep the original timestamp so a repeating failure stays quiet, but never
    // leave a "syncing" state behind: an identical error still replaces it.
    const shownAt = this.syncStatusError && repeated ? this.syncStatusError.shownAt : now;
    this.syncStatusError = { key, notePath, shownAt };
    const text = `Panda Zap: sync failed - ${noteName(notePath)}`;
    if (repeated && this.syncStatusText === text) return;
    this.setSyncStatus(text, `Last sync on save for ${notePath} failed: ${message}`);
  }

  private clearSyncStatusError(): void {
    this.syncStatusError = null;
  }

  /** Stop deferred work and clear the status shown for the sync-on-save feature. */
  private handleSyncOnSaveDisabled(): void {
    for (const timer of this.silentSyncTimers.values()) window.clearTimeout(timer);
    this.silentSyncTimers.clear();
    this.silentSyncAgain.clear();
    for (const abort of this.silentSyncAborts.values()) abort.cancelled = true;
    this.clearSyncStatusError();
    this.setSyncStatus('', '');
  }

  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }

  saveSettings(): Promise<void> {
    // Rejected in-memory values (a port typed as 70000, an empty note type) must
    // never reach disk, and memory must keep matching what disk holds.
    this.settings = normalizeSettings(this.settings);
    if (!this.settings.syncOnSave) this.handleSyncOnSaveDisabled();
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

  /** Deck and note type names for the settings pickers. */
  async listAnkiNames(): Promise<{ deckNames: string[]; modelNames: string[] }> {
    this.ankiConnector.updateSettings(this.settings);
    const [deckNames, modelNames] = await Promise.all([
      this.ankiConnector.listDeckNames(),
      this.ankiConnector.listModelNames(),
    ]);
    return { deckNames, modelNames };
  }

  /**
   * Retags the Anki notes of renamed files that are still queued. Entries are
   * processed independently, so one poisoned rename cannot hold up the rest;
   * a chained rename whose source tag was never written is kept for a later
   * run. Returns the migrations that are still pending with why, so a caller can
   * block the syncs that would duplicate them.
   */
  flushPendingTagMigrations(): Promise<PendingTagMigration[]> {
    // Renames and sync entry points can ask at the same time, so runs are
    // serialised and each one sees the queue the previous run left behind.
    const flush: Promise<PendingTagMigration[]> = this.tagMigrationQueue.then(() =>
      this.runPendingTagMigrations()
    );
    this.tagMigrationQueue = flush.then(
      (): void => undefined,
      (): void => undefined
    );
    return flush;
  }

  private async runPendingTagMigrations(): Promise<PendingTagMigration[]> {
    const pending = [...this.settings.pendingTagMigrations];
    const failed: PendingTagMigration[] = [];
    if (pending.length === 0) return failed;
    // The queue entry is on disk before the first Anki mutation, so a crash
    // mid-migration cannot lose a rename.
    await this.settingsSaveQueue;
    this.ankiConnector.updateSettings(this.settings);

    // Paths whose final source tag is not known yet: a failed rename A -> B
    // leaves B unset, so a queued B -> C must wait or it would migrate nothing
    // and drop its entry.
    const unsettled = new Set<string>();

    for (const migration of pending) {
      if (unsettled.has(migration.fromPath)) {
        failed.push(migration);
        unsettled.add(migration.toPath);
        continue;
      }

      let content: string | undefined;
      const file = this.app.vault.getAbstractFileByPath(migration.toPath);
      if (file instanceof TFile) {
        try {
          content = await this.app.vault.read(file);
        } catch (error: unknown) {
          // Without the content the legacy cards cannot be proven, and nothing
          // was written yet, so keep the entry and retry once the note is
          // readable again.
          console.warn('PandaZap: could not read renamed note', migration.toPath, error);
          failed.push(migration);
          unsettled.add(migration.toPath);
          continue;
        }
      }

      let result: SourceTagMigrationResult;
      try {
        result = await this.ankiConnector.migrateSourceTag(
          migration.fromPath,
          migration.toPath,
          content
        );
      } catch (error: unknown) {
        // The old tag is still on the notes, so syncing them now would duplicate
        // them. Keep the entry and try the unrelated entries after it.
        console.warn('PandaZap: source tag migration failed', migration.toPath, error);
        failed.push(migration);
        unsettled.add(migration.toPath);
        continue;
      }

      if (result.unresolvedLegacy) {
        // Older legacy cards could not be proven to belong to this note. They
        // stay in Anki as possible orphans, but that must not block the note.
        new Notice(describeOrphanedLegacy(migration.toPath));
      }

      this.settings.pendingTagMigrations = this.settings.pendingTagMigrations.filter(
        (entry) => entry.fromPath !== migration.fromPath || entry.toPath !== migration.toPath
      );
      try {
        await this.saveSettings();
      } catch (error: unknown) {
        // The tags already moved in Anki; a failed save only means the entry is
        // retried after a reload, where it finds nothing left to migrate.
        console.warn('PandaZap: could not persist tag migration queue', error);
      }
    }
    return failed;
  }

  /**
   * Queues a renamed note, starts persisting the queue, then migrates at once
   * so a reachable Anki is updated without waiting for a sync. The returned
   * promise is only used by callers that want to observe the flush; the vault
   * event handler discards it with `void`.
   */
  private handleNoteRename(fromPath: string, toPath: string): Promise<void> {
    const queued = this.settings.pendingTagMigrations.some(
      (entry) => entry.fromPath === fromPath && entry.toPath === toPath
    );
    if (!queued) {
      this.settings.pendingTagMigrations = [
        ...this.settings.pendingTagMigrations,
        { fromPath, toPath },
      ];
      void this.saveSettings().catch((error: unknown) => {
        console.warn('PandaZap: could not persist tag migration queue', error);
      });
    }

    return this.flushPendingTagMigrations().then(() => undefined);
  }

  /**
   * Applies pending renames and blocks the sync only when one of its own notes
   * still needs migrating; unrelated notes keep syncing while a broken entry
   * waits for Anki to be reachable again.
   */
  private async ensureTagMigrationsApplied(
    targetPaths: readonly (string | undefined)[]
  ): Promise<void> {
    const failed = await this.flushPendingTagMigrations();
    const targets = new Set(targetPaths.filter((path): path is string => Boolean(path)));
    const blocking = failed.find((migration) => targets.has(migration.toPath));
    if (!blocking) return;

    const message = describeTagMigrationFailure(blocking.toPath);
    new Notice(message);
    throw new Error(message);
  }

  /**
   * Deletes media the plugin uploaded that no Anki note references any more.
   * Both listings must succeed before anything is deleted, and candidates are
   * verified against all notes twice: once before the dialog and once right
   * before deletion, so a note that gains the file in between keeps it.
   */
  async cleanUpOrphanedMedia(): Promise<void> {
    if (this.activeSyncModal) {
      new Notice('Close the sync dialog before cleaning up media');
      return;
    }
    if (this.syncInFlight.size > 0) {
      new Notice('Wait for the running sync to finish before cleaning up media');
      return;
    }
    if (this.mediaCleanupActive) {
      new Notice('Media cleanup is already running');
      return;
    }
    this.mediaCleanupActive = true;
    try {
      await this.runMediaCleanup();
    } finally {
      this.mediaCleanupActive = false;
    }
  }

  private async runMediaCleanup(): Promise<void> {
    this.ankiConnector.updateSettings(this.settings);

    let mediaFiles: string[];
    let referenced: Set<string>;
    try {
      mediaFiles = await this.ankiConnector.getPluginMediaFiles();
      referenced = await this.ankiConnector.getReferencedMediaFiles();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Could not read Anki media: ${message}`);
      return;
    }

    const candidates = mediaFiles.filter((name) => !referenced.has(name));
    let orphans: string[];
    try {
      // Tagged notes are only one source of references: an untagged note (or a
      // duplicate) can still embed the file.
      orphans = await this.ankiConnector.filterUnreferencedMedia(candidates);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Could not verify Anki media: ${message}`);
      return;
    }

    if (orphans.length === 0) {
      new Notice('No orphaned Panda Zap media to delete');
      return;
    }

    const confirmed = await new ConfirmModal(this.app, {
      title: 'Clean up orphaned media',
      message: `Delete ${orphans.length} Panda Zap media ${plural(orphans.length, 'file')} that no Anki note references?`,
      items: orphans.slice(0, MEDIA_PREVIEW_LIMIT),
      confirmText: 'Delete files',
    }).confirm();
    if (!confirmed) return;

    // A sync or a note edit during the dialog can reference a candidate, so the
    // verified set from before the dialog is not good enough to delete.
    let stillUnreferenced: string[];
    try {
      stillUnreferenced = await this.ankiConnector.filterUnreferencedMedia(orphans);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Could not verify Anki media: ${message}`);
      return;
    }
    if (stillUnreferenced.length === 0) {
      new Notice('No orphaned Panda Zap media to delete');
      return;
    }

    try {
      const deleted = await this.ankiConnector.removeMediaFiles(stillUnreferenced);
      new Notice(`Deleted ${deleted} orphaned Panda Zap media ${plural(deleted, 'file')}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Could not delete Panda Zap media: ${message}`);
    }
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
    await this.ensureTagMigrationsApplied(bContext.notePaths);
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
    await this.ensureTagMigrationsApplied(bContext.notePaths);
    this.ankiConnector.updateSettings(this.settings);
    const result: SyncResult = { cards: [] };
    const totalCards = bContext.totalCards;
    const onProgress = runOptions?.onProgress;
    const abort = runOptions?.abort;
    // Publish the batch total before the connection test, so a cancel during
    // that test still reports N of M cards instead of 0 of 0.
    onProgress?.(0, totalCards);

    const connection = await this.ankiConnector.testConnection();
    if (connection.status !== 'ok') {
      throw new Error(describeConnection(connection, ANKI_CONNECT_VERSION));
    }

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

      // A successful manual batch may have created these notes' first cards.
      for (const notePath of bContext.notePaths) this.noteHasCardsCache.delete(notePath);
      return result;
    } finally {
      // One refresh for the whole batch, even when a note throws.
      this.ankiConnector.invalidateCache();
    }
  }

  async analyzeSyncOperation(context?: SyncContext): Promise<SyncAnalysis> {
    const syncContext = context ?? this.captureSyncContext();
    await this.ensureTagMigrationsApplied([syncContext.notePath]);
    this.ankiConnector.updateSettings(this.settings);

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
    const syncContext = context ?? this.captureSyncContext();
    await this.ensureTagMigrationsApplied([syncContext.notePath]);
    this.ankiConnector.updateSettings(this.settings);
    try {
      const result = await this.ankiConnector.syncCards(
        syncContext.cards,
        preview,
        syncContext.notePath,
        syncContext.noteContent,
        deleteConfirmed,
        confirmedDeletionIds,
        false,
        runOptions
      );
      // A manual sync may have created this note's first cards.
      if (syncContext.notePath) this.noteHasCardsCache.delete(syncContext.notePath);
      return result;
    } finally {
      // A sync run writes notes, so re-read Anki on the next user action.
      this.ankiConnector.invalidateCache();
    }
  }
}

/** How many orphan names the confirmation lists before summarising the rest. */
const MEDIA_PREVIEW_LIMIT = 5;

function describeTagMigrationFailure(notePath: string): string {
  return `Could not update Anki for renamed note "${notePath}". Connect to Anki and retry the sync.`;
}

function describeOrphanedLegacy(notePath: string): string {
  return `Older Anki cards of renamed note "${notePath}" could not be identified and may remain in Anki as orphans.`;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function noteName(notePath: string): string {
  return notePath.split('/').pop()?.replace(/\.md$/i, '') || notePath;
}
