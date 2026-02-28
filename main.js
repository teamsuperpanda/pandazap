

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PandaZapPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian7 = require("obsidian");

// src/dialogs/SyncModal.ts
var import_obsidian2 = require("obsidian");

// src/dialogs/PreviewModal.ts
var import_obsidian = require("obsidian");
var PreviewModal = class extends import_obsidian.Modal {
  constructor(app, syncAnalysis, settings) {
    super(app);
    this.syncAnalysis = syncAnalysis;
    this.settings = settings;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("panda-zap-preview-modal");
    const header = contentEl.createDiv("panda-zap-preview-header");
    header.createEl("h2", { text: "Preview changes" });
    const content = contentEl.createDiv("panda-zap-preview-content");
    const totalChanges = this.syncAnalysis.cardsToAdd.length + this.syncAnalysis.cardsToUpdate.length + this.syncAnalysis.cardsToDelete.length;
    if (totalChanges === 0) {
      const emptyState = content.createDiv("panda-zap-empty-state");
      emptyState.createSpan({ text: "\u2728 No changes needed - all cards are up to date!" });
      return;
    }
    if (this.syncAnalysis.cardsToAdd.length > 0) {
      this.renderSection(content, "add", "\u{1F4DD} Cards to Add", this.syncAnalysis.cardsToAdd);
    }
    if (this.syncAnalysis.cardsToUpdate.length > 0) {
      this.renderSection(content, "update", "\u{1F504} Cards to Update", this.syncAnalysis.cardsToUpdate);
    }
    if (this.syncAnalysis.cardsToDelete.length > 0) {
      this.renderSection(content, "delete", "\u{1F5D1}\uFE0F Cards to Remove", this.syncAnalysis.cardsToDelete);
    }
  }
  renderSection(container, type, title, cards) {
    const section = container.createDiv("panda-zap-preview-section");
    const sectionHeader = section.createDiv("panda-zap-section-header");
    const toggleIcon = sectionHeader.createSpan({ cls: "panda-zap-toggle-icon expanded" });
    toggleIcon.textContent = "\u25BC";
    sectionHeader.createSpan({
      text: `${title} (${cards.length})`,
      cls: "panda-zap-section-title"
    });
    const cardsContainer = section.createDiv("panda-zap-cards-container expanded");
    sectionHeader.onclick = () => {
      const isExpanded = toggleIcon.classList.contains("expanded");
      if (isExpanded) {
        toggleIcon.classList.remove("expanded");
        toggleIcon.textContent = "\u25B6";
        cardsContainer.classList.remove("expanded");
        cardsContainer.classList.add("collapsed");
      } else {
        toggleIcon.classList.add("expanded");
        toggleIcon.textContent = "\u25BC";
        cardsContainer.classList.remove("collapsed");
        cardsContainer.classList.add("expanded");
      }
    };
    cards.forEach((cardInfo, index) => {
      const cardElement = cardsContainer.createDiv(`panda-zap-card ${type}`);
      const cardHeader = cardElement.createDiv("panda-zap-card-header panda-zap-card-header-stacked");
      cardHeader.createSpan({ text: `Card ${index + 1}`, cls: "panda-zap-card-number" });
      cardHeader.createSpan({ text: `Deck: ${cardInfo.deckName}`, cls: "panda-zap-card-deck" });
      const cardContent = cardElement.createDiv("panda-zap-card-content");
      const questionDiv = cardContent.createDiv("panda-zap-card-question");
      questionDiv.createSpan({
        text: `${this.settings.questionWord}: `,
        cls: "panda-zap-card-label"
      });
      questionDiv.createSpan({ text: cardInfo.card.question, cls: "panda-zap-card-text" });
      const answerDiv = cardContent.createDiv("panda-zap-card-answer");
      answerDiv.createSpan({
        text: `${this.settings.answerWord}: `,
        cls: "panda-zap-card-label"
      });
      const answerText = cardInfo.card.answer || "(image only)";
      answerDiv.createSpan({ text: answerText, cls: "panda-zap-card-text" });
      if (cardInfo.card.image) {
        const imageDiv = cardContent.createDiv("panda-zap-card-image");
        imageDiv.createSpan({
          text: `Image: `,
          cls: "panda-zap-card-label"
        });
        imageDiv.createSpan({ text: cardInfo.card.image, cls: "panda-zap-card-text" });
      }
    });
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};

// src/dialogs/SyncModal.ts
var SyncModal = class _SyncModal extends import_obsidian2.Modal {
  constructor(app, plugin) {
    super(app);
    this.syncAnalysis = null;
    this.isConnected = false;
    this.plugin = plugin;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("panda-zap-sync-modal");
    const header = contentEl.createDiv("panda-zap-header");
    const gearBtn = contentEl.createEl("button", { cls: "panda-zap-settings-gear", text: "\u2699\uFE0F" });
    gearBtn.setAttr("aria-label", "Open Panda Zap settings");
    gearBtn.setAttr("title", "Open plugin settings");
    gearBtn.onclick = () => this.openSettings();
    header.createEl("h2", { text: "Panda zap" });
    const loadingOverlay = contentEl.createDiv("panda-zap-spinner-overlay panda-zap-loading-overlay");
    const loadingText = loadingOverlay.createDiv("panda-zap-loading-text");
    loadingText.textContent = "Loading...";
    await this.checkConnectionAndLoadAnalysis();
    loadingOverlay.remove();
    const statusContainer = contentEl.createDiv("panda-zap-status-container");
    this.renderStatus(statusContainer);
    const summaryContainer = contentEl.createDiv("panda-zap-summary");
    this.renderSyncSummary(summaryContainer);
    const buttonContainer = contentEl.createDiv("panda-zap-button-container");
    this.renderButtons(buttonContainer);
    contentEl.createDiv("panda-zap-results hidden");
  }
  async checkConnectionAndLoadAnalysis() {
    try {
      this.isConnected = await this.plugin.testAnkiConnection();
      if (this.isConnected) {
        this.syncAnalysis = await this.plugin.analyzeSyncOperation();
      }
    } catch (e) {
      this.isConnected = false;
    }
  }
  renderStatus(statusContainer) {
    statusContainer.empty();
    if (!this.isConnected) {
      const statusDiv2 = statusContainer.createDiv("panda-zap-status-minimal");
      const dot2 = statusDiv2.createSpan({ cls: "panda-zap-status-dot error" });
      if (!this.isCssAvailable(dot2))
        statusDiv2.createSpan({ text: "\u2022 ", cls: "panda-zap-status-text error" });
      statusDiv2.createSpan({
        text: "Not connected to Anki",
        cls: "panda-zap-status-text error"
      });
      return;
    }
    const statusDiv = statusContainer.createDiv("panda-zap-status-minimal");
    const dot = statusDiv.createSpan({ cls: "panda-zap-status-dot success" });
    if (!this.isCssAvailable(dot))
      statusDiv.createSpan({ text: "\u2022 ", cls: "panda-zap-status-text success" });
    statusDiv.createSpan({ text: "Connected to Anki", cls: "panda-zap-status-text success" });
  }
  isCssAvailable(testEl) {
    const w = testEl.offsetWidth;
    const h = testEl.offsetHeight;
    return w >= 8 && h >= 8;
  }
  renderSyncSummary(container) {
    container.empty();
    if (!this.syncAnalysis) {
      if (this.isConnected) {
        const emptyState = container.createDiv("panda-zap-empty-state");
        emptyState.createSpan({ text: "No sync analysis available" });
      }
      return;
    }
    const summary = container.createDiv("panda-zap-sync-summary");
    summary.createEl("h3", { text: "Summary" });
    const pillsContainer = summary.createDiv("panda-zap-pills-container");
    const addPill = pillsContainer.createDiv("panda-zap-pill add");
    addPill.createSpan({
      text: this.syncAnalysis.cardsToAdd.length.toString(),
      cls: "panda-zap-pill-number"
    });
    addPill.createSpan({ text: " to add", cls: "panda-zap-pill-label" });
    const updatePill = pillsContainer.createDiv("panda-zap-pill update");
    updatePill.createSpan({
      text: this.syncAnalysis.cardsToUpdate.length.toString(),
      cls: "panda-zap-pill-number"
    });
    updatePill.createSpan({ text: " to update", cls: "panda-zap-pill-label" });
    const deletePill = pillsContainer.createDiv("panda-zap-pill delete");
    deletePill.createSpan({
      text: this.syncAnalysis.cardsToDelete.length.toString(),
      cls: "panda-zap-pill-number"
    });
    deletePill.createSpan({ text: " to remove", cls: "panda-zap-pill-label" });
    if (!this.isCssAvailable(addPill)) {
      summary.empty();
      const list = summary.createEl("ul");
      list.createEl("li", { text: `${this.syncAnalysis.cardsToAdd.length} to add` });
      list.createEl("li", { text: `${this.syncAnalysis.cardsToUpdate.length} to update` });
      list.createEl("li", { text: `${this.syncAnalysis.cardsToDelete.length} to remove` });
    }
  }
  renderButtons(container) {
    container.empty();
    const buttonGroup = container.createDiv("panda-zap-button-group");
    if (!this.isConnected) {
      const testBtn = buttonGroup.createEl("button", {
        text: "Test connection",
        cls: "panda-zap-btn panda-zap-btn-secondary"
      });
      testBtn.onclick = async () => {
        testBtn.disabled = true;
        testBtn.textContent = "Testing...";
        try {
          const connected = await this.plugin.testAnkiConnection();
          if (connected) {
            new import_obsidian2.Notice("Connected to Anki!");
            this.close();
            new _SyncModal(this.app, this.plugin).open();
          } else {
            new import_obsidian2.Notice("Still not connected to Anki");
          }
        } catch (e) {
          new import_obsidian2.Notice("Connection test failed");
        }
        testBtn.disabled = false;
        testBtn.textContent = "Test connection";
      };
    } else {
      const previewBtn = buttonGroup.createEl("button", {
        text: "Preview changes",
        cls: "panda-zap-btn panda-zap-btn-secondary"
      });
      previewBtn.onclick = () => this.showPreview();
      const syncBtn = buttonGroup.createEl("button", {
        text: "Sync to Anki",
        cls: "panda-zap-btn panda-zap-btn-primary"
      });
      syncBtn.onclick = () => this.performSync();
    }
  }
  showPreview() {
    if (!this.syncAnalysis) {
      new import_obsidian2.Notice("No analysis available");
      return;
    }
    new PreviewModal(this.app, this.syncAnalysis, this.plugin.settings).open();
  }
  // Show a styled Obsidian modal to confirm deletion, returns true if user confirms
  showDeleteConfirmation(count) {
    return new Promise((resolve) => {
      const m = new import_obsidian2.Modal(this.app);
      m.contentEl.addClass("panda-zap-delete-confirm");
      m.contentEl.createEl("h3", { text: "Confirm deletion" });
      const msg = m.contentEl.createDiv("panda-zap-delete-msg");
      msg.textContent = `This will delete ${count} cards from Anki that were removed from this note. Proceed?`;
      const btnRow = m.contentEl.createDiv("panda-zap-button-row");
      const cancel = btnRow.createEl("button", {
        cls: "panda-zap-btn panda-zap-btn-tertiary",
        text: "Cancel"
      });
      const confirm = btnRow.createEl("button", {
        cls: "panda-zap-btn panda-zap-btn-primary",
        text: "Delete"
      });
      cancel.onclick = () => {
        resolve(false);
        m.close();
      };
      confirm.onclick = () => {
        resolve(true);
        m.close();
      };
      m.open();
    });
  }
  async performSync() {
    if (!this.isConnected) {
      new import_obsidian2.Notice("Cannot sync: no connection to Anki");
      return;
    }
    try {
      const cards = this.plugin.extractCardsFromCurrentNote();
      if (cards.length === 0) {
        const qTag = `${this.plugin.settings.questionWord}:`;
        const aTag = `${this.plugin.settings.answerWord}:`;
        new import_obsidian2.Notice(`No ${qTag} ${aTag} cards found in current note`);
        return;
      }
      if (!this.syncAnalysis) {
        try {
          this.syncAnalysis = await this.plugin.analyzeSyncOperation();
        } catch (e) {
        }
      }
      let deleteConfirmed = false;
      if (this.syncAnalysis && this.syncAnalysis.cardsToDelete.length > 0) {
        const userConfirmed = await this.showDeleteConfirmation(
          this.syncAnalysis.cardsToDelete.length
        );
        if (!userConfirmed) {
          this.close();
          return;
        }
        deleteConfirmed = true;
      }
      const summaryContainer = this.contentEl.querySelector(".panda-zap-summary");
      const buttonContainer = this.contentEl.querySelector(
        ".panda-zap-button-container"
      );
      const resultContainer = this.contentEl.querySelector(".panda-zap-results");
      if (summaryContainer instanceof HTMLElement) summaryContainer.classList.add("hidden");
      if (buttonContainer instanceof HTMLElement) buttonContainer.classList.add("hidden");
      if (resultContainer instanceof HTMLElement) {
        resultContainer.classList.remove("hidden");
        resultContainer.classList.add("visible");
        resultContainer.empty();
        const loadingList = resultContainer.createDiv("panda-zap-results-list");
        const loadingItem = loadingList.createDiv("panda-zap-result-item");
        loadingItem.createSpan({ text: "Syncing..." });
      }
      new import_obsidian2.Notice("Syncing cards to Anki...");
      const results = await this.plugin.syncCardsToAnki(cards, false, deleteConfirmed);
      const finalResultContainer = this.contentEl.querySelector(
        ".panda-zap-results"
      );
      if (!(finalResultContainer instanceof HTMLElement)) return;
      finalResultContainer.classList.remove("hidden");
      finalResultContainer.classList.add("visible");
      finalResultContainer.empty();
      finalResultContainer.createEl("h3", { text: "Sync results" });
      const resultsList = finalResultContainer.createDiv("panda-zap-results-list");
      const skipped = [];
      results.forEach((result) => {
        const lowered = result.toLowerCase();
        if (lowered.includes("skipped") && (lowered.includes("already") || lowered.includes("exists") || lowered.includes("skip"))) {
          skipped.push(result);
        } else {
          const item = resultsList.createDiv("panda-zap-result-item");
          item.createSpan({ text: result });
        }
      });
      if (skipped.length > 0) {
        const skipHeader = finalResultContainer.createDiv("panda-zap-section-header");
        const toggle = skipHeader.createSpan({ cls: "panda-zap-toggle-icon", text: "\u25B8" });
        skipHeader.createDiv({
          cls: "panda-zap-section-title",
          text: `Skipped (${skipped.length})`
        });
        const skippedList = finalResultContainer.createDiv("panda-zap-results-list panda-zap-skipped-list hidden");
        skipped.forEach((s) => {
          const item = skippedList.createDiv("panda-zap-result-item");
          item.createSpan({ text: s });
        });
        skipHeader.onclick = () => {
          const isHidden = skippedList.classList.contains("hidden");
          if (isHidden) {
            skippedList.classList.remove("hidden");
            skippedList.classList.add("visible");
          } else {
            skippedList.classList.remove("visible");
            skippedList.classList.add("hidden");
          }
          toggle.textContent = isHidden ? "\u25BE" : "\u25B8";
        };
      }
      const deletedLine = results.find(
        (r) => /deleted\s+\d+\s+notes/i.test(r) || r.includes("Deleted") && r.includes("notes")
      );
      if (deleteConfirmed && deletedLine) {
        let deletionAnalysis = this.syncAnalysis;
        if (!deletionAnalysis) {
          try {
            deletionAnalysis = await this.plugin.analyzeSyncOperation();
          } catch (e) {
          }
        }
        if (deletionAnalysis && deletionAnalysis.cardsToDelete && deletionAnalysis.cardsToDelete.length > 0) {
          const deletedSection = finalResultContainer.createDiv("panda-zap-deleted-section");
          deletedSection.createEl("h4", {
            text: `Deleted notes (${deletionAnalysis.cardsToDelete.length})`
          });
          const deletedList = deletedSection.createDiv("panda-zap-results-list");
          deletionAnalysis.cardsToDelete.forEach((cd) => {
            const item = deletedList.createDiv("panda-zap-result-item");
            const id = cd.existingCardId || "unknown-id";
            const q = cd.card && cd.card.question ? cd.card.question : "<no question>";
            const a = cd.card && cd.card.answer ? cd.card.answer : "<no answer>";
            item.createSpan({ text: `\u{1F5D1}\uFE0F ${q} \u2192 ${cd.deckName} (id: ${id})` });
            if (a) {
              const meta = item.createDiv({ cls: "panda-zap-card-meta" });
              meta.createSpan({ text: `Answer: ${a}`, cls: "panda-zap-card-line" });
            }
          });
        }
      }
      new import_obsidian2.Notice(`\u2705 Sync completed! ${cards.length} cards processed`);
    } catch (error) {
      try {
        const summaryContainer = this.contentEl.querySelector(
          ".panda-zap-summary"
        );
        const buttonContainer = this.contentEl.querySelector(
          ".panda-zap-button-container"
        );
        if (summaryContainer instanceof HTMLElement) summaryContainer.classList.remove("hidden");
        if (buttonContainer instanceof HTMLElement) buttonContainer.classList.remove("hidden");
      } catch (e) {
      }
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      new import_obsidian2.Notice(`\u274C Sync failed: ${errorMsg}`);
    }
  }
  openSettings() {
    this.close();
    const appWithSetting = this.app;
    appWithSetting.setting.open();
    appWithSetting.setting.openTabById("panda-zap");
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};

// src/dialogs/SettingsTab.ts
var import_obsidian3 = require("obsidian");

// src/constants.ts
var ANKI_CONNECT_VERSION = 6;
var ANKI_CONNECT_DEFAULT_PORT = 8765;
var ANKI_CONNECT_DEFAULT_URL = "http://127.0.0.1";
var PLUGIN_TAG = "panda-zap";
var CSS_CLASSES = {
  QA_PROCESSED: "panda-zap-qa-processed"
};

// src/sync/types.ts
var DEFAULT_SETTINGS = {
  ankiConnectUrl: ANKI_CONNECT_DEFAULT_URL,
  ankiConnectPort: ANKI_CONNECT_DEFAULT_PORT,
  defaultDeck: "Default",
  deckOverrideWord: "Deck",
  imageWord: "I",
  questionWord: "Q",
  answerWord: "A",
  noteType: "Basic",
  useNoteBased: true,
  boldQuestionInReadingMode: true
};

// src/dialogs/SettingsTab.ts
var PandaZapSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian3.Setting(containerEl).setName("Sync").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Use note-based deck organization").setDesc(
      "Create Anki decks based on note location and name. If disabled, uses the default deck below."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.useNoteBased).onChange((value) => {
        this.plugin.settings.useNoteBased = value;
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Bold question in reading mode").setDesc(
      "When enabled, only the question (not the answer) will be bolded in reading mode; question/answer tags are still removed."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.boldQuestionInReadingMode).onChange((value) => {
        this.plugin.settings.boldQuestionInReadingMode = value;
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Anki connect").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Restore defaults").setDesc("Restore all settings to default values.").addButton(
      (button) => button.setButtonText("Restore defaults").onClick(() => {
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
        void this.plugin.saveSettings().then(() => {
          new import_obsidian3.Notice("Settings restored to defaults");
          this.display();
        });
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Anki connect URL").setDesc("The URL where Anki connect is running.").addText(
      (text) => text.setPlaceholder("http://127.0.0.1").setValue(this.plugin.settings.ankiConnectUrl).onChange((value) => {
        this.plugin.settings.ankiConnectUrl = value;
        void this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Anki connect port").setDesc("The port where Anki connect is running.").addText(
      (text) => text.setPlaceholder("8765").setValue(this.plugin.settings.ankiConnectPort.toString()).onChange((value) => {
        this.plugin.settings.ankiConnectPort = parseInt(value) || 8765;
        void this.plugin.saveSettings();
      })
    );
    const currentDeckWord = this.plugin.settings.deckOverrideWord || DEFAULT_SETTINGS.deckOverrideWord;
    const deckSetting = new import_obsidian3.Setting(containerEl).setName("Deck override word").setDesc(`Example: ${currentDeckWord}::MyDeck`).addText((text) => {
      text.setPlaceholder("Deck").setValue(this.plugin.settings.deckOverrideWord).onChange((value) => {
        this.plugin.settings.deckOverrideWord = value;
        void this.plugin.saveSettings();
        const w = value && value.trim() || DEFAULT_SETTINGS.deckOverrideWord;
        if (deckSetting.descEl) deckSetting.descEl.textContent = `Example: ${w}::MyDeck`;
      });
      const inputEl = text.inputEl;
      inputEl.addEventListener("blur", () => {
        if (!inputEl.value || !inputEl.value.trim()) {
          const def = DEFAULT_SETTINGS.deckOverrideWord;
          text.setValue(def);
          this.plugin.settings.deckOverrideWord = def;
          void this.plugin.saveSettings();
          if (deckSetting.descEl) deckSetting.descEl.textContent = `Example: ${def}::MyDeck`;
          new import_obsidian3.Notice("Deck override word cannot be empty \u2014 restored to default");
        }
      });
    });
    const currentQ = this.plugin.settings.questionWord || DEFAULT_SETTINGS.questionWord;
    const questionSetting = new import_obsidian3.Setting(containerEl).setName("Question word").setDesc(`Example: ${currentQ}: What is the capital of France?`).addText((text) => {
      text.setPlaceholder("Q").setValue(this.plugin.settings.questionWord).onChange((value) => {
        this.plugin.settings.questionWord = value;
        void this.plugin.saveSettings();
        const w = value && value.trim() || DEFAULT_SETTINGS.questionWord;
        if (questionSetting.descEl)
          questionSetting.descEl.textContent = `Example: ${w}: What is the capital of France?`;
      });
      const inputEl = text.inputEl;
      inputEl.addEventListener("blur", () => {
        if (!inputEl.value || !inputEl.value.trim()) {
          const def = DEFAULT_SETTINGS.questionWord;
          text.setValue(def);
          this.plugin.settings.questionWord = def;
          void this.plugin.saveSettings();
          if (questionSetting.descEl)
            questionSetting.descEl.textContent = `Example: ${def}: What is the capital of France?`;
          new import_obsidian3.Notice("Question word cannot be empty \u2014 restored to default");
        }
      });
    });
    const currentA = this.plugin.settings.answerWord || DEFAULT_SETTINGS.answerWord;
    const answerSetting = new import_obsidian3.Setting(containerEl).setName("Answer word").setDesc(`Example: ${currentA}: Paris`).addText((text) => {
      text.setPlaceholder("A").setValue(this.plugin.settings.answerWord).onChange((value) => {
        this.plugin.settings.answerWord = value;
        void this.plugin.saveSettings();
        const w = value && value.trim() || DEFAULT_SETTINGS.answerWord;
        if (answerSetting.descEl) answerSetting.descEl.textContent = `Example: ${w}: Paris`;
      });
      const inputEl = text.inputEl;
      inputEl.addEventListener("blur", () => {
        if (!inputEl.value || !inputEl.value.trim()) {
          const def = DEFAULT_SETTINGS.answerWord;
          text.setValue(def);
          this.plugin.settings.answerWord = def;
          void this.plugin.saveSettings();
          if (answerSetting.descEl) answerSetting.descEl.textContent = `Example: ${def}: Paris`;
          new import_obsidian3.Notice("Answer word cannot be empty \u2014 restored to default");
        }
      });
    });
    const currentI = this.plugin.settings.imageWord || DEFAULT_SETTINGS.imageWord;
    const imageSetting = new import_obsidian3.Setting(containerEl).setName("Image word").setDesc(`Example: ${currentI}: [[my-image.png]]`).addText((text) => {
      text.setPlaceholder("I").setValue(this.plugin.settings.imageWord).onChange((value) => {
        this.plugin.settings.imageWord = value;
        void this.plugin.saveSettings();
        const w = value && value.trim() || DEFAULT_SETTINGS.imageWord;
        if (imageSetting.descEl) imageSetting.descEl.textContent = `Example: ${w}: [[my-image.png]]`;
      });
      const inputEl = text.inputEl;
      inputEl.addEventListener("blur", () => {
        if (!inputEl.value || !inputEl.value.trim()) {
          const def = DEFAULT_SETTINGS.imageWord;
          text.setValue(def);
          this.plugin.settings.imageWord = def;
          void this.plugin.saveSettings();
          if (imageSetting.descEl) imageSetting.descEl.textContent = `Example: ${def}: [[my-image.png]]`;
          new import_obsidian3.Notice("Image word cannot be empty \u2014 restored to default");
        }
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Test Anki connection").setDesc("Test the connection to Anki connect.").addButton(
      (button) => button.setButtonText("Test connection").onClick(() => {
        void this.testConnection();
      })
    );
    this.connectionResultEl = containerEl.createDiv("panda-zap-connection-result");
  }
  async testConnection() {
    this.connectionResultEl.empty();
    this.connectionResultEl.className = "panda-zap-connection-result loading";
    const loadingEl = this.connectionResultEl.createDiv("connection-content");
    loadingEl.createEl("span", { cls: "connection-icon", text: "\u23F3" });
    loadingEl.createEl("span", { cls: "connection-text", text: "Testing connection..." });
    try {
      const isConnected = await this.plugin.testAnkiConnection();
      this.connectionResultEl.empty();
      if (isConnected) {
        this.connectionResultEl.className = "panda-zap-connection-result connected";
        const connectedEl = this.connectionResultEl.createDiv("connection-content");
        connectedEl.createEl("span", { cls: "connection-icon", text: "\u2705 " });
        connectedEl.createEl("span", { cls: "connection-text", text: "Connected to Anki connect" });
        connectedEl.createEl("span", {
          cls: "connection-details",
          text: `${this.plugin.settings.ankiConnectUrl}:${this.plugin.settings.ankiConnectPort}`
        });
      } else {
        this.connectionResultEl.className = "panda-zap-connection-result disconnected";
        const disconnectedEl = this.connectionResultEl.createDiv("connection-content");
        disconnectedEl.createEl("span", { cls: "connection-icon", text: "\u274C " });
        disconnectedEl.createEl("span", {
          cls: "connection-text",
          text: "Cannot connect to Anki connect"
        });
        disconnectedEl.createEl("span", {
          cls: "connection-details",
          text: "Make sure Anki is running with Anki connect addon installed"
        });
      }
    } catch (error) {
      this.connectionResultEl.empty();
      this.connectionResultEl.className = "panda-zap-connection-result error";
      const errorEl = this.connectionResultEl.createDiv("connection-content");
      errorEl.createEl("span", { cls: "connection-icon", text: "\u26A0\uFE0F " });
      errorEl.createEl("span", { cls: "connection-text", text: "Connection error" });
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      errorEl.createEl("span", { cls: "connection-details", text: errorMsg });
    }
  }
};

// src/sync/AnkiConnector.ts
var import_obsidian5 = require("obsidian");

// src/sync/imageUtils.ts
var import_obsidian4 = require("obsidian");
function resolveImageSource(app, imagePath, notePath) {
  if (!imagePath) return null;
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
    return imagePath;
  }
  const file = app.metadataCache.getFirstLinkpathDest(imagePath, notePath);
  return file;
}
async function readImageFileToBase64(app, file) {
  try {
    const arrayBuffer = await app.vault.readBinary(file);
    return arrayBufferToBase64(arrayBuffer);
  } catch (e) {
    throw new Error(`Failed to read image file: ${file.path}`);
  }
}
async function downloadImageToBase64(url) {
  try {
    const response = await (0, import_obsidian4.requestUrl)({ url });
    return arrayBufferToBase64(response.arrayBuffer);
  } catch (e) {
    throw new Error(`Failed to download image from ${url}`);
  }
}
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function getImageFilename(pathOrUrl) {
  try {
    const url = new URL(pathOrUrl, "http://dummy.com");
    const pathname = url.pathname;
    const parts = pathname.split("/");
    const filename = parts[parts.length - 1];
    return filename || "image.png";
  } catch (e) {
    const parts = pathOrUrl.split("/");
    return parts[parts.length - 1] || "image.png";
  }
}

// src/sync/AnkiConnector.ts
var AnkiConnector = class {
  constructor(settings, app) {
    // Simple cache for notes info per-deck to avoid per-card findNotes calls
    this.noteCache = null;
    this.settings = settings;
    this.app = app;
  }
  /**
   * Tests connection to Anki Connect
   * @returns Promise<boolean> True if connection successful
   */
  async testConnection() {
    try {
      const response = await this.ankiConnectRequest("version", ANKI_CONNECT_VERSION);
      return response !== null;
    } catch (e) {
      return false;
    }
  }
  /**
   * Analyzes what sync operations need to be performed
   * @param cards Array of cards to analyze
   * @param notePath Optional path to the note file
   * @param noteContent Optional content of the note
   * @returns Promise<SyncAnalysis> Analysis of required operations
   */
  async analyzeSyncOperation(cards, notePath, noteContent) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r;
    const analysis = {
      cardsToAdd: [],
      cardsToUpdate: [],
      cardsToDelete: [],
      totalCards: cards.length
    };
    if (!await this.testConnection()) {
      throw new Error(
        "Cannot connect to Anki Connect. Make sure Anki is running with AnkiConnect addon installed."
      );
    }
    const deckName = this.getDeckName(notePath, noteContent);
    for (const card of cards) {
      try {
        const existingCardId = await this.findExistingCard(card, deckName);
        if (existingCardId) {
          try {
            const infoResult = await this.ankiConnectRequest("notesInfo", ANKI_CONNECT_VERSION, {
              notes: [existingCardId]
            });
            const ni = infoResult == null ? void 0 : infoResult[0];
            const front = ((_c = (_b = (_a = ni == null ? void 0 : ni.fields) == null ? void 0 : _a.Front) == null ? void 0 : _b.value) != null ? _c : "").trim();
            const back = ((_f = (_e = (_d = ni == null ? void 0 : ni.fields) == null ? void 0 : _d.Back) == null ? void 0 : _e.value) != null ? _f : "").trim();
            const qTrim = (card.question || "").trim();
            let match = false;
            if (front === qTrim) {
              if (card.image) {
                const filename = getImageFilename(card.image);
                const encodedFilename = encodeURI(filename);
                const spaceEncodedFilename = filename.replace(/ /g, "%20");
                const underscoreFilename = filename.replace(/ /g, "_");
                const hasFilename = back.includes(filename) || back.includes(encodedFilename) || back.includes(spaceEncodedFilename) || back.includes(underscoreFilename);
                const aTrim = (card.answer || "").trim();
                const hasAnswer = !aTrim || back.includes(aTrim);
                const hasImgTag = back.includes("<img");
                if (hasAnswer && hasImgTag && hasFilename) {
                  match = true;
                }
              } else {
                const aTrim = (card.answer || "").trim();
                if (back === aTrim) {
                  match = true;
                }
              }
            }
            if (match) {
              continue;
            } else {
              const cardSyncInfo = {
                card,
                action: "update" /* UPDATE */,
                deckName,
                existingCardId
              };
              analysis.cardsToUpdate.push(cardSyncInfo);
            }
          } catch (e) {
            const cardSyncInfo = {
              card,
              action: "update" /* UPDATE */,
              deckName,
              existingCardId
            };
            analysis.cardsToUpdate.push(cardSyncInfo);
          }
        } else {
          analysis.cardsToAdd.push({ card, action: "add" /* ADD */, deckName });
        }
      } catch (e) {
        analysis.cardsToAdd.push({
          card,
          action: "add" /* ADD */,
          deckName
        });
      }
    }
    try {
      if (this.settings.useNoteBased && notePath) {
        const query = `deck:"${deckName}" tag:${PLUGIN_TAG}`;
        const existingNoteIds = await this.ankiConnectRequest(
          "findNotes",
          ANKI_CONNECT_VERSION,
          { query }
        );
        if (existingNoteIds && existingNoteIds.length > 0) {
          const notesInfo = await this.ankiConnectRequest("notesInfo", ANKI_CONNECT_VERSION, {
            notes: existingNoteIds
          });
          const extractedQuestions = new Set(cards.map((c) => (c.question || "").trim()));
          for (const ni of notesInfo) {
            try {
              const front = (_j = (_i = (_h = (_g = ni.fields) == null ? void 0 : _g.Front) == null ? void 0 : _h.value) == null ? void 0 : _i.trim()) != null ? _j : "";
              const back = (_n = (_m = (_l = (_k = ni.fields) == null ? void 0 : _k.Back) == null ? void 0 : _l.value) == null ? void 0 : _m.trim()) != null ? _n : "";
              if (front && !extractedQuestions.has(front)) {
                const delCard = { question: front, answer: back, line: -1 };
                const noteId = (_r = (_q = (_p = ni.noteId) != null ? _p : (_o = ni.noteIds) == null ? void 0 : _o[0]) != null ? _q : ni.id) != null ? _r : "";
                const cs = {
                  card: delCard,
                  action: "delete" /* DELETE */,
                  deckName,
                  existingCardId: noteId
                };
                analysis.cardsToDelete.push(cs);
              }
            } catch (e) {
            }
          }
        }
      }
    } catch (e) {
    }
    return analysis;
  }
  async findExistingCard(card, deckName) {
    var _a, _b;
    try {
      await this.prefetchNotesForDeck(deckName);
      if ((_a = this.noteCache) == null ? void 0 : _a.byFront) {
        const key = this.normalizeField(card.question || "");
        const entry = this.noteCache.byFront.get(key);
        if (entry) return (_b = entry.noteId) != null ? _b : null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }
  async syncCards(cards, preview = false, notePath, noteContent, deleteConfirmed = false) {
    if (!await this.testConnection()) {
      throw new Error(
        "Cannot connect to Anki Connect. Make sure Anki is running with AnkiConnect addon installed."
      );
    }
    const results = [];
    const deckName = this.getDeckName(notePath, noteContent);
    if (this.settings.useNoteBased && notePath && !preview) {
      try {
        await this.ankiConnectRequest("createDeck", 6, {
          deck: deckName
        });
      } catch (e) {
      }
    }
    for (const card of cards) {
      try {
        if (!card.answer && !card.image) {
          results.push(`\u26A0\uFE0F Skipped invalid card (missing answer and image): ${card.question}`);
          continue;
        }
        if (preview) {
          const targetDeck = this.settings.useNoteBased && notePath ? deckName : this.settings.defaultDeck;
          const qTag = `${this.settings.questionWord}:`;
          const aTag = `${this.settings.answerWord}:`;
          const iInfo = card.image ? ` | \u{1F5BC}\uFE0F Image: ${card.image}` : "";
          const aInfo = card.answer ? `${card.answer}` : "(image only)";
          results.push(
            `Preview: ${qTag} ${card.question} | ${aTag} ${aInfo}${iInfo} | Deck: ${targetDeck}`
          );
        } else {
          let finalBack = card.answer;
          if (card.image && notePath) {
            try {
              const storedFilename = await this.uploadImageToAnki(card.image, notePath);
              if (storedFilename) {
                if (finalBack) {
                  finalBack += `<br><img src="${storedFilename}">`;
                } else {
                  finalBack = `<img src="${storedFilename}">`;
                }
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Unknown error";
              results.push(`\u26A0\uFE0F Image failed (${card.image}): ${msg}`);
            }
          }
          const updateStatus = await this.updateExistingCard(card, deckName, finalBack);
          if (updateStatus.status === "updated") {
            results.push(`\u{1F504} Updated: ${card.question} \u2192 ${deckName}`);
          } else if (updateStatus.status === "identical") {
            results.push(`\u2139\uFE0F Skipped (already up-to-date): ${card.question} \u2192 ${deckName}`);
          } else {
            try {
              await this.ankiConnectRequest("addNote", 6, {
                note: {
                  deckName,
                  modelName: this.settings.noteType,
                  fields: {
                    Front: card.question,
                    Back: finalBack
                  },
                  tags: ["panda-zap", "obsidian"]
                }
              });
              results.push(`\u2705 Added: ${card.question} \u2192 ${deckName}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message.toLowerCase() : "";
              if (msg.includes("duplicate") || msg.includes("cannot create note")) {
                results.push(`\u2139\uFE0F Skipped (already exists): ${card.question} \u2192 ${deckName}`);
              } else {
                throw err;
              }
            }
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        results.push(`\u274C Failed: ${card.question} - ${msg}`);
      }
    }
    if (!preview && deleteConfirmed && this.settings.useNoteBased && notePath) {
      try {
        const analysis = await this.analyzeSyncOperation(cards, notePath, noteContent);
        const toDelete = analysis.cardsToDelete.map((d) => d.existingCardId).filter((id) => Boolean(id));
        if (toDelete.length > 0) {
          await this.ankiConnectRequest("deleteNotes", 6, { notes: toDelete });
          results.push(`\u{1F5D1}\uFE0F Deleted ${toDelete.length} notes from Anki`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push(`\u274C Failed to delete notes: ${msg}`);
      }
    }
    return results;
  }
  async updateExistingCard(card, deckName, backContentOverride) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
      await this.prefetchNotesForDeck(deckName);
      let noteId;
      if ((_a = this.noteCache) == null ? void 0 : _a.byFront) {
        const key = this.normalizeField(card.question || "");
        const entry = this.noteCache.byFront.get(key);
        noteId = entry == null ? void 0 : entry.noteId;
      }
      const targetBack = backContentOverride !== void 0 ? backContentOverride : card.answer;
      if (noteId) {
        const cached = (_b = this.noteCache) == null ? void 0 : _b.byFront.get(this.normalizeField(card.question || ""));
        try {
          const front = ((_e = (_d = (_c = cached == null ? void 0 : cached.fields) == null ? void 0 : _c.Front) == null ? void 0 : _d.value) != null ? _e : "").trim();
          const back = ((_h = (_g = (_f = cached == null ? void 0 : cached.fields) == null ? void 0 : _f.Back) == null ? void 0 : _g.value) != null ? _h : "").trim();
          const qTrim = (card.question || "").trim();
          const aTrim = (targetBack || "").trim();
          let isIdentical = false;
          if (front === qTrim) {
            if (card.image) {
              const filename = getImageFilename(card.image);
              const encodedFilename = encodeURI(filename);
              const spaceEncodedFilename = filename.replace(/ /g, "%20");
              const underscoreFilename = filename.replace(/ /g, "_");
              const hasFilename = back.includes(filename) || back.includes(encodedFilename) || back.includes(spaceEncodedFilename) || back.includes(underscoreFilename);
              const textPart = card.answer ? card.answer.trim() : "";
              const hasAnswer = !textPart || back.includes(textPart);
              const hasImgTag = back.includes("<img");
              if (hasAnswer && hasImgTag && hasFilename) {
                isIdentical = true;
              }
            } else {
              if (back === aTrim) {
                isIdentical = true;
              }
            }
          }
          if (isIdentical) {
            return { status: "identical" };
          }
        } catch (e) {
        }
        await this.ankiConnectRequest("updateNoteFields", 6, {
          note: {
            id: noteId,
            fields: {
              Front: card.question,
              Back: targetBack
            }
          }
        });
        this.noteCache = null;
        return { status: "updated" };
      }
      return { status: "missing" };
    } catch (e) {
      return { status: "missing" };
    }
  }
  async uploadImageToAnki(imagePath, notePath) {
    const source = resolveImageSource(this.app, imagePath, notePath);
    if (!source) return null;
    let base64 = "";
    let filename = "";
    if (typeof source === "string") {
      base64 = await downloadImageToBase64(source);
      filename = getImageFilename(source);
    } else if (source instanceof import_obsidian5.TFile) {
      base64 = await readImageFileToBase64(this.app, source);
      filename = source.name || getImageFilename(source.path);
    } else {
      return null;
    }
    const result = await this.ankiConnectRequest("storeMediaFile", 6, {
      filename,
      data: base64
    });
    return result;
  }
  normalizeField(s) {
    return (s || "").toString().trim();
  }
  async prefetchNotesForDeck(deckName) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (this.noteCache && this.noteCache.deckName === deckName) return;
    this.noteCache = { deckName, byFront: /* @__PURE__ */ new Map(), noteIds: [] };
    try {
      const query = `deck:"${deckName}" tag:${PLUGIN_TAG}`;
      let noteIds = [];
      try {
        noteIds = await this.ankiConnectRequest("findNotes", 6, { query });
      } catch (e) {
      }
      if (!noteIds || noteIds.length === 0) {
        try {
          noteIds = await this.ankiConnectRequest("findNotes", 6, { query: `deck:"${deckName}"` });
        } catch (e) {
          noteIds = [];
        }
      }
      if (!noteIds || noteIds.length === 0) return;
      const notesInfo = await this.ankiConnectRequest("notesInfo", 6, { notes: noteIds });
      if (!notesInfo || !Array.isArray(notesInfo)) return;
      for (const ni of notesInfo) {
        try {
          const frontValue = (_c = (_b = (_a = ni.fields) == null ? void 0 : _a.Front) == null ? void 0 : _b.value) != null ? _c : "";
          const front = frontValue.trim();
          const key = this.normalizeField(front);
          const id = (_g = (_f = (_e = ni.noteId) != null ? _e : (_d = ni.noteIds) == null ? void 0 : _d[0]) != null ? _f : ni.id) != null ? _g : "";
          this.noteCache.noteIds.push(id);
          this.noteCache.byFront.set(key, { noteId: id, fields: ni.fields, raw: ni });
        } catch (e) {
        }
      }
    } catch (e) {
      this.noteCache = null;
    }
  }
  getDeckNameFromPath(notePath) {
    if (!notePath) return "";
    const pathParts = notePath.split("/");
    const noteNameWithExt = pathParts.pop() || "Unknown";
    const noteName = noteNameWithExt.replace(/\.md$/, "");
    const folderPath = pathParts.length > 0 ? pathParts.join("/") : "";
    if (folderPath) {
      return `${folderPath}::${noteName}`;
    } else {
      return noteName;
    }
  }
  getDeckName(notePath, noteContent) {
    if (noteContent && this.settings.deckOverrideWord) {
      const firstLine = noteContent.split(/\r?\n/)[0] || "";
      const esc = this.settings.deckOverrideWord.replace(/[.*+?^${}(|[\]\\]/g, "\\$&");
      const prefRegex = new RegExp(`^${esc}::\\s*(.+)$`, "i");
      const m = firstLine.match(prefRegex);
      if (m == null ? void 0 : m[1]) {
        return m[1].trim().replace(/\//g, "::");
      }
    }
    if (!this.settings.useNoteBased || !notePath) {
      return this.settings.defaultDeck;
    }
    return this.getDeckNameFromPath(notePath);
  }
  buildAnkiConnectUrl() {
    try {
      const maybeUrl = String(this.settings.ankiConnectUrl || "http://127.0.0.1");
      let u;
      try {
        u = new URL(maybeUrl);
      } catch (e) {
        u = new URL(`http://${maybeUrl}`);
      }
      if ((!u.port || u.port === "") && this.settings.ankiConnectPort) {
        u.port = String(this.settings.ankiConnectPort);
      }
      return u.toString();
    } catch (e) {
      return `http://127.0.0.1:${this.settings.ankiConnectPort || 8765}`;
    }
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async ankiConnectRequest(action, version, params) {
    const url = this.buildAnkiConnectUrl();
    const body = JSON.stringify({ action, version, params });
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await (0, import_obsidian5.requestUrl)({
          url,
          method: "POST",
          contentType: "application/json",
          body
        });
        const data = response.json;
        if (data.error) {
          throw new Error(data.error);
        }
        return data.result;
      } catch (error) {
        const isNetwork = error instanceof Error && (error.name === "TypeError" || error.message === "Failed to fetch" || error.message.includes("net::"));
        const shouldRetry = isNetwork && attempt < MAX_RETRIES;
        if (shouldRetry) {
          const backoff = 200 * Math.pow(2, attempt);
          await this.sleep(backoff + Math.random() * 150);
          continue;
        }
        throw error;
      }
    }
  }
};

// src/sync/CardExtractor.ts
var import_obsidian6 = require("obsidian");

// src/sync/extractionUtils.ts
function parseImagePath(text) {
  if (!text) return null;
  let clean = text.trim();
  const wikiMatch = clean.match(/^!{0,1}\[\[(.*?)\]\]$/);
  if (wikiMatch) {
    clean = wikiMatch[1];
    const pipeIndex = clean.lastIndexOf("|");
    if (pipeIndex !== -1) {
      clean = clean.substring(0, pipeIndex);
    }
    return clean.trim();
  }
  const mdMatch = clean.match(/^!\[.*?\]\((.*?)\)$/);
  if (mdMatch) {
    const path = mdMatch[1].split(" ")[0];
    return path.trim();
  }
  const wikiFind = clean.match(/!{0,1}\[\[(.*?)\]\]/);
  if (wikiFind) {
    const inner = wikiFind[1];
    const pipeIndex = inner.lastIndexOf("|");
    return pipeIndex !== -1 ? inner.substring(0, pipeIndex).trim() : inner.trim();
  }
  const mdFind = clean.match(/!\[.*?\]\((.*?)\)/);
  if (mdFind) {
    return mdFind[1].split(" ")[0].trim();
  }
  return clean;
}
function extractQACardsFromText(content, settings) {
  if (!content || !settings) {
    return [];
  }
  const cards = [];
  const lines = content.split("\n");
  try {
    const escQWord = settings.questionWord.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
    const escAWord = settings.answerWord.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
    const escIWord = settings.imageWord.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
    const escQ = `${escQWord}:`;
    const escA = `${escAWord}:`;
    const escI = `${escIWord}:`;
    const qStartRegex = new RegExp(`^(?:[*_]{0,2})${escQ}\\s*(.+)`, "i");
    const aStartRegex = new RegExp(`^(?:[*_]{0,2})${escA}\\s*(.*)`, "i");
    const iStartRegex = new RegExp(`^(?:[*_]{0,2})${escI}\\s*(.*)`, "i");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const singleLineAll = new RegExp(
        `(?:[*_]{0,2})${escQ}\\s*(.+?)\\s*(?:[*_]{0,2})${escA}\\s*(.+?)\\s*(?:[*_]{0,2})${escI}\\s*(.+)`,
        "i"
      );
      const matchAll = line.match(singleLineAll);
      if (matchAll) {
        cards.push({
          question: matchAll[1].replace(/[*_]+/g, "").trim(),
          answer: matchAll[2].replace(/[*_]+/g, "").trim(),
          image: parseImagePath(matchAll[3]) || void 0,
          line: i + 1
        });
        continue;
      }
      const singleLineQI = new RegExp(
        `(?:[*_]{0,2})${escQ}\\s*(.+?)\\s*(?:[*_]{0,2})${escI}\\s*(.+)`,
        "i"
      );
      const matchQI = line.match(singleLineQI);
      if (matchQI) {
        const aPattern = new RegExp(`(?:[*_]{0,2})${escA}\\s*`, "i");
        if (!aPattern.test(matchQI[1])) {
          cards.push({
            question: matchQI[1].replace(/[*_]+/g, "").trim(),
            answer: "",
            // No explicit answer text
            image: parseImagePath(matchQI[2]) || void 0,
            line: i + 1
          });
          continue;
        }
      }
      const singleLineQA = new RegExp(
        `(?:[*_]{0,2})${escQ}\\s*(.+?)\\s*(?:[*_]{0,2})${escA}\\s*(.+)`,
        "i"
      );
      const matchQA = line.match(singleLineQA);
      if (matchQA) {
        const possibleAnswer = matchQA[2];
        const iPattern = new RegExp(`(?:[*_]{0,2})${escI}\\s*`, "i");
        if (!iPattern.test(possibleAnswer)) {
          cards.push({
            question: matchQA[1].replace(/[*_]+/g, "").trim(),
            answer: possibleAnswer.replace(/[*_]+/g, "").trim(),
            line: i + 1
          });
          continue;
        }
      }
      const qMatch = line.match(qStartRegex);
      if (qMatch) {
        const questionText = qMatch[1];
        const answerLines = [];
        let imagePath = void 0;
        let hasAnswer = false;
        let currentMode = "none";
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          if (nextLine.trim() === "") break;
          if (qStartRegex.test(nextLine)) break;
          const iMatch = nextLine.match(iStartRegex);
          if (iMatch) {
            currentMode = "image";
            imagePath = parseImagePath(iMatch[1]);
            j++;
            continue;
          }
          const aMatch = nextLine.match(aStartRegex);
          if (aMatch) {
            currentMode = "answer";
            hasAnswer = true;
            if (aMatch[1].trim()) {
              answerLines.push(aMatch[1]);
            }
            j++;
            continue;
          }
          if (currentMode === "answer") {
            answerLines.push(nextLine);
          } else if (currentMode === "image") {
            if (!imagePath) {
              imagePath = parseImagePath(nextLine);
            }
          } else if (currentMode === "none") {
            break;
          }
          j++;
        }
        if (hasAnswer || imagePath) {
          cards.push({
            question: questionText.replace(/[*_]+/g, "").trim(),
            answer: answerLines.join("\n").trim(),
            image: imagePath || void 0,
            line: i + 1
          });
          i = j - 1;
        }
      }
    }
  } catch (e) {
    return [];
  }
  return cards;
}

// src/sync/CardExtractor.ts
var CardExtractor = class {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
  }
  /**
   * Extracts Q&A cards from the current active note
   * @returns AnkiCard[] Array of extracted cards
   * @throws Error if no active note is found
   */
  extractCardsFromCurrentNote() {
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    if (!activeView) {
      new import_obsidian6.Notice("No active note found");
      return [];
    }
    try {
      const content = activeView.editor.getValue();
      return extractQACardsFromText(content, this.settings);
    } catch (e) {
      new import_obsidian6.Notice("Error extracting cards from note");
      return [];
    }
  }
  /**
   * Creates regex patterns for Q&A detection
   */
  createQARegex(escQ, escA, escI) {
    const parts = [`([*_]{0,2})${escQ}\\s*`, `([*_]{0,2})${escA}\\s*`];
    if (escI) parts.push(`([*_]{0,2})${escI}\\s*`);
    return new RegExp(parts.join("|"), "gi");
  }
  processQACards(element, plugin) {
    const containers = element.querySelectorAll("p, div, span, li");
    containers.forEach((container) => {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i;
      if (!(container instanceof HTMLElement) || container.classList.contains(CSS_CLASSES.QA_PROCESSED)) {
        return;
      }
      const fullText = container.textContent || "";
      const qTag = (_b = (_a = plugin == null ? void 0 : plugin.settings) == null ? void 0 : _a.questionWord) != null ? _b : this.settings.questionWord;
      const aTag = (_d = (_c = plugin == null ? void 0 : plugin.settings) == null ? void 0 : _c.answerWord) != null ? _d : this.settings.answerWord;
      const iTag = (_f = (_e = plugin == null ? void 0 : plugin.settings) == null ? void 0 : _e.imageWord) != null ? _f : this.settings.imageWord;
      const escQ = qTag.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + ":";
      const escA = aTag.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + ":";
      const escI = iTag.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + ":";
      if (!new RegExp(`[*_]{0,2}${escQ}`).test(fullText) && !new RegExp(`[*_]{0,2}${escA}`).test(fullText) && !new RegExp(`[*_]{0,2}${escI}`).test(fullText)) {
        return;
      }
      const isInCode = (n) => {
        if (!(n instanceof HTMLElement) && !(n instanceof Text)) return false;
        const el = n instanceof Text ? n.parentElement : n;
        return !!(el == null ? void 0 : el.closest("code, pre"));
      };
      const boldQuestion = (_h = (_g = plugin == null ? void 0 : plugin.settings) == null ? void 0 : _g.boldQuestionInReadingMode) != null ? _h : true;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const toUpdate = [];
      let node = walker.nextNode();
      while (node) {
        const textNode = node;
        if (!isInCode(textNode)) {
          const t = (_i = textNode.nodeValue) != null ? _i : "";
          if (/(?:[*_]{0,2})Q:|(?:[*_]{0,2})A:|(?:[*_]{0,2})I:/i.test(t)) {
            toUpdate.push(textNode);
          }
        }
        node = walker.nextNode();
      }
      if (toUpdate.length === 0) {
        return;
      }
      let changed = false;
      let inQuestion = false;
      const applyTransform = (tn) => {
        var _a2;
        const text = (_a2 = tn.nodeValue) != null ? _a2 : "";
        const frag = document.createDocumentFragment();
        const appendSegment = (segment, question) => {
          if (!segment) return;
          if (boldQuestion && question) {
            const strong = document.createElement("strong");
            strong.textContent = segment;
            frag.appendChild(strong);
          } else {
            frag.appendChild(document.createTextNode(segment));
          }
        };
        const qaRegex = this.createQARegex(escQ, escA, escI);
        let lastIndex = 0;
        let match;
        while ((match = qaRegex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            appendSegment(text.slice(lastIndex, match.index), inQuestion);
          }
          if (match[0].toUpperCase().includes("Q:")) {
            inQuestion = true;
          } else if (match[0].toUpperCase().includes("A:")) {
            inQuestion = false;
          }
          lastIndex = qaRegex.lastIndex;
        }
        if (lastIndex < text.length) {
          appendSegment(text.slice(lastIndex), inQuestion);
        }
        if (frag.childNodes.length > 0 && frag.textContent !== text) {
          tn.replaceWith(frag);
          changed = true;
        }
      };
      for (const tn of toUpdate) {
        applyTransform(tn);
      }
      if (changed) {
        container.classList.add(CSS_CLASSES.QA_PROCESSED);
      }
    });
  }
};

// src/main.ts
var PandaZapPlugin = class extends import_obsidian7.Plugin {
  async onload() {
    await this.loadSettings();
    this.ankiConnector = new AnkiConnector(this.settings, this.app);
    this.cardExtractor = new CardExtractor(this.app, this.settings);
    this.addRibbonIcon(
      "zap",
      "Sync notes to Anki",
      () => {
        void this.openSyncDialog();
      }
    );
    this.addCommand({
      id: "sync",
      name: "Open sync dialog",
      callback: () => {
        void this.openSyncDialog();
      }
    });
    this.addSettingTab(new PandaZapSettingTab(this.app, this));
    this.registerMarkdownPostProcessor((element, _context) => {
      this.cardExtractor.processQACards(element, this);
    });
  }
  /**
   * Opens the sync dialog modal
   */
  openSyncDialog() {
    new SyncModal(this.app, this).open();
  }
  /**
   * Loads plugin settings from data.json
   */
  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }
  /**
   * Saves plugin settings to data.json
   */
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /**
   * Tests connection to Anki Connect
   * @returns Promise<boolean> True if connection successful
   */
  async testAnkiConnection() {
    const connector = new AnkiConnector(this.settings, this.app);
    return connector.testConnection();
  }
  /**
   * Analyzes what sync operations need to be performed for the current note
   * @returns Promise<SyncAnalysis> Analysis of required operations
   */
  async analyzeSyncOperation() {
    this.ankiConnector = new AnkiConnector(this.settings, this.app);
    this.cardExtractor = new CardExtractor(this.app, this.settings);
    const cards = this.extractCardsFromCurrentNote();
    const activeFile = this.app.workspace.getActiveFile();
    const notePath = activeFile ? activeFile.path : void 0;
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian7.MarkdownView);
    const noteContent = activeView ? activeView.editor.getValue() : void 0;
    return this.ankiConnector.analyzeSyncOperation(cards, notePath, noteContent);
  }
  /**
   * Extracts Q&A cards from the current active note
   * @returns AnkiCard[] Array of extracted cards
   */
  extractCardsFromCurrentNote() {
    this.cardExtractor = new CardExtractor(this.app, this.settings);
    return this.cardExtractor.extractCardsFromCurrentNote();
  }
  /**
   * Syncs cards to Anki
   * @param cards Array of cards to sync
   * @param preview Whether this is a preview operation
   * @param deleteConfirmed Whether delete operations are confirmed
   * @returns Promise<string[]> Array of result messages
   */
  async syncCardsToAnki(cards, preview = false, deleteConfirmed = false) {
    this.ankiConnector = new AnkiConnector(this.settings, this.app);
    const activeFile = this.app.workspace.getActiveFile();
    const notePath = activeFile ? activeFile.path : void 0;
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian7.MarkdownView);
    const noteContent = activeView ? activeView.editor.getValue() : void 0;
    return this.ankiConnector.syncCards(
      cards,
      preview,
      notePath,
      noteContent,
      deleteConfirmed
    );
  }
};
