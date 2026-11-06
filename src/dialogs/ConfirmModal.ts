import { App, Modal, setIcon } from 'obsidian';

/** Everything one confirmation prompt shows. */
export interface ConfirmModalOptions {
  title: string;
  message: string;
  /** Extra lines listed under the message, such as the affected file names. */
  items?: readonly string[];
  confirmText?: string;
  cancelText?: string;
}

/**
 * Small reusable confirmation dialog. Escape, the close button and a click
 * outside all count as cancelling, so the destructive action only runs when the
 * user presses the confirm button.
 */
export class ConfirmModal extends Modal {
  private readonly options: ConfirmModalOptions;
  private resolve: ((confirmed: boolean) => void) | null = null;
  private settled = false;

  constructor(app: App, options: ConfirmModalOptions) {
    super(app);
    this.options = options;
  }

  /** Opens the dialog; resolves true only when the user confirms. */
  confirm(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('panda-zap-confirm-modal');

    const heading = contentEl.createDiv('panda-zap-confirm-heading');
    const icon = heading.createSpan('panda-zap-confirm-icon');
    setIcon(icon, 'alert-triangle');
    heading.createEl('h3', { text: this.options.title });

    contentEl.createEl('p', { text: this.options.message, cls: 'panda-zap-confirm-msg' });

    if (this.options.items?.length) {
      const list = contentEl.createEl('ul', { cls: 'panda-zap-confirm-list' });
      for (const item of this.options.items) list.createEl('li', { text: item });
    }

    const buttons = contentEl.createDiv('panda-zap-button-row');
    const cancel = buttons.createEl('button', {
      cls: 'panda-zap-btn panda-zap-btn-tertiary',
      text: this.options.cancelText ?? 'Cancel',
    });
    cancel.onclick = () => {
      this.settle(false);
      this.close();
    };

    const confirm = buttons.createEl('button', {
      cls: 'panda-zap-btn mod-warning',
      text: this.options.confirmText ?? 'Confirm',
    });
    confirm.onclick = () => {
      this.settle(true);
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle(false);
  }

  private settle(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve?.(confirmed);
    this.resolve = null;
  }
}
