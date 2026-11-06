import { setIcon } from 'obsidian';
import type { IconName } from 'obsidian';

/** Glyphs shown on the toggle icon for each state. */
export interface CollapsibleSectionIcons {
  expanded: string;
  collapsed: string;
}

export interface CollapsibleSectionOptions {
  /** Section title without the count. */
  title: string;
  /** Item count, rendered as "(n)" after the title. */
  count: number;
  /** Classes for the content container, which differs per section. */
  contentClasses: string;
  /** Render the content visible on creation. Defaults to true. */
  expanded?: boolean;
  /** Toggle glyphs. Defaults to the filled triangles used by the preview. */
  icons?: CollapsibleSectionIcons;
  /** Optional Obsidian icon rendered before the toggle. */
  icon?: IconName;
}

const DEFAULT_ICONS: CollapsibleSectionIcons = { expanded: '▼', collapsed: '▶' };

/**
 * One collapsible section: a clickable, keyboard-operable header plus a content
 * container that the caller fills in. The stylesheet hides collapsed content
 * through two different vocabularies (`collapsed`/`expanded` for the preview
 * cards and `hidden`/`visible` for the skipped list), so both are kept in sync
 * here and the header state lives in one place.
 */
export class CollapsibleSection {
  readonly headerEl: HTMLDivElement;
  readonly contentEl: HTMLDivElement;
  private readonly toggleEl: HTMLSpanElement;
  private readonly icons: CollapsibleSectionIcons;
  private expandedState: boolean;

  constructor(container: HTMLElement, options: CollapsibleSectionOptions) {
    this.icons = options.icons ?? DEFAULT_ICONS;
    this.expandedState = options.expanded ?? true;

    this.headerEl = container.createDiv('panda-zap-section-header');
    if (options.icon) {
      const iconEl = this.headerEl.createSpan({ cls: 'panda-zap-section-icon' });
      setIcon(iconEl, options.icon);
    }
    this.toggleEl = this.headerEl.createSpan({ cls: 'panda-zap-toggle-icon' });
    this.headerEl.createSpan({
      cls: 'panda-zap-section-title',
      text: `${options.title} (${options.count})`,
    });
    this.contentEl = container.createDiv(options.contentClasses);

    this.headerEl.setAttr('role', 'button');
    this.headerEl.setAttr('tabindex', '0');
    this.headerEl.onclick = () => this.toggle();
    this.headerEl.onkeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.toggle();
    };
    this.applyState();
  }

  get expanded(): boolean {
    return this.expandedState;
  }

  toggle(expanded = !this.expandedState): void {
    this.expandedState = expanded;
    this.applyState();
  }

  private applyState(): void {
    this.headerEl.setAttr('aria-expanded', this.expandedState ? 'true' : 'false');
    this.toggleEl.textContent = this.expandedState ? this.icons.expanded : this.icons.collapsed;
    if (this.expandedState) {
      this.toggleEl.classList.add('expanded');
      this.toggleEl.classList.remove('collapsed');
      this.contentEl.classList.add('expanded', 'visible');
      this.contentEl.classList.remove('collapsed', 'hidden');
    } else {
      this.toggleEl.classList.add('collapsed');
      this.toggleEl.classList.remove('expanded');
      this.contentEl.classList.add('collapsed', 'hidden');
      this.contentEl.classList.remove('expanded', 'visible');
    }
  }
}
