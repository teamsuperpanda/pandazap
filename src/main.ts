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
  /** Debounce timers for sync-on-save, one per note path. */
  private silentSyncTimers = new Map<string, number>();
  /** Paths with a silent sync currently running, so runs never stack. */
  private silentSyncInFlight = new Set<string>();
  /** Paths edited while their silent run was still in flight. */
  private silentSyncAgain = new Set<string>();
  /** Session cache of whether a note already has Anki notes. */
  private noteHasCardsCache = new Map<string, boolean>();
  private syncStatusItem: HTMLElement | null = null;
  private syncStatusText = '';
  private syncStatusError: { key: string; shownAt: number } | null = null;

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

    // A rename made while Anki was unreachable is still waiting in the queue.
    void this.flushPendingTagMigrations();
  }

  onunload(): void {
    for (const timer of this.silentSyncTimers.values()) window.clearTimeout(timer);
    this.silentSyncTimers.clear();
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

  /**
   * One-step sync of the active note from the editor buffer, so unsaved edits
   * are included. Deletions still need the dialog's confirmation, but an
   * ordinary sync never opens it.
   */
  async syncCurrentNote(): Promise<void> {
    if (!this.canSyncCurrentNote()) return;
    if (this.activeSyncModal) {
      this.reportSyncDialogOpen();
      return;
    }
    if (this.mediaCleanupActive) {
      new Notice('Wait for the media cleanup to finish');
      return;
    }

    const context = this.captureSyncContext();
    if (!context.notePath) {
      new Notice('No active note found');
      return;
    }

    if (await this.hasBlockingTagMigration(context.notePath)) {
      new Notice(describeTagMigrationFailure(context.notePath));
      return;
    }

    try {
      const analysis = await this.analyzeSyncOperation(context);
      if (analysis.cardsToDelete.length > 0) {
        // Deleting Anki notes is destructive, so hand off to the existing
        // dialog path that asks for confirmation.
        this.openSyncDialog();
        return;
      }
      if (context.cards.length === 0) {
        const labels = markerLabels(this.settings);
        new Notice(`No ${labels.q}: ${labels.a}: cards found in current note`);
        return;
      }
      const result = await this.syncCardsToAnki(false, false, context, []);
      new Notice(describeSyncResultNotice(result));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Sync failed: ${message}`);
    }
  }

  /**
   * Adds the file menu entry for Markdown files. A multi-selection syncs all
   * selected notes, matching the existing selected-notes command.
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
          void this.openBatchSyncDialog(paths);
        });
    });
  }

  private handleNoteModify(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    if (!this.settings.syncOnSave) return;
    this.scheduleSilentSync(file.path);
  }

  /** Coalesces rapid writes to one note into a single silent sync. */
  private scheduleSilentSync(notePath: string): void {
    const pending = this.silentSyncTimers.get(notePath);
    if (pending !== undefined) window.clearTimeout(pending);
    const timer = window.setTimeout(() => {
      this.silentSyncTimers.delete(notePath);
      void this.runSilentSync(notePath);
    }, SYNC_ON_SAVE_DEBOUNCE_MS);
    this.silentSyncTimers.set(notePath, timer);
  }

  private async runSilentSync(notePath: string): Promise<void> {
    if (!this.settings.syncOnSave) return;
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
    if (this.silentSyncInFlight.has(notePath)) {
      this.silentSyncAgain.add(notePath);
      return;
    }
    this.silentSyncInFlight.add(notePath);
    try {
      await this.syncNoteSilently(notePath);
    } catch (error: unknown) {
      this.reportSilentSyncFailure(notePath, error);
    } finally {
      this.silentSyncInFlight.delete(notePath);
      if (this.silentSyncAgain.delete(notePath) && this.settings.syncOnSave) {
        this.scheduleSilentSync(notePath);
      }
    }
  }

  /**
   * Writes one note to Anki without UI. Only notes that already have cards are
   * touched, and deletion is disabled by confirming an empty deletion list.
   */
  private async syncNoteSilently(notePath: string): Promise<void> {
    if (await this.hasBlockingTagMigration(notePath)) return;

    const context = await this.captureSyncContextForPath(notePath);
    if (!context || context.cards.length === 0) return;
    if (!(await this.hasCardsInAnki(notePath))) return;

    this.setSyncStatus(`Panda Zap: syncing ${noteName(notePath)}`, `Syncing ${notePath} to Anki`);
    this.ankiConnector.updateSettings(this.settings);
    try {
      const result = await this.ankiConnector.syncCards(
        context.cards,
        false,
        notePath,
        context.noteContent,
        // The connector requires an explicit confirmation before deleting; an
        // empty list means it has nothing it is allowed to remove.
        true,
        [],
        false
      );
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
      this.ankiConnector.invalidateCache();
    }
  }

  /** True when the note still needs a queued rename migration before syncing. */
  private async hasBlockingTagMigration(notePath: string): Promise<boolean> {
    const failed = await this.flushPendingTagMigrations();
    return failed.some((migration) => migration.toPath === notePath);
  }

  private async hasCardsInAnki(notePath: string): Promise<boolean> {
    const cached = this.noteHasCardsCache.get(notePath);
    if (cached !== undefined) return cached;
    const hasCards = await this.ankiConnector.hasNotesForSourceTag(notePath);
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
    if (!this.syncStatusItem) {
      this.syncStatusItem = this.addStatusBarItem();
      this.syncStatusItem.addClass('panda-zap-sync-status');
    }
    this.syncStatusItem.setText(text);
    this.syncStatusItem.setAttribute('aria-label', tooltip);
    this.syncStatusItem.setAttribute('title', tooltip);
    this.syncStatusText = text;
  }

  private reportSilentSyncFailure(notePath: string, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const key = `${notePath}\0${message}`;
    const now = Date.now();
    const repeated =
      this.syncStatusError?.key === key &&
      now - this.syncStatusError.shownAt < SYNC_STATUS_ERROR_REPEAT_MS;
    // Keep the original timestamp so a repeating failure stays quiet, but never
    // leave a "syncing" state behind: an identical error still replaces it.
    const shownAt = this.syncStatusError && repeated ? this.syncStatusError.shownAt : now;
    this.syncStatusError = { key, shownAt };
    const text = `Panda Zap: sync failed - ${noteName(notePath)}`;
    if (repeated && this.syncStatusText === text) return;
    this.setSyncStatus(text, `Last sync on save for ${notePath} failed: ${message}`);
  }

  private clearSyncStatusError(): void {
    this.syncStatusError = null;
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
