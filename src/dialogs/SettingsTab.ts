import { PluginSettingTab, App, Setting, Notice, SettingDefinitionItem } from 'obsidian';
import PandaZapPlugin from '../main';
import { DEFAULT_SETTINGS, describeConnection } from '../sync/types';
import { ANKI_CONNECT_VERSION } from '../constants';
import {
  ANKI_CONNECT_PORT_MAX,
  ANKI_CONNECT_PORT_MIN,
  markerLabels,
  parseAnkiConnectUrl,
  parsePort,
  restoreDefaultSettings,
  validateDeckName,
  validateDeckOverrideWord,
  validateMarkerWord,
} from '../settings';

interface TextComponentWithInput {
  inputEl: HTMLInputElement;
}

type WordSettingKey = 'deckOverrideWord' | 'questionWord' | 'answerWord' | 'imageWord';

const URL_DESCRIPTION = 'The URL where Anki connect is running.';
const URL_ERROR = 'Enter an http(s) URL or a host such as 127.0.0.1:8765.';
const PORT_DESCRIPTION = 'The port where Anki connect is running.';
const PORT_ERROR = `Port must be a whole number between ${ANKI_CONNECT_PORT_MIN} and ${ANKI_CONNECT_PORT_MAX}.`;
const DEFAULT_DECK_DESCRIPTION =
  'Deck used for all cards when note-based deck organization is off.';

export class PandaZapSettingTab extends PluginSettingTab {
  plugin: PandaZapPlugin;
  private connectionResultEl: HTMLElement;

