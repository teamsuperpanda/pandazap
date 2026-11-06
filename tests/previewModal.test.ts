// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  setIcon: (el: HTMLElement) => {
    el.textContent = 'icon';
  },
  Modal: class {
    contentEl: HTMLElement = document.createElement('div');
    open() {
      // no-op
    }
    close() {
      // no-op
    }
  },
}));

import { PreviewModal } from '../src/dialogs/PreviewModal';
import { DEFAULT_SETTINGS, type CardSyncInfo, type SyncAnalysis } from '../src/sync/types';
import { installObsidianDom } from './obsidianDom';

function card(overrides: Partial<CardSyncInfo> = {}): CardSyncInfo {
  return {
    card: { question: 'What is a panda?', answer: 'A bear' },
    deckName: 'Default',
    ...overrides,
  };
}

function analysis(overrides: Partial<SyncAnalysis> = {}): SyncAnalysis {
  return {
    cardsToAdd: [],
    cardsToUpdate: [],
    cardsToDelete: [],
    cardsInConflict: [],
    totalCards: 0,
    ...overrides,
  };
}

function render(
  syncAnalysis: SyncAnalysis,
  noteLabels?: Map<string, string>
): { modal: PreviewModal; contentEl: HTMLElement } {
  const modal = new PreviewModal({} as never, syncAnalysis, DEFAULT_SETTINGS, noteLabels);
  modal.onOpen();
  return { modal, contentEl: modal.contentEl };
}

describe('PreviewModal', () => {
  beforeEach(() => {
    installObsidianDom();
  });

  it('shows the empty state when there is nothing to change', () => {
    const { contentEl } = render(analysis());

    expect(contentEl.querySelector('.panda-zap-preview-section')).toBeNull();
    expect(contentEl.querySelector('.panda-zap-empty-state')?.textContent).toContain(
      'No changes needed'
    );
  });

  it('renders one section per non-empty bucket with its count', () => {
    const { contentEl } = render(
      analysis({
        cardsToAdd: [card(), card()],
        cardsToUpdate: [card()],
        cardsInConflict: [card()],
        cardsToDelete: [card()],
        totalCards: 5,
      })
    );

    const titles = Array.from(contentEl.querySelectorAll('.panda-zap-section-title')).map(
      (el) => el.textContent
    );
    expect(titles).toHaveLength(4);
    expect(titles).toEqual([
      'Cards to Add (2)',
      'Cards to Update (1)',
      'Cards Changed in Anki (skipped) (1)',
      'Cards to Remove (1)',
    ]);
  });

  it('omits empty buckets entirely', () => {
    const { contentEl } = render(analysis({ cardsToUpdate: [card()], totalCards: 1 }));

    const titles = Array.from(contentEl.querySelectorAll('.panda-zap-section-title')).map(
      (el) => el.textContent
    );
    expect(titles).toEqual(['Cards to Update (1)']);
  });

  it('labels a card with its note when a note label is known', () => {
    const labels = new Map([['Notes/Panda.md', 'Panda']]);
    const { contentEl } = render(
      analysis({ cardsToAdd: [card({ notePath: 'Notes/Panda.md' })], totalCards: 1 }),
      labels
    );

    expect(contentEl.querySelector('.panda-zap-card-note')?.textContent).toBe('Note: Panda');
  });

  it('leaves the note label out when the path has no label', () => {
    const { contentEl } = render(
      analysis({ cardsToAdd: [card({ notePath: 'Notes/Unknown.md' })], totalCards: 1 }),
      new Map()
    );

    expect(contentEl.querySelector('.panda-zap-card-note')).toBeNull();
  });

  it('toggles a section between expanded and collapsed on a header click', () => {
    const { contentEl } = render(analysis({ cardsToAdd: [card()], totalCards: 1 }));

    const header = contentEl.querySelector<HTMLElement>('.panda-zap-section-header');
    const icon = contentEl.querySelector<HTMLElement>('.panda-zap-toggle-icon');
    const cards = contentEl.querySelector<HTMLElement>('.panda-zap-cards-container');
    expect(header).not.toBeNull();
    expect(icon?.textContent).toBe('▼');
    expect(cards?.classList.contains('expanded')).toBe(true);

    header?.click();
    expect(icon?.textContent).toBe('▶');
    expect(cards?.classList.contains('expanded')).toBe(false);
    expect(cards?.classList.contains('collapsed')).toBe(true);

    header?.click();
    expect(icon?.textContent).toBe('▼');
    expect(cards?.classList.contains('expanded')).toBe(true);
    expect(cards?.classList.contains('collapsed')).toBe(false);
  });

  it('clears the content when closed', () => {
    const { modal, contentEl } = render(analysis({ cardsToAdd: [card()], totalCards: 1 }));

    modal.onClose();

    expect(contentEl.childNodes.length).toBe(0);
  });
});
