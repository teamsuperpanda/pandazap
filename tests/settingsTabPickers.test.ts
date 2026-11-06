import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notices } = vi.hoisted(() => ({ notices: [] as string[] }));

vi.mock('obsidian', () => ({
  App: class {},
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
  PluginSettingTab: class {
    containerEl = {};
    constructor(
      public app: unknown,
      public plugin: unknown
    ) {}
  },
  Setting: class {},
}));

vi.mock('../src/main', () => ({ default: class {} }));

import type { DropdownComponent } from 'obsidian';
import { PandaZapSettingTab } from '../src/dialogs/SettingsTab';
import { DEFAULT_SETTINGS, type PandaZapSettings } from '../src/sync/types';

class FakeDropdown {
  options: Array<{ value: string; display: string }> = [];
  selectEl = {
    empty: () => {
      this.options = [];
    },
  };
  private value = '';
  private change: ((value: string) => void) | null = null;

  addOption(value: string, display: string): this {
    this.options.push({ value, display });
    return this;
  }

  addOptions(options: Record<string, string>): this {
    for (const [value, display] of Object.entries(options)) this.addOption(value, display);
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  getValue(): string {
    return this.value;
  }

  onChange(callback: (value: string) => void): this {
    this.change = callback;
    return this;
  }

  select(value: string): void {
    this.value = value;
    this.change?.(value);
  }

  get optionValues(): string[] {
    return this.options.map((option) => option.value);
  }
}

class FakeButton {
  text = '';
  handler: (() => void) | null = null;

  setButtonText(text: string): this {
    this.text = text;
    return this;
  }

  onClick(handler: () => void): this {
    this.handler = handler;
    return this;
  }

  click(): void {
    this.handler?.();
  }
}

class FakeToggle {
  value = false;
  private change: ((value: boolean) => void) | null = null;

  setValue(value: boolean): this {
    this.value = value;
    return this;
  }

  onChange(callback: (value: boolean) => void): this {
    this.change = callback;
    return this;
  }

  toggle(): void {
    this.value = !this.value;
    this.change?.(this.value);
  }
}

class FakeSetting {
  descEl = { textContent: '' };
  settingEl = {
    classes: new Set<string>(),
    addClass: (name: string): void => {
      this.settingEl.classes.add(name);
    },
    createDiv: (cls: string): { className: string } => ({ className: cls }),
  };
  dropdowns: FakeDropdown[] = [];
  buttons: FakeButton[] = [];
  toggles: FakeToggle[] = [];

  setName(_name: string): this {
    return this;
  }

  setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }

  addDropdown(callback: (dropdown: DropdownComponent) => unknown): this {
    const dropdown = new FakeDropdown();
    this.dropdowns.push(dropdown);
    callback(dropdown as unknown as DropdownComponent);
    return this;
  }

  addButton(callback: (button: FakeButton) => unknown): this {
    const button = new FakeButton();
    this.buttons.push(button);
    callback(button);
    return this;
  }

  addToggle(callback: (toggle: FakeToggle) => unknown): this {
    const toggle = new FakeToggle();
    this.toggles.push(toggle);
    callback(toggle);
    return this;
  }

  get dropdown(): FakeDropdown {
    return this.dropdowns[0];
  }
}

interface DefinitionLike {
  name?: string;
  desc?: string;
  items?: DefinitionLike[];
  render?: (setting: FakeSetting, group: never) => void;
}

function findDefinition(tab: PandaZapSettingTab, name: string): DefinitionLike {
  const definitions = tab.getSettingDefinitions() as unknown as DefinitionLike[];
  const stack = [...definitions];
  while (stack.length > 0) {
    const definition = stack.shift();
    if (!definition) continue;
    if (definition.items) stack.push(...definition.items);
    if (definition.name === name) return definition;
  }
  throw new Error(`No setting named ${name}`);
}

function renderSetting(tab: PandaZapSettingTab, name: string): FakeSetting {
  const definition = findDefinition(tab, name);
  if (!definition.render) throw new Error(`No render for setting ${name}`);
  const setting = new FakeSetting();
  definition.render(setting, {} as never);
  return setting;
}

function pluginStub(overrides: Partial<PandaZapSettings> = {}) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    listAnkiNames: vi.fn().mockResolvedValue({
      deckNames: ['Default', 'Spanish::Vocab'],
      modelNames: ['Basic', 'Cloze'],
    }),
    testAnkiConnectionStatus: vi.fn(),
  };
}

type PluginStub = ReturnType<typeof pluginStub>;

