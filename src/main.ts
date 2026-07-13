import { Plugin, MarkdownView } from 'obsidian';
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
  createSyncContext,
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

    this.addSettingTab(new PandaZapSettingTab(this.app, this));

    this.registerMarkdownPostProcessor((element, _context) => {
      this.cardExtractor.processQACards(element, this);
    });
  }

  openSyncDialog() {
    new SyncModal(this.app, this).open();
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
    // Use a fresh connector created from current settings to ensure we use latest values
    const connector = new AnkiConnector(this.settings, this.app);
    return connector.testConnection();
  }

  captureSyncContext(): SyncContext {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return createSyncContext([]);

    const noteContent = activeView.editor.getValue();
    const notePath = activeView.file?.path;
    const cards = extractQACardsFromText(noteContent, this.settings);
    return createSyncContext(cards, notePath, noteContent);
  }

  async analyzeSyncOperation(context?: SyncContext): Promise<SyncAnalysis> {
    // Recreate connector using current settings so analysis uses latest values
    this.ankiConnector = new AnkiConnector(this.settings, this.app);

    const syncContext = context ?? this.captureSyncContext();
    return this.ankiConnector.analyzeSyncOperation(
      syncContext.cards.map((card) => ({ ...card })),
      syncContext.notePath,
      syncContext.noteContent
    );
  }

  extractCardsFromCurrentNote(): AnkiCard[] {
    // Recreate extractor to pick up any settings changes
    this.cardExtractor = new CardExtractor(this.app, this.settings);
    return this.cardExtractor.extractCardsFromCurrentNote();
  }

  async syncCardsToAnki(
    cards: AnkiCard[],
    preview: boolean = false,
    deleteConfirmed: boolean = false,
    context?: SyncContext,
    confirmedDeletionIds?: readonly string[]
  ): Promise<string[]> {
    this.ankiConnector = new AnkiConnector(this.settings, this.app);
    const syncContext = context ?? this.captureSyncContext();
    const syncCards = context ? syncContext.cards.map((card) => ({ ...card })) : cards;
    return this.ankiConnector.syncCards(
      syncCards,
      preview,
      syncContext.notePath,
      syncContext.noteContent,
      deleteConfirmed,
      confirmedDeletionIds
    );
  }
}