  constructor(app: App, plugin: PandaZapPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const labels = markerLabels(this.plugin.settings);
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
            name: 'Default deck',
            desc: DEFAULT_DECK_DESCRIPTION,
            render: (setting) => this.renderDefaultDeckSetting(setting),
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
                  Object.assign(this.plugin.settings, restoreDefaultSettings(this.plugin.settings));
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
            desc: PORT_DESCRIPTION,
            render: (setting) => this.renderAnkiConnectPortSetting(setting),
          },
          {
            name: 'Deck override word',
            desc: `Example: ${this.wordValue('deckOverrideWord')}::MyDeck`,
            render: (setting) =>
              this.renderWordSetting(
                setting,
                'deckOverrideWord',
                'Deck override word',
                (w) => `Example: ${w}::MyDeck`
              ),
          },
          {
            name: 'Question word',
            desc: `Example: ${labels.q}: What is the capital of France?`,
            render: (setting) =>
              this.renderWordSetting(
                setting,
                'questionWord',
                'Question word',
                (w) => `Example: ${w}: What is the capital of France?`
              ),
          },
          {
            name: 'Answer word',
            desc: `Example: ${labels.a}: Paris`,
            render: (setting) =>
              this.renderWordSetting(
                setting,
                'answerWord',
                'Answer word',
                (w) => `Example: ${w}: Paris`
              ),
          },
          {
            name: 'Image word',
            desc: `Example: ${labels.i}: [[my-image.png]]`,
            render: (setting) =>
              this.renderWordSetting(
                setting,
                'imageWord',
                'Image word',
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

  private renderDefaultDeckSetting(setting: Setting): void {
    setting
      .setName('Default deck')
      .setDesc(DEFAULT_DECK_DESCRIPTION)
      .addText((text) => {
        const inputEl = (text as TextComponentWithInput).inputEl;
        const showDescription = (error: string | null) => {
          if (setting.descEl) setting.descEl.textContent = error ?? DEFAULT_DECK_DESCRIPTION;
        };

        text
          .setPlaceholder(DEFAULT_SETTINGS.defaultDeck)
          .setValue(this.plugin.settings.defaultDeck)
          .onChange((value) => {
            const deck = value.trim();
            const error = validateDeckName(deck);
            if (error) {
              showDescription(error);
              return;
            }
            this.plugin.settings.defaultDeck = deck;
            void this.plugin.saveSettings();
            showDescription(null);
          });

        inputEl.addEventListener('blur', () => {
          const error = validateDeckName(inputEl.value);
          inputEl.value = this.plugin.settings.defaultDeck;
          showDescription(null);
          if (error) new Notice(error);
        });
      });
  }

  private renderAnkiConnectUrlSetting(setting: Setting): void {
    setting
      .setName('Anki connect URL')
      .setDesc(URL_DESCRIPTION)
      .addText((text) => {
        const inputEl = (text as TextComponentWithInput).inputEl;
        const showDescription = (error: string | null) => {
          if (setting.descEl) setting.descEl.textContent = error ?? URL_DESCRIPTION;
        };

        text
          .setPlaceholder(DEFAULT_SETTINGS.ankiConnectUrl)
          .setValue(this.plugin.settings.ankiConnectUrl)
          .onChange((value) => {
            const url = parseAnkiConnectUrl(value);
            if (url === null) {
              showDescription(URL_ERROR);
              return;
            }
            this.plugin.settings.ankiConnectUrl = url;
            void this.plugin.saveSettings();
            showDescription(null);
          });

        inputEl.addEventListener('blur', () => {
          const isInvalid = parseAnkiConnectUrl(inputEl.value) === null;
          inputEl.value = this.plugin.settings.ankiConnectUrl;
          showDescription(null);
          if (isInvalid) new Notice(URL_ERROR);
        });
      });
  }

  private renderAnkiConnectPortSetting(setting: Setting): void {
    setting
      .setName('Anki connect port')
      .setDesc(PORT_DESCRIPTION)
      .addText((text) => {
        const inputEl = (text as TextComponentWithInput).inputEl;
        const showDescription = (error: string | null) => {
          if (setting.descEl) setting.descEl.textContent = error ?? PORT_DESCRIPTION;
        };

        text
          .setPlaceholder(String(DEFAULT_SETTINGS.ankiConnectPort))
          .setValue(String(this.plugin.settings.ankiConnectPort))
          .onChange((value) => {
            const port = parsePort(value);
            if (port === null) {
              showDescription(PORT_ERROR);
              return;
            }
            this.plugin.settings.ankiConnectPort = port;
            void this.plugin.saveSettings();
            showDescription(null);
          });

        inputEl.addEventListener('blur', () => {
          const isInvalid = parsePort(inputEl.value) === null;
          inputEl.value = String(this.plugin.settings.ankiConnectPort);
          showDescription(null);
          if (isInvalid) new Notice(PORT_ERROR);
        });
      });
  }

  private renderWordSetting(
    setting: Setting,
    key: WordSettingKey,
    label: string,
    example: (word: string) => string
  ): void {
    setting
      .setName(label)
      .setDesc(example(this.wordValue(key)))
      .addText((text) => {
        const inputEl = (text as TextComponentWithInput).inputEl;
        const showDescription = (error: string | null) => {
          if (setting.descEl) setting.descEl.textContent = error ?? example(this.wordValue(key));
        };

        text
          .setPlaceholder(DEFAULT_SETTINGS[key])
          .setValue(this.wordValue(key))
          .onChange((value) => {
            const word = value.trim();
            const formatError = this.wordFormatError(key, word);
            if (formatError) {
              showDescription(formatError);
              return;
            }
            // Duplicates are applied with a warning so question and answer words
            // can be swapped; the typed text stays visible either way.
            this.plugin.settings[key] = word;
            void this.plugin.saveSettings();
            showDescription(this.wordConflictWarning(key, word));
          });

        inputEl.addEventListener('blur', () => {
          const word = inputEl.value.trim();
          const formatError = this.wordFormatError(key, word);
          const conflict = formatError ? null : this.wordConflictWarning(key, word);
          inputEl.value = this.wordValue(key);
          showDescription(conflict);
          if (formatError) new Notice(formatError);
          else if (conflict) new Notice(conflict);
        });
      });
  }

  private wordValue(key: WordSettingKey): string {
    if (key === 'deckOverrideWord') {
      return this.plugin.settings.deckOverrideWord || DEFAULT_SETTINGS.deckOverrideWord;
    }
    const labels = markerLabels(this.plugin.settings);
    if (key === 'questionWord') return labels.q;
    if (key === 'answerWord') return labels.a;
    return labels.i;
  }

  private wordFormatError(key: WordSettingKey, word: string): string | null {
    return key === 'deckOverrideWord' ? validateDeckOverrideWord(word) : validateMarkerWord(word);
  }

  private wordConflictWarning(key: WordSettingKey, word: string): string | null {
    if (key === 'deckOverrideWord') return null;

    const labels = markerLabels(this.plugin.settings);
    const conflicts: Record<Exclude<WordSettingKey, 'deckOverrideWord'>, [string, string][]> = {
      questionWord: [
        [labels.a, 'answer'],
        [labels.i, 'image'],
      ],
      answerWord: [
        [labels.q, 'question'],
        [labels.i, 'image'],
      ],
      imageWord: [
        [labels.q, 'question'],
        [labels.a, 'answer'],
      ],
    };
    const name = {
      questionWord: 'Question word',
      answerWord: 'Answer word',
      imageWord: 'Image word',
    }[key];
    for (const [other, otherName] of conflicts[key]) {
      if (word.toLowerCase() === other.toLowerCase()) {
        return `${name} matches the ${otherName} word. Cards may not parse reliably.`;
      }
    }
    return null;
  }

  private async testConnection(): Promise<void> {
    this.connectionResultEl.empty();

    this.connectionResultEl.className = 'panda-zap-connection-result loading';
    const loadingEl = this.connectionResultEl.createDiv('connection-content');
    loadingEl.createSpan({ cls: 'connection-icon', text: 'loading' });
    loadingEl.createSpan({ cls: 'connection-text', text: 'Testing connection...' });

    const state = await this.plugin.testAnkiConnectionStatus();
    this.connectionResultEl.empty();
    if (state.status === 'ok') {
      this.connectionResultEl.className = 'panda-zap-connection-result connected';
      const connectedEl = this.connectionResultEl.createDiv('connection-content');
      connectedEl.createSpan({
        cls: 'connection-text',
        text: describeConnection(state, ANKI_CONNECT_VERSION),
      });
      connectedEl.createSpan({
        cls: 'connection-details',
        text: `${this.plugin.settings.ankiConnectUrl}:${this.plugin.settings.ankiConnectPort}`,
      });
      return;
    }

    const isProtocolIssue = state.status === 'version-too-old' || state.status === 'protocol-error';
    this.connectionResultEl.className = `panda-zap-connection-result ${isProtocolIssue ? 'error' : 'disconnected'}`;
    const resultEl = this.connectionResultEl.createDiv('connection-content');
    resultEl.createSpan({
      cls: 'connection-icon',
      text: isProtocolIssue ? 'error' : 'disconnected',
    });
    resultEl.createSpan({
      cls: 'connection-text',
      text: describeConnection(state, ANKI_CONNECT_VERSION),
    });
  }
}