function createTab(plugin: PluginStub): PandaZapSettingTab {
  return new PandaZapSettingTab({} as never, plugin as never);
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('settings pickers', () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it('offers the names Anki returned plus the saved deck', async () => {
    const plugin = pluginStub({ defaultDeck: 'MyCustomDeck' });
    const setting = renderSetting(createTab(plugin), 'Default deck');

    await flush();

    expect(setting.dropdown.optionValues).toEqual(['Default', 'Spanish::Vocab', 'MyCustomDeck']);
    expect(setting.dropdown.getValue()).toBe('MyCustomDeck');
    expect(setting.descEl.textContent).not.toContain('unreachable');
  });

  it('offers the names Anki returned plus the saved note type', async () => {
    const plugin = pluginStub({ noteType: 'BasicPlus' });
    const setting = renderSetting(createTab(plugin), 'Note type');

    await flush();

    expect(setting.dropdown.optionValues).toEqual(['Basic', 'Cloze', 'BasicPlus']);
    expect(setting.dropdown.getValue()).toBe('BasicPlus');
  });

  it('persists a selected deck through the save path', async () => {
    const plugin = pluginStub();
    const setting = renderSetting(createTab(plugin), 'Default deck');
    await flush();

    setting.dropdown.select('Spanish::Vocab');

    expect(plugin.settings.defaultDeck).toBe('Spanish::Vocab');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('persists a selected note type through the save path', async () => {
    const plugin = pluginStub();
    const setting = renderSetting(createTab(plugin), 'Note type');
    await flush();

    setting.dropdown.select('Cloze');

    expect(plugin.settings.noteType).toBe('Cloze');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('never persists an empty selection', async () => {
    const plugin = pluginStub();
    const setting = renderSetting(createTab(plugin), 'Default deck');
    await flush();

    setting.dropdown.select('');

    expect(plugin.settings.defaultDeck).toBe(DEFAULT_SETTINGS.defaultDeck);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(setting.dropdown.getValue()).toBe(DEFAULT_SETTINGS.defaultDeck);
  });

  it('renders and saves the saved value when Anki is unreachable', async () => {
    const plugin = pluginStub({ defaultDeck: 'OfflineDeck' });
    plugin.listAnkiNames.mockRejectedValue(new Error('unreachable'));

    const setting = renderSetting(createTab(plugin), 'Default deck');
    await flush();

    expect(setting.dropdown.optionValues).toEqual(['OfflineDeck']);
    expect(setting.dropdown.getValue()).toBe('OfflineDeck');
    expect(setting.descEl.textContent).toContain('Anki is unreachable');
    expect(setting.buttons.map((button) => button.text)).toContain('Refresh');

    setting.dropdown.select('OfflineDeck');
    expect(plugin.settings.defaultDeck).toBe('OfflineDeck');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('refreshes the names from the Refresh button', async () => {
    const plugin = pluginStub();
    const setting = renderSetting(createTab(plugin), 'Default deck');
    await flush();

    plugin.listAnkiNames.mockResolvedValue({
      deckNames: ['Default', 'French'],
      modelNames: ['Basic'],
    });
    setting.buttons[0].click();
    await flush();

    expect(plugin.listAnkiNames).toHaveBeenCalledTimes(2);
    expect(setting.dropdown.optionValues).toEqual(['Default', 'French']);
  });

  it('exposes and saves the Anki edit overwrite setting', () => {
    const plugin = pluginStub();
    const tab = createTab(plugin);
    const setting = renderSetting(tab, 'Overwrite changes made in Anki');

    expect(tab.getSettingDefinitions()).toBeDefined();
    expect(findDefinition(tab, 'Overwrite changes made in Anki').desc).toContain(
      'Overwrite changes made in Anki when syncing'
    );

    setting.toggles[0].toggle();

    expect(plugin.settings.overwriteAnkiEdits).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('caches the names per connection and refreshes when it changes', async () => {
    const plugin = pluginStub();
    const tab = createTab(plugin);
    renderSetting(tab, 'Default deck');
    renderSetting(tab, 'Note type');
    await flush();

    expect(plugin.listAnkiNames).toHaveBeenCalledTimes(1);

    renderSetting(tab, 'Default deck');
    await flush();
    expect(plugin.listAnkiNames).toHaveBeenCalledTimes(1);

    plugin.settings.ankiConnectPort = 9000;
    renderSetting(tab, 'Default deck');
    await flush();
    expect(plugin.listAnkiNames).toHaveBeenCalledTimes(2);
  });

  it('runs one more read when Refresh arrives while a read is in flight', async () => {
    const plugin = pluginStub();
    let releaseFirst: ((names: { deckNames: string[]; modelNames: string[] }) => void) | undefined;
    const first = new Promise<{ deckNames: string[]; modelNames: string[] }>((resolve) => {
      releaseFirst = resolve;
    });
    plugin.listAnkiNames
      .mockReturnValueOnce(first)
      .mockResolvedValue({ deckNames: ['Default', 'French'], modelNames: ['Basic'] });

    const setting = renderSetting(createTab(plugin), 'Default deck');
    setting.buttons[0].click();

    releaseFirst?.({ deckNames: ['Default', 'Old'], modelNames: ['Basic'] });

    await vi.waitFor(() => expect(plugin.listAnkiNames).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(setting.dropdown.optionValues).toEqual(['Default', 'French']));
  });

  it('keeps the hint up when the endpoint changes while a read is in flight', async () => {
    const plugin = pluginStub();
    let releaseFirst: ((names: { deckNames: string[]; modelNames: string[] }) => void) | undefined;
    const first = new Promise<{ deckNames: string[]; modelNames: string[] }>((resolve) => {
      releaseFirst = resolve;
    });
    plugin.listAnkiNames.mockReturnValueOnce(first);

    const tab = createTab(plugin);
    const setting = renderSetting(tab, 'Default deck');
    plugin.settings.ankiConnectPort = 9000;

    releaseFirst?.({ deckNames: ['Default', 'StaleDeck'], modelNames: ['Basic'] });
    await flush();
    await flush();

    // The old endpoint's names are not adopted, and the row does not pretend
    // the list is current: the hint is left until the next read succeeds.
    expect(setting.dropdown.optionValues).toEqual(['Default']);
    expect(setting.descEl.textContent).toContain('Loading names from Anki');
    expect(plugin.listAnkiNames).toHaveBeenCalledTimes(1);
  });

  it('lets the connection banner span the row instead of squeezing the button', () => {
    const tab = createTab(pluginStub());
    const setting = renderSetting(tab, 'Test Anki connection');

    expect(setting.settingEl.classes.has('panda-zap-connection-setting')).toBe(true);
  });
});
