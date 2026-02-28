import { Modal, App } from 'obsidian';
import { SyncAnalysis, CardSyncInfo, PandaZapSettings } from '../sync/types';

export class PreviewModal extends Modal {
  private syncAnalysis: SyncAnalysis;
  private settings: PandaZapSettings;

  constructor(app: App, syncAnalysis: SyncAnalysis, settings: PandaZapSettings) {
    super(app);
    this.syncAnalysis = syncAnalysis;
    this.settings = settings;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('panda-zap-preview-modal');
    const header = contentEl.createDiv('panda-zap-preview-header');
    header.createEl('h2', { text: 'Preview changes' });
    const content = contentEl.createDiv('panda-zap-preview-content');
    const totalChanges =
      this.syncAnalysis.cardsToAdd.length +
      this.syncAnalysis.cardsToUpdate.length +
      this.syncAnalysis.cardsToDelete.length;
    if (totalChanges === 0) {
      const emptyState = content.createDiv('panda-zap-empty-state');
      emptyState.createSpan({ text: '✨ No changes needed - all cards are up to date!' });
      return;
    }
    if (this.syncAnalysis.cardsToAdd.length > 0) {
      this.renderSection(content, 'add', '📝 Cards to Add', this.syncAnalysis.cardsToAdd);
    }
    if (this.syncAnalysis.cardsToUpdate.length > 0) {
      this.renderSection(content, 'update', '🔄 Cards to Update', this.syncAnalysis.cardsToUpdate);
    }
    if (this.syncAnalysis.cardsToDelete.length > 0) {
      this.renderSection(content, 'delete', '🗑️ Cards to Remove', this.syncAnalysis.cardsToDelete);
    }
  }

  private renderSection(
    container: HTMLElement,
    type: string,
    title: string,
    cards: CardSyncInfo[]
  ) {
    const section = container.createDiv('panda-zap-preview-section');
    const sectionHeader = section.createDiv('panda-zap-section-header');
    const toggleIcon = sectionHeader.createSpan({ cls: 'panda-zap-toggle-icon expanded' });
    toggleIcon.textContent = '▼';
    sectionHeader.createSpan({
      text: `${title} (${cards.length})`,
      cls: 'panda-zap-section-title',
    });
    const cardsContainer = section.createDiv('panda-zap-cards-container expanded');
    sectionHeader.onclick = () => {
      const isExpanded = toggleIcon.classList.contains('expanded');
      if (isExpanded) {
        toggleIcon.classList.remove('expanded');
        toggleIcon.textContent = '▶';
        cardsContainer.classList.remove('expanded');
        cardsContainer.classList.add('collapsed');
      } else {
        toggleIcon.classList.add('expanded');
        toggleIcon.textContent = '▼';
        cardsContainer.classList.remove('collapsed');
        cardsContainer.classList.add('expanded');
      }
    };
    cards.forEach((cardInfo, index) => {
      const cardElement = cardsContainer.createDiv(`panda-zap-card ${type}`);

      const cardHeader = cardElement.createDiv('panda-zap-card-header panda-zap-card-header-stacked');
      cardHeader.createSpan({ text: `Card ${index + 1}`, cls: 'panda-zap-card-number' });
      cardHeader.createSpan({ text: `Deck: ${cardInfo.deckName}`, cls: 'panda-zap-card-deck' });

      const cardContent = cardElement.createDiv('panda-zap-card-content');
      const questionDiv = cardContent.createDiv('panda-zap-card-question');
      questionDiv.createSpan({
        text: `${this.settings.questionWord}: `,
        cls: 'panda-zap-card-label',
      });
      questionDiv.createSpan({ text: cardInfo.card.question, cls: 'panda-zap-card-text' });
      const answerDiv = cardContent.createDiv('panda-zap-card-answer');
      answerDiv.createSpan({
        text: `${this.settings.answerWord}: `,
        cls: 'panda-zap-card-label',
      });
      const answerText = cardInfo.card.answer || '(image only)';
      answerDiv.createSpan({ text: answerText, cls: 'panda-zap-card-text' });

      if (cardInfo.card.image) {
        const imageDiv = cardContent.createDiv('panda-zap-card-image');
        imageDiv.createSpan({
          text: `Image: `,
          cls: 'panda-zap-card-label',
        });
        imageDiv.createSpan({ text: cardInfo.card.image, cls: 'panda-zap-card-text' });
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
