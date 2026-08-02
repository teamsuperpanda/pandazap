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
        heading: 'Note type',
        items: [
          {
            name: 'Note type',
            desc: 'The Anki note type/model used when creating new notes (e.g., Basic, Cloze).',
            render: (setting) => {
              setting.addText((text) => {
                const t = text
                  .setPlaceholder('Basic')
                  .setValue(this.plugin.settings.noteType)
                  .onChange((value) => {
                    this.plugin.settings.noteType = value.trim();
                    void this.plugin.saveSettings();
                  });

                const inputEl = (t as TextComponentWithInput).inputEl;
                inputEl.addEventListener('blur', () => {
                  if (!inputEl.value || !inputEl.value.trim()) {
                    const def = DEFAULT_SETTINGS.noteType;
                    t.setValue(def);
                    this.plugin.settings.noteType = def;
                    void this.plugin.saveSettings();
                    new Notice('Note type cannot be empty - restored to default');
                  }
                });
              });
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
                  Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
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
            render: (setting) =>
              this.renderWordSetting(
                setting,
                'deckOverrideWord',
                'Deck override word',
                'Deck',
                (w) => `Example: ${w}::MyDeck`
              ),
          },
          {
            name: 'Question word',
            desc: `Example: ${this.plugin.settings.questionWord || DEFAULT_SETTINGS.questionWord}: What is the capital of France?`,
            render: (setting) =>
              this.renderWordSetting(
                setting,
                'questionWord',
                'Question word',
                'Q',
                (w) => `Example: ${w}: What is the capital of France?`
              ),
          },
          {
            name: 'Answer word',
            desc: `Example: ${this.plugin.settings.answerWord || DEFAULT_SETTINGS.answerWord}: Paris`,
            render: (setting) =>
              this.renderWordSetting(
                setting,
                'answerWord',
                'Answer word',
                'A',
                (w) => `Example: ${w}: Paris`
              ),
          },
          {
            name: 'Image word',
            desc: `Example: ${this.plugin.settings.imageWord || DEFAULT_SETTINGS.imageWord}: [[my-image.png]]`,
            render: (setting) =>
              this.renderWordSetting(
                setting,
                'imageWord',
                'Image word',
                'I',
                (w) => `Example: ${w}: [[my-image.png]]`
              ),
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

  private renderWordSetting(
    setting: Setting,
    key: 'deckOverrideWord' | 'questionWord' | 'answerWord' | 'imageWord',
    label: string,
    placeholder: string,
    example: (word: string) => string
  ): void {
    const current = this.plugin.settings[key] || DEFAULT_SETTINGS[key];
    setting
      .setName(label)
      .setDesc(example(current))
      .addText((text) => {
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings[key])
          .onChange((value) => {
            if (key !== 'deckOverrideWord' && (!value || !value.trim())) return;
            this.plugin.settings[key] = key === 'deckOverrideWord' ? value : value.trim();
            void this.plugin.saveSettings();
            const w = (value && value.trim()) || DEFAULT_SETTINGS[key];
            if (setting.descEl) setting.descEl.textContent = example(w);
          });

        const inputEl = (text as TextComponentWithInput).inputEl;
        inputEl.addEventListener('blur', () => {
          if (!inputEl.value || !inputEl.value.trim()) {
            const def = DEFAULT_SETTINGS[key];
            text.setValue(def);
            this.plugin.settings[key] = def;
            void this.plugin.saveSettings();
            if (setting.descEl) setting.descEl.textContent = example(def);
            new Notice(`${label} cannot be empty - restored to default`);
          }
          if (key !== 'deckOverrideWord') showMarkerValidation(this.plugin);
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
