import { Plugin, MarkdownView, TFile, Notice } from 'obsidian';
import { SyncModal } from './dialogs/SyncModal';
import { PandaZapSettingTab } from './dialogs/SettingsTab';
import { AnkiConnector } from './sync/AnkiConnector';
import { CardExtractor } from './sync/CardExtractor';
import {
  PandaZapSettings,
  DEFAULT_SETTINGS,
  AnkiCard,
  SyncAnalysis,
  SyncContext,
  CardSyncInfo,
  BatchSyncContext,
  createSyncContext,
  createBatchSyncContext,
} from './sync/types';
import { extractQACardsFromText } from './sync/extractionUtils';

export default class PandaZapPlugin extends Plugin {
  settings: PandaZapSettings;
  private ankiConnector: AnkiConnector;
  private cardExtractor: CardExtractor;
  private settingsSaveQueue: Promise<void> = Promise.resolve();

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
        void this.openBatchSyncDialog(paths);
      },
    });

    this.addSettingTab(new PandaZapSettingTab(this.app, this));

    this.registerMarkdownPostProcessor((element, _context) => {
      this.cardExtractor.processQACards(element, this);
    });
  }

  openSyncDialog() {
    new SyncModal(this.app, this).open();
  }

  async openBatchSyncDialog(notePaths: string[]): Promise<void> {
    const bContext = await this.captureBatchSyncContext(notePaths);
    if (bContext.contexts.size === 0) {
      new Notice('No markdown notes with cards found');
      return;
    }
    new SyncModal(this.app, this, bContext).open();
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
    document.querySelectorAll('.nav-file.is-selected').forEach((el) => {
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
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<PandaZapSettings>
    );
  }

  saveSettings(): Promise<void> {
    const settingsSnapshot = { ...this.settings };
    const saveAttempt = this.settingsSaveQueue.then(() => this.saveData(settingsSnapshot));

    // Keep later saves moving after a failure and handle ignored promises from
    // settings controls. Callers that await this attempt still receive the error.
    this.settingsSaveQueue = saveAttempt.catch((error: unknown) => {
      console.error('Failed to save Panda Zap settings', error);
    });

    return saveAttempt;
  }

  async testAnkiConnection(): Promise<boolean> {
    this.ankiConnector.updateSettings(this.settings);
    return this.ankiConnector.testConnection();
  }

  captureSyncContext(): SyncContext {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return createSyncContext([]);

    const noteContent = activeView.editor.getValue();
    const notePath = activeView.file?.path;
    const cards = extractQACardsFromText(noteContent, this.settings);
    return createSyncContext(cards, notePath, noteContent);
  }

  async captureBatchSyncContext(notePaths: string[]): Promise<BatchSyncContext> {
    const captured = await Promise.all(
      notePaths.map(async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        const content = await this.app.vault.read(file);
        const cards = extractQACardsFromText(content, this.settings);
        return cards.length > 0 ? createSyncContext(cards, path, content) : null;
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
    if (!(await this.ankiConnector.testConnection())) {
      throw new Error(
        'Cannot connect to Anki Connect. Make sure Anki is running with AnkiConnect addon installed.'
      );
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
    confirmedDeletionIdsByNote?: ReadonlyMap<string, readonly string[]>
  ): Promise<string[]> {
    this.ankiConnector.updateSettings(this.settings);
    if (!(await this.ankiConnector.testConnection())) {
      throw new Error(
        'Cannot connect to Anki Connect. Make sure Anki is running with AnkiConnect addon installed.'
      );
    }
    const results: string[] = [];

    for (const [notePath, context] of bContext.contexts) {
      const noteResults = await this.ankiConnector.syncCards(
        context.cards,
        preview,
        notePath,
        context.noteContent,
        deleteConfirmed,
        confirmedDeletionIdsByNote?.get(notePath),
        true
      );
      results.push(...noteResults);
    }

    return results;
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
    confirmedDeletionIds?: readonly string[]
  ): Promise<string[]> {
    this.ankiConnector.updateSettings(this.settings);
    const syncContext = context ?? this.captureSyncContext();
    return this.ankiConnector.syncCards(
      syncContext.cards,
      preview,
      syncContext.notePath,
      syncContext.noteContent,
      deleteConfirmed,
      confirmedDeletionIds
    );
  }
}
