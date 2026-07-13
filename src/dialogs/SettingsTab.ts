import { PluginSettingTab, App, Setting, Notice, SettingDefinitionItem } from 'obsidian';
import PandaZapPlugin from '../main';
import { DEFAULT_SETTINGS } from '../sync/types';

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

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'Sync',
        items: [
          {
            name: 'Use note-based deck organization',
            desc: 'Create Anki decks based on note location and name. If disabled, uses the default deck below.',
            render: (setting) => {
              setting.addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.useNoteBased).onChange((value) => {
                  this.plugin.settings.useNoteBased = value;
                  void this.plugin.saveSettings();
                })
              );
            },
          },
          {
            name: 'Bold question in reading mode',
            desc: 'When enabled, only the question (not the answer) will be bolded in reading mode; question/answer tags are still removed.',
            render: (setting) => {
              setting.addToggle((toggle) =>
                toggle
                  .setValue(this.plugin.settings.boldQuestionInReadingMode)
                  .onChange((value) => {
                    this.plugin.settings.boldQuestionInReadingMode = value;
                    void this.plugin.saveSettings();
                  })
              );
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Anki connect',
        items: [
          {
            name: 'Restore defaults',
            desc: 'Restore all settings to default values.',
            render: (setting) => {
              setting.addButton((button) =>
                button.setButtonText('Restore defaults').onClick(() => {
                  this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
                  void this.plugin
                    .saveSettings()
                    .then(() => {
                      new Notice('Settings restored to defaults');
                      this.update();
                    })
                    .catch(() => undefined);
                })
              );
            },
          },
          {
            name: 'Anki connect URL',
            desc: 'The URL where Anki connect is running.',
            render: (setting) => this.renderAnkiConnectUrlSetting(setting),
          },
          {
            name: 'Anki connect port',
            desc: 'The port where Anki connect is running.',
            render: (setting) => this.renderAnkiConnectPortSetting(setting),
          },
          {
            name: 'Deck override word',
            desc: `Example: ${this.plugin.settings.deckOverrideWord || DEFAULT_SETTINGS.deckOverrideWord}::MyDeck`,
            render: (setting) => this.renderDeckWordSetting(setting),
          },
          {
            name: 'Question word',
            desc: `Example: ${this.plugin.settings.questionWord || DEFAULT_SETTINGS.questionWord}: What is the capital of France?`,
            render: (setting) => this.renderQuestionWordSetting(setting),
          },
          {
            name: 'Answer word',
            desc: `Example: ${this.plugin.settings.answerWord || DEFAULT_SETTINGS.answerWord}: Paris`,
            render: (setting) => this.renderAnswerWordSetting(setting),
          },
          {
            name: 'Image word',
            desc: `Example: ${this.plugin.settings.imageWord || DEFAULT_SETTINGS.imageWord}: [[my-image.png]]`,
            render: (setting) => this.renderImageWordSetting(setting),
          },
          {
            name: 'Test Anki connection',
            desc: 'Test the connection to Anki connect.',
            render: (setting) => {
              setting.addButton((button) =>
                button.setButtonText('Test connection').onClick(() => {
                  void this.testConnection();
                })
              );
              this.connectionResultEl = setting.settingEl.createDiv('panda-zap-connection-result');
            },
          },
        ],
      },
    ];
  }

  private renderAnkiConnectUrlSetting(setting: Setting): void {
    setting
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
  }

  private renderAnkiConnectPortSetting(setting: Setting): void {
    setting
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
  }

  private renderDeckWordSetting(deckSetting: Setting): void {
    const currentDeckWord =
      this.plugin.settings.deckOverrideWord || DEFAULT_SETTINGS.deckOverrideWord;
    deckSetting
      .setName('Deck override word')
      .setDesc(`Example: ${currentDeckWord}::MyDeck`)
      .addText((text) => {
        text
          .setPlaceholder('Deck')
          .setValue(this.plugin.settings.deckOverrideWord)
          .onChange((value) => {
            this.plugin.settings.deckOverrideWord = value;
            void this.plugin.saveSettings();
            const w = (value && value.trim()) || DEFAULT_SETTINGS.deckOverrideWord;
            if (deckSetting.descEl) deckSetting.descEl.textContent = `Example: ${w}::MyDeck`;
          });

        const inputEl = (text as TextComponentWithInput).inputEl;
        inputEl.addEventListener('blur', () => {
          if (!inputEl.value || !inputEl.value.trim()) {
            const def = DEFAULT_SETTINGS.deckOverrideWord;
            text.setValue(def);
            this.plugin.settings.deckOverrideWord = def;
            void this.plugin.saveSettings();
            if (deckSetting.descEl) deckSetting.descEl.textContent = `Example: ${def}::MyDeck`;
            new Notice('Deck override word cannot be empty - restored to default');
          }
        });
      });
  }

  private renderQuestionWordSetting(questionSetting: Setting): void {
    const currentQ = this.plugin.settings.questionWord || DEFAULT_SETTINGS.questionWord;
    questionSetting
      .setName('Question word')
      .setDesc(`Example: ${currentQ}: What is the capital of France?`)
      .addText((text) => {
        text
          .setPlaceholder('Q')
          .setValue(this.plugin.settings.questionWord)
          .onChange((value) => {
            if (!value || !value.trim()) return;
            this.plugin.settings.questionWord = value.trim();
            void this.plugin.saveSettings();
            const w = value.trim();
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
            new Notice('Question word cannot be empty - restored to default');
          }
          showMarkerValidation(this.plugin);
        });
      });
  }

  private renderAnswerWordSetting(answerSetting: Setting): void {
    const currentA = this.plugin.settings.answerWord || DEFAULT_SETTINGS.answerWord;
    answerSetting
      .setName('Answer word')
      .setDesc(`Example: ${currentA}: Paris`)
      .addText((text) => {
        text
          .setPlaceholder('A')
          .setValue(this.plugin.settings.answerWord)
          .onChange((value) => {
            if (!value || !value.trim()) return;
            this.plugin.settings.answerWord = value.trim();
            void this.plugin.saveSettings();
            const w = value.trim();
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
            new Notice('Answer word cannot be empty - restored to default');
          }
          showMarkerValidation(this.plugin);
        });
      });
  }

  private renderImageWordSetting(imageSetting: Setting): void {
    const currentI = this.plugin.settings.imageWord || DEFAULT_SETTINGS.imageWord;
    imageSetting
      .setName('Image word')
      .setDesc(`Example: ${currentI}: [[my-image.png]]`)
      .addText((text) => {
        text
          .setPlaceholder('I')
          .setValue(this.plugin.settings.imageWord)
          .onChange((value) => {
            if (!value || !value.trim()) return;
            this.plugin.settings.imageWord = value.trim();
            void this.plugin.saveSettings();
            const w = value.trim();
            if (imageSetting.descEl)
              imageSetting.descEl.textContent = `Example: ${w}: [[my-image.png]]`;
          });

        const inputEl = (text as TextComponentWithInput).inputEl;
        inputEl.addEventListener('blur', () => {
          if (!inputEl.value || !inputEl.value.trim()) {
            const def = DEFAULT_SETTINGS.imageWord;
            text.setValue(def);
            this.plugin.settings.imageWord = def;
            void this.plugin.saveSettings();
            if (imageSetting.descEl)
              imageSetting.descEl.textContent = `Example: ${def}: [[my-image.png]]`;
            new Notice('Image word cannot be empty - restored to default');
          }
          showMarkerValidation(this.plugin);
        });
      });
  }

  private async testConnection(): Promise<void> {
    this.connectionResultEl.empty();

    this.connectionResultEl.className = 'panda-zap-connection-result loading';
    const loadingEl = this.connectionResultEl.createDiv('connection-content');
    loadingEl.createSpan({ cls: 'connection-icon', text: 'loading' });
    loadingEl.createSpan({ cls: 'connection-text', text: 'Testing connection...' });

    try {
      const isConnected = await this.plugin.testAnkiConnection();
      this.connectionResultEl.empty();
      if (isConnected) {
        this.connectionResultEl.className = 'panda-zap-connection-result connected';
        const connectedEl = this.connectionResultEl.createDiv('connection-content');
        connectedEl.createSpan({ cls: 'connection-icon', text: 'connected' });
        connectedEl.createSpan({ cls: 'connection-text', text: 'Connected to Anki connect' });
        connectedEl.createSpan({
          cls: 'connection-details',
          text: `${this.plugin.settings.ankiConnectUrl}:${this.plugin.settings.ankiConnectPort}`,
        });
      } else {
        this.connectionResultEl.className = 'panda-zap-connection-result disconnected';
        const disconnectedEl = this.connectionResultEl.createDiv('connection-content');
        disconnectedEl.createSpan({ cls: 'connection-icon', text: 'disconnected' });
        disconnectedEl.createSpan({
          cls: 'connection-text',
          text: 'Cannot connect to Anki connect',
        });
        disconnectedEl.createSpan({
          cls: 'connection-details',
          text: 'Make sure Anki is running with Anki connect addon installed',
        });
      }
    } catch (error: unknown) {
      this.connectionResultEl.empty();
      this.connectionResultEl.className = 'panda-zap-connection-result error';
      const errorEl = this.connectionResultEl.createDiv('connection-content');
      errorEl.createSpan({ cls: 'connection-icon', text: 'error' });
      errorEl.createSpan({ cls: 'connection-text', text: 'Connection error' });
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errorEl.createSpan({ cls: 'connection-details', text: errorMsg });
    }
  }
}

function showMarkerValidation(plugin: PandaZapPlugin): void {
  const q = (plugin.settings.questionWord || '').trim().toLowerCase();
  const a = (plugin.settings.answerWord || '').trim().toLowerCase();
  const i = (plugin.settings.imageWord || '').trim().toLowerCase();
  const errors: string[] = [];
  if (q && a && q === a) errors.push('Question word and answer word must be different.');
  if (q && i && q === i) errors.push('Question word and image word must be different.');
  if (a && i && a === i) errors.push('Answer word and image word must be different.');
  if (errors.length > 0) new Notice(errors.join('; '));
}
