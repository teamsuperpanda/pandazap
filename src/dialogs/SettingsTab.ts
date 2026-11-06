import { PluginSettingTab, App, Setting, Notice } from 'obsidian';
import type { SettingDefinitionItem, DropdownComponent } from 'obsidian';
import PandaZapPlugin from '../main';
import { DEFAULT_SETTINGS, describeConnection } from '../sync/types';
import { ANKI_CONNECT_VERSION } from '../constants';
import {
  ANKI_CONNECT_PORT_MAX,
  ANKI_CONNECT_PORT_MIN,
  buildAnkiConnectUrl,
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
const NOTE_TYPE_DESCRIPTION =
  'The Anki note type/model used when creating new notes (e.g., Basic, Cloze).';
const PICKER_LOADING_HINT = 'Loading names from Anki...';
const PICKER_OFFLINE_HINT =
  'Anki is unreachable. The saved value is kept - check the connection, then use Refresh.';

type PickerKind = 'deck' | 'noteType';

interface PickerLists {
  key: string;
  decks: string[];
  models: string[];
}

/**
 * Options for a picker: the names Anki returned plus the saved value. The
 * saved value is always kept, even when it is missing from the list, so a
 * custom value is never lost and stays selected.
 */
function pickerOptions(names: readonly string[], savedValue: string): Record<string, string> {
  const options: Record<string, string> = {};
  for (const name of names) {
    if (name) options[name] = name;
  }
  const saved = savedValue.trim();
  if (saved && !Object.prototype.hasOwnProperty.call(options, saved)) options[saved] = saved;
  return options;
}

export class PandaZapSettingTab extends PluginSettingTab {
  plugin: PandaZapPlugin;
  private connectionResultEl: HTMLElement | null = null;
  private deckDropdown: DropdownComponent | null = null;
  private noteTypeDropdown: DropdownComponent | null = null;
  private pickerSettings: Partial<Record<PickerKind, Setting>> = {};
  /** Deck and note type names for the connection settings they came from. */
  private pickerLists: PickerLists | null = null;
  private pickerLoad: Promise<void> | null = null;

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
            name: 'Sync on save',
            desc: 'Sync a note shortly after you save it, but only when it already has Anki cards. New cards are added silently; nothing is deleted.',
            render: (setting) => {
              setting.addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncOnSave).onChange((value) => {
                  this.plugin.settings.syncOnSave = value;
                  void this.plugin.saveSettings();
                })
              );
            },
          },
          {
            name: 'Overwrite changes made in Anki',
            desc: 'Overwrite changes made in Anki when syncing. When off, cards you edited in Anki are skipped and reported. Sync on save always skips them.',
            render: (setting) => {
              setting.addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.overwriteAnkiEdits).onChange((value) => {
                  this.plugin.settings.overwriteAnkiEdits = value;
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
            desc: NOTE_TYPE_DESCRIPTION,
            render: (setting) => this.renderPicker(setting, 'noteType'),
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
    setting.setName('Default deck').setDesc(DEFAULT_DECK_DESCRIPTION);
    this.renderPicker(setting, 'deck');
  }

  /**
   * Renders a dropdown for one picker. The saved value is an option from the
   * first paint, so the row never waits on Anki and never loses a custom value;
   * the full list replaces it once the read succeeds. Refresh retries a failed
   * read without leaving the tab.
   */
  private renderPicker(setting: Setting, kind: PickerKind): void {
    this.pickerSettings[kind] = setting;
    setting.addDropdown((dropdown) => {
      if (kind === 'deck') this.deckDropdown = dropdown;
      else this.noteTypeDropdown = dropdown;
      this.fillPicker(kind, dropdown);
      dropdown.onChange((value) => {
        this.applyPickerValue(kind, value);
      });
    });
    setting.addButton((button) =>
      button.setButtonText('Refresh').onClick(() => {
        void this.refreshPickerLists(true);
      })
    );
    void this.refreshPickerLists(false);
  }

  private pickerValue(kind: PickerKind): string {
    return kind === 'deck' ? this.plugin.settings.defaultDeck : this.plugin.settings.noteType;
  }

  private pickerDescription(kind: PickerKind): string {
    return kind === 'deck' ? DEFAULT_DECK_DESCRIPTION : NOTE_TYPE_DESCRIPTION;
  }

  private pickerNames(kind: PickerKind): string[] {
    if (!this.pickerLists || this.pickerLists.key !== this.currentPickerKey()) return [];
    return kind === 'deck' ? this.pickerLists.decks : this.pickerLists.models;
  }

  private fillPicker(kind: PickerKind, dropdown: DropdownComponent): void {
    const saved = this.pickerValue(kind);
    dropdown.selectEl.empty();
    dropdown.addOptions(pickerOptions(this.pickerNames(kind), saved));
    dropdown.setValue(saved);
  }

  private fillPickers(): void {
    if (this.deckDropdown !== null) this.fillPicker('deck', this.deckDropdown);
    if (this.noteTypeDropdown !== null) this.fillPicker('noteType', this.noteTypeDropdown);
  }

  private applyPickerValue(kind: PickerKind, value: string): void {
    const selected = value.trim();
    if (!selected) {
      // An empty selection is never saved: restore the stored value instead.
      const dropdown = kind === 'deck' ? this.deckDropdown : this.noteTypeDropdown;
      dropdown?.setValue(this.pickerValue(kind));
      return;
    }
    if (kind === 'deck') {
      const error = validateDeckName(selected);
      if (error) {
        this.setPickerHint(kind, error);
        return;
      }
      this.plugin.settings.defaultDeck = selected;
    } else {
      this.plugin.settings.noteType = selected;
    }
    void this.plugin.saveSettings();
    this.setPickerHint(kind, null);
  }

  private setPickerHint(kind: PickerKind, hint: string | null): void {
    const setting = this.pickerSettings[kind];
    if (setting !== undefined) setting.descEl.textContent = hint ?? this.pickerDescription(kind);
  }

  private setPickerHints(hint: string | null): void {
    this.setPickerHint('deck', hint);
    this.setPickerHint('noteType', hint);
  }

  /** Connection settings that decide which Anki instance a picker reads. */
  private currentPickerKey(): string {
    return buildAnkiConnectUrl(this.plugin.settings);
  }

  /**
   * Fills the pickers from Anki, reusing the session cache unless forced. A
   * failure keeps the saved values and shows an inline hint; rendering and
   * saving stay available offline.
   */
  private async refreshPickerLists(force: boolean): Promise<void> {
    if (this.deckDropdown === null && this.noteTypeDropdown === null) return;
    const key = this.currentPickerKey();
    if (!force && this.pickerLists?.key === key) {
      this.fillPickers();
      return;
    }
    if (this.pickerLoad !== null) {
      // One read serves every caller; the owner reports its outcome.
      try {
        await this.pickerLoad;
      } catch {
        // The owning call already showed the hint.
      }
      return;
    }

    this.setPickerHints(PICKER_LOADING_HINT);
    // A read for new connection settings starts from the saved values, so the
    // names of the previous Anki instance cannot flash as the new ones.
    this.fillPickers();
    const load = this.loadPickerLists(key);
    this.pickerLoad = load;
    try {
      await load;
      this.fillPickers();
      this.setPickerHints(null);
    } catch {
      this.setPickerHints(PICKER_OFFLINE_HINT);
    } finally {
      if (this.pickerLoad === load) this.pickerLoad = null;
    }
  }

  private async loadPickerLists(key: string): Promise<void> {
    const { deckNames, modelNames } = await this.plugin.listAnkiNames();
    // A read that started before the connection changed must not replace the
    // lists of the new connection.
    if (key !== this.currentPickerKey()) return;
    this.pickerLists = { key, decks: deckNames, models: modelNames };
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
          // Fills from the session cache when the endpoint did not change.
          else void this.refreshPickerLists(false);
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
          else void this.refreshPickerLists(false);
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
    const resultEl = this.connectionResultEl;
    // The button that starts a test is rendered with the result element.
    if (!resultEl) return;

    resultEl.empty();

    resultEl.className = 'panda-zap-connection-result loading';
    const loadingEl = resultEl.createDiv('connection-content');
    loadingEl.createSpan({ cls: 'connection-icon', text: 'loading' });
    loadingEl.createSpan({ cls: 'connection-text', text: 'Testing connection...' });

    const state = await this.plugin.testAnkiConnectionStatus();
    resultEl.empty();
    if (state.status === 'ok') {
      resultEl.className = 'panda-zap-connection-result connected';
      const connectedEl = resultEl.createDiv('connection-content');
      connectedEl.createSpan({
        cls: 'connection-text',
        text: describeConnection(state, ANKI_CONNECT_VERSION),
      });
      connectedEl.createSpan({
        cls: 'connection-details',
        text: `${this.plugin.settings.ankiConnectUrl}:${this.plugin.settings.ankiConnectPort}`,
      });
      void this.refreshPickerLists(true);
      return;
    }

    const isProtocolIssue = state.status === 'version-too-old' || state.status === 'protocol-error';
    resultEl.className = `panda-zap-connection-result ${isProtocolIssue ? 'error' : 'disconnected'}`;
    const detailsEl = resultEl.createDiv('connection-content');
    detailsEl.createSpan({
      cls: 'connection-icon',
      text: isProtocolIssue ? 'error' : 'disconnected',
    });
    detailsEl.createSpan({
      cls: 'connection-text',
      text: describeConnection(state, ANKI_CONNECT_VERSION),
    });
  }
}
