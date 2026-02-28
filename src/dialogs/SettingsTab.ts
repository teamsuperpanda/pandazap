import { PluginSettingTab, App, Setting, Notice } from 'obsidian';
import PandaZapPlugin from '../main';
import { DEFAULT_SETTINGS } from '../sync/types';

// Interface to properly type the TextComponent's inputEl property
interface TextComponentWithInput {
  inputEl: HTMLInputElement;
}

export class PandaZapSettingTab extends PluginSettingTab {
  plugin: PandaZapPlugin;
  private connectionResultEl: HTMLElement;

  constructor(app: App, plugin: PandaZapPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('Sync').setHeading();

    new Setting(containerEl)
      .setName('Use note-based deck organization')
      .setDesc(
        'Create Anki decks based on note location and name. If disabled, uses the default deck below.'
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useNoteBased).onChange((value) => {
          this.plugin.settings.useNoteBased = value;
          void this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Bold question in reading mode')
      .setDesc(
        'When enabled, only the question (not the answer) will be bolded in reading mode; question/answer tags are still removed.'
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.boldQuestionInReadingMode).onChange((value) => {
          this.plugin.settings.boldQuestionInReadingMode = value;
          void this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName('Anki connect').setHeading();

    // Restore defaults button for quick reset
    new Setting(containerEl)
      .setName('Restore defaults')
      .setDesc('Restore all settings to default values.')
      .addButton((button) =>
        button.setButtonText('Restore defaults').onClick(() => {
          this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
          void this.plugin.saveSettings().then(() => {
            new Notice('Settings restored to defaults');
            this.display();
          });
        })
      );

    new Setting(containerEl)
      .setName('Anki connect URL')
      .setDesc('The URL where Anki connect is running.')
      .addText((text) =>
        text
          .setPlaceholder('http://127.0.0.1')
          .setValue(this.plugin.settings.ankiConnectUrl)
          .onChange((value) => {
            this.plugin.settings.ankiConnectUrl = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Anki connect port')
      .setDesc('The port where Anki connect is running.')
      .addText((text) =>
        text
          .setPlaceholder('8765')
          .setValue(this.plugin.settings.ankiConnectPort.toString())
          .onChange((value) => {
            this.plugin.settings.ankiConnectPort = parseInt(value) || 8765;
            void this.plugin.saveSettings();
          })
      );

    // dynamic description that uses the current deck override word to show an example
    const currentDeckWord =
      this.plugin.settings.deckOverrideWord || DEFAULT_SETTINGS.deckOverrideWord;
    const deckSetting = new Setting(containerEl)
      .setName('Deck override word')
      .setDesc(`Example: ${currentDeckWord}::MyDeck`)
      .addText((text) => {
        text
          .setPlaceholder('Deck')
          .setValue(this.plugin.settings.deckOverrideWord)
          // allow the user to clear the field; we'll enforce defaults on blur
          .onChange((value) => {
            this.plugin.settings.deckOverrideWord = value;
            void this.plugin.saveSettings();
            const w = (value && value.trim()) || DEFAULT_SETTINGS.deckOverrideWord;
            if (deckSetting.descEl) deckSetting.descEl.textContent = `Example: ${w}::MyDeck`;
          });

        // restore default if left empty on blur and notify the user
        const inputEl = (text as TextComponentWithInput).inputEl;
        inputEl.addEventListener('blur', () => {
          if (!inputEl.value || !inputEl.value.trim()) {
            const def = DEFAULT_SETTINGS.deckOverrideWord;
            text.setValue(def);
            this.plugin.settings.deckOverrideWord = def;
            void this.plugin.saveSettings();
            if (deckSetting.descEl) deckSetting.descEl.textContent = `Example: ${def}::MyDeck`;
            new Notice('Deck override word cannot be empty — restored to default');
          }
        });
      });

    const currentQ = this.plugin.settings.questionWord || DEFAULT_SETTINGS.questionWord;
    const questionSetting = new Setting(containerEl)
      .setName('Question word')
      .setDesc(`Example: ${currentQ}: What is the capital of France?`)
      .addText((text) => {
        text
          .setPlaceholder('Q')
          .setValue(this.plugin.settings.questionWord)
          // allow clearing; enforce default on blur
          .onChange((value) => {
            // save the raw value (can be empty temporarily)
            this.plugin.settings.questionWord = value;
            void this.plugin.saveSettings();
            const w = (value && value.trim()) || DEFAULT_SETTINGS.questionWord;
            if (questionSetting.descEl)
              questionSetting.descEl.textContent = `Example: ${w}: What is the capital of France?`;
          });

        const inputEl = (text as TextComponentWithInput).inputEl;
        inputEl.addEventListener('blur', () => {
          if (!inputEl.value || !inputEl.value.trim()) {
            const def = DEFAULT_SETTINGS.questionWord;
            text.setValue(def);
            this.plugin.settings.questionWord = def;
            void this.plugin.saveSettings();
            if (questionSetting.descEl)
              questionSetting.descEl.textContent = `Example: ${def}: What is the capital of France?`;
            new Notice('Question word cannot be empty — restored to default');
          }
        });
      });

    const currentA = this.plugin.settings.answerWord || DEFAULT_SETTINGS.answerWord;
    const answerSetting = new Setting(containerEl)
      .setName('Answer word')
      .setDesc(`Example: ${currentA}: Paris`)
      .addText((text) => {
        text
          .setPlaceholder('A')
          .setValue(this.plugin.settings.answerWord)
          // allow clearing; enforce default on blur
          .onChange((value) => {
            this.plugin.settings.answerWord = value;
            void this.plugin.saveSettings();
            const w = (value && value.trim()) || DEFAULT_SETTINGS.answerWord;
            if (answerSetting.descEl) answerSetting.descEl.textContent = `Example: ${w}: Paris`;
          });

        const inputEl = (text as TextComponentWithInput).inputEl;
        inputEl.addEventListener('blur', () => {
          if (!inputEl.value || !inputEl.value.trim()) {
            const def = DEFAULT_SETTINGS.answerWord;
            text.setValue(def);
            this.plugin.settings.answerWord = def;
            void this.plugin.saveSettings();
            if (answerSetting.descEl) answerSetting.descEl.textContent = `Example: ${def}: Paris`;
            new Notice('Answer word cannot be empty — restored to default');
          }
        });
      });

    const currentI = this.plugin.settings.imageWord || DEFAULT_SETTINGS.imageWord;
    const imageSetting = new Setting(containerEl)
      .setName('Image word')
      .setDesc(`Example: ${currentI}: [[my-image.png]]`)
      .addText((text) => {
        text
          .setPlaceholder('I')
          .setValue(this.plugin.settings.imageWord)
          .onChange((value) => {
            this.plugin.settings.imageWord = value;
            void this.plugin.saveSettings();
            const w = (value && value.trim()) || DEFAULT_SETTINGS.imageWord;
            if (imageSetting.descEl) imageSetting.descEl.textContent = `Example: ${w}: [[my-image.png]]`;
          });

        const inputEl = (text as TextComponentWithInput).inputEl;
        inputEl.addEventListener('blur', () => {
          if (!inputEl.value || !inputEl.value.trim()) {
            const def = DEFAULT_SETTINGS.imageWord;
            text.setValue(def);
            this.plugin.settings.imageWord = def;
            void this.plugin.saveSettings();
            if (imageSetting.descEl) imageSetting.descEl.textContent = `Example: ${def}: [[my-image.png]]`;
            new Notice('Image word cannot be empty — restored to default');
          }
        });
      });

    new Setting(containerEl)
      .setName('Test Anki connection')
      .setDesc('Test the connection to Anki connect.')
      .addButton((button) =>
        button.setButtonText('Test connection').onClick(() => {
          void this.testConnection();
        })
      );
    this.connectionResultEl = containerEl.createDiv('panda-zap-connection-result');
  }

  private async testConnection(): Promise<void> {
    this.connectionResultEl.empty();

    this.connectionResultEl.className = 'panda-zap-connection-result loading';
    const loadingEl = this.connectionResultEl.createDiv('connection-content');
    loadingEl.createEl('span', { cls: 'connection-icon', text: '⏳' });
    loadingEl.createEl('span', { cls: 'connection-text', text: 'Testing connection...' });

    try {
      const isConnected = await this.plugin.testAnkiConnection();
      this.connectionResultEl.empty();
      if (isConnected) {
        this.connectionResultEl.className = 'panda-zap-connection-result connected';
        const connectedEl = this.connectionResultEl.createDiv('connection-content');
        connectedEl.createEl('span', { cls: 'connection-icon', text: '✅ ' });
        connectedEl.createEl('span', { cls: 'connection-text', text: 'Connected to Anki connect' });
        connectedEl.createEl('span', {
          cls: 'connection-details',
          text: `${this.plugin.settings.ankiConnectUrl}:${this.plugin.settings.ankiConnectPort}`,
        });
      } else {
        this.connectionResultEl.className = 'panda-zap-connection-result disconnected';
        const disconnectedEl = this.connectionResultEl.createDiv('connection-content');
        disconnectedEl.createEl('span', { cls: 'connection-icon', text: '❌ ' });
        disconnectedEl.createEl('span', {
          cls: 'connection-text',
          text: 'Cannot connect to Anki connect',
        });
        disconnectedEl.createEl('span', {
          cls: 'connection-details',
          text: 'Make sure Anki is running with Anki connect addon installed',
        });
      }
    } catch (error: unknown) {
      this.connectionResultEl.empty();
      this.connectionResultEl.className = 'panda-zap-connection-result error';
      const errorEl = this.connectionResultEl.createDiv('connection-content');
      errorEl.createEl('span', { cls: 'connection-icon', text: '⚠️ ' });
      errorEl.createEl('span', { cls: 'connection-text', text: 'Connection error' });
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errorEl.createEl('span', { cls: 'connection-details', text: errorMsg });
    }
  }
}
