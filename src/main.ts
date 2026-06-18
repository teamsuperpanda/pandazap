import { Plugin, MarkdownView } from 'obsidian';
import { SyncModal } from './dialogs/SyncModal';
import { PandaZapSettingTab } from './dialogs/SettingsTab';
import { AnkiConnector } from './sync/AnkiConnector';
import { CardExtractor } from './sync/CardExtractor';
import { PandaZapSettings, DEFAULT_SETTINGS, AnkiCard, SyncAnalysis } from './sync/types';

export default class PandaZapPlugin extends Plugin {
  settings: PandaZapSettings;
  private ankiConnector: AnkiConnector;
  private cardExtractor: CardExtractor;

  async onload() {
    await this.loadSettings();

    this.ankiConnector = new AnkiConnector(this.settings, this.app);
    this.cardExtractor = new CardExtractor(this.app, this.settings);

    this.addRibbonIcon(
      'zap',
      'Sync notes to Anki',
      () => {
        void this.openSyncDialog();
      }
    );

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

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async testAnkiConnection(): Promise<boolean> {
    // Use a fresh connector created from current settings to ensure we use latest values
    const connector = new AnkiConnector(this.settings, this.app);
    return connector.testConnection();
  }

  async analyzeSyncOperation(): Promise<SyncAnalysis> {
    // Recreate connector and extractor using current settings so analysis uses latest values
    this.ankiConnector = new AnkiConnector(this.settings, this.app);
    this.cardExtractor = new CardExtractor(this.app, this.settings);

    const cards = this.extractCardsFromCurrentNote();
    const activeFile = this.app.workspace.getActiveFile();
    const notePath = activeFile ? activeFile.path : undefined;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const noteContent = activeView ? activeView.editor.getValue() : undefined;
    return this.ankiConnector.analyzeSyncOperation(cards, notePath, noteContent);
  }

  extractCardsFromCurrentNote(): AnkiCard[] {
    // Recreate extractor to pick up any settings changes
    this.cardExtractor = new CardExtractor(this.app, this.settings);
    return this.cardExtractor.extractCardsFromCurrentNote();
  }

  async syncCardsToAnki(
    cards: AnkiCard[],
    preview: boolean = false,
    deleteConfirmed: boolean = false
  ): Promise<string[]> {
    this.ankiConnector = new AnkiConnector(this.settings, this.app);
    const activeFile = this.app.workspace.getActiveFile();
    const notePath = activeFile ? activeFile.path : undefined;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const noteContent = activeView ? activeView.editor.getValue() : undefined;
    return this.ankiConnector.syncCards(
      cards,
      preview,
      notePath,
      noteContent,
      deleteConfirmed
    );
  }
}
