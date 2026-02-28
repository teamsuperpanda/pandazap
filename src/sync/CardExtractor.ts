import { App, MarkdownView, Notice } from 'obsidian';
import { AnkiCard, PandaZapSettings } from './types';
import { extractQACardsFromText } from './extractionUtils';
import { CSS_CLASSES } from '../constants';
import PandaZapPlugin from '../main';

export class CardExtractor {
  private app: App;
  private settings: PandaZapSettings;

  constructor(app: App, settings: PandaZapSettings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * Extracts Q&A cards from the current active note
   * @returns Promise<AnkiCard[]> Array of extracted cards
   * @throws Error if no active note is found
   */
  async extractCardsFromCurrentNote(): Promise<AnkiCard[]> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice('No active note found');
      return [];
    }

    try {
      const content = activeView.editor.getValue();
      return extractQACardsFromText(content, this.settings);
    } catch {
      new Notice('Error extracting cards from note');
      return [];
    }
  }

  /**
   * Creates regex patterns for Q&A detection
   */
  private createQARegex(escQ: string, escA: string, escI?: string): RegExp {
    const parts = [`([*_]{0,2})${escQ}\\s*`, `([*_]{0,2})${escA}\\s*`];
    if (escI) parts.push(`([*_]{0,2})${escI}\\s*`);
    return new RegExp(parts.join('|'), 'gi');
  }

  processQACards(element: HTMLElement, plugin?: PandaZapPlugin) {
    const containers = element.querySelectorAll('p, div, span, li');

    containers.forEach((container) => {
      if (!(container instanceof HTMLElement) || container.classList.contains(CSS_CLASSES.QA_PROCESSED)) {
        return;
      }

      const fullText = container.textContent || '';
      const qTag = plugin?.settings?.questionWord ?? this.settings.questionWord;
      const aTag = plugin?.settings?.answerWord ?? this.settings.answerWord;
      const iTag = plugin?.settings?.imageWord ?? this.settings.imageWord;
      const escQ = qTag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ':';
      const escA = aTag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ':';
      const escI = iTag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ':';

      if (
        !new RegExp(`[*_]{0,2}${escQ}`).test(fullText) &&
        !new RegExp(`[*_]{0,2}${escA}`).test(fullText) &&
        !new RegExp(`[*_]{0,2}${escI}`).test(fullText)
      ) {
        return;
      }

      const isInCode = (n: Node): boolean => {
        if (!(n instanceof HTMLElement) && !(n instanceof Text)) return false;
        const el = n instanceof Text ? n.parentElement : n;
        return !!el?.closest('code, pre');
      };

      const boldQuestion = plugin?.settings?.boldQuestionInReadingMode ?? true;

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const toUpdate: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        const textNode = node as Text;
        if (!isInCode(textNode)) {
          const t = textNode.nodeValue ?? '';
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

      const applyTransform = (tn: Text) => {
        const text = tn.nodeValue ?? '';
        const frag = document.createDocumentFragment();

        const appendSegment = (segment: string, question: boolean) => {
          if (!segment) return;
          if (boldQuestion && question) {
            const strong = document.createElement('strong');
            strong.textContent = segment;
            frag.appendChild(strong);
          } else {
            frag.appendChild(document.createTextNode(segment));
          }
        };

        const qaRegex = this.createQARegex(escQ, escA, escI);
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = qaRegex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            appendSegment(text.slice(lastIndex, match.index), inQuestion);
          }

          if (match[0].toUpperCase().includes('Q:')) {
            inQuestion = true;
          } else if (match[0].toUpperCase().includes('A:')) {
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
}
