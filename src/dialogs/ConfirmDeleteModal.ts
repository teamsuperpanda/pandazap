import { App, Modal } from 'obsidian';
import type { DeletionPrompt } from './SyncModalController';

/** Wording of the deletion prompt, kept separate so it can be tested without a DOM. */
export function describeDeleteConfirmation(details: DeletionPrompt): string {
  const baseMessage =
    details.noteCount && details.noteCount > 1
      ? `This will delete ${details.count} cards from ${details.noteCount} notes that were removed from your notes.`
      : `This will delete ${details.count} cards from Anki that were removed from this note.`;
  // Never delete an Anki edit without saying that it is in the delete set.
  const editedNote =
    details.editedCount > 0
      ? ` ${details.editedCount} of these cards were changed in Anki and will be deleted.`
      : '';
  return `${baseMessage}${editedNote} Proceed?`;
}

/**
 * Confirmation for removing cards from Anki. Escape, the close button and a
 * click outside all count as cancelling, so the prompt resolves once, and only
 * the Delete button resolves true.
 */
export class ConfirmDeleteModal extends Modal {
  private readonly details: DeletionPrompt;
  private resolve: ((confirmed: boolean) => void) | null = null;
  private settled = false;

  constructor(app: App, details: DeletionPrompt) {
    super(app);
    this.details = details;
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
    contentEl.addClass('panda-zap-delete-confirm');
    contentEl.createEl('h3', { text: 'Confirm deletion' });
    const message = contentEl.createDiv('panda-zap-delete-msg');
    message.textContent = describeDeleteConfirmation(this.details);

    const buttons = contentEl.createDiv('panda-zap-button-row');
    const cancel = buttons.createEl('button', {
      cls: 'panda-zap-btn panda-zap-btn-tertiary',
      text: 'Cancel',
    });
    cancel.onclick = () => {
      this.settle(false);
      this.close();
    };

    const confirm = buttons.createEl('button', {
      cls: 'panda-zap-btn panda-zap-btn-primary',
      text: 'Delete',
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
