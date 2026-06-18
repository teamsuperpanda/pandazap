import { App, MarkdownView, Notice } from 'obsidian';
import { AnkiCard, PandaZapSettings } from './types';
import { extractQACardsFromText } from './extractionUtils';
import { buildMarkerRegexes } from './markers';
import PandaZapPlugin from '../main';

export class CardExtractor {
  private app: App;
  private settings: PandaZapSettings;

  constructor(app: App, settings: PandaZapSettings) {
    this.app = app;
    this.settings = settings;
  }

  extractCardsFromCurrentNote(): AnkiCard[] {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      new Notice('No active note found');
      return [];
    }

    try {
      const content = activeView.editor.getValue();
      return extractQACardsFromText(content, this.settings);
    } catch (e: unknown) {
      console.warn('PandaZap: error extracting cards from note', e);
      new Notice('Error extracting cards from note');
      return [];
    }
  }

  processQACards(element: HTMLElement, plugin?: PandaZapPlugin) {
    const containers = element.querySelectorAll('p, div, span, li');

    containers.forEach((container) => {
      if (!container.instanceOf(HTMLElement) || container.classList.contains('panda-zap-qa-processed')) {
        return;
      }

      const fullText = container.textContent || '';
      const rx = buildMarkerRegexes(plugin?.settings ?? this.settings);

      if (
        !rx.qLabel.test(fullText) &&
        !rx.aLabel.test(fullText) &&
        !rx.iLabel.test(fullText)
      ) {
        return;
      }

      const boldQuestion = plugin?.settings?.boldQuestionInReadingMode ?? true;

      const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const toUpdate: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        const textNode = node as Text;
        if (!(textNode.parentElement?.closest('code, pre'))) {
          const t = textNode.nodeValue ?? '';
          if (rx.qaTextNode.test(t)) {
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

      const s = plugin?.settings ?? this.settings;
      const qLabelFull = `${(s.questionWord || '').trim() || 'Q'}:`;
      const aLabelFull = `${(s.answerWord || '').trim() || 'A'}:`;

      const applyTransform = (tn: Text) => {
        const parent = tn.parentNode;
        const text = tn.nodeValue ?? '';
        const frag = container.ownerDocument.createDocumentFragment();

        const appendSegment = (segment: string, question: boolean) => {
          if (!segment) return;
          if (boldQuestion && question) {
            const strong = container.ownerDocument.createElement('strong');
            strong.textContent = segment;
            frag.appendChild(strong);
          } else {
            frag.appendChild(container.ownerDocument.createTextNode(segment));
          }
        };

        rx.qaTextNode.lastIndex = 0;
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = rx.qaTextNode.exec(text)) !== null) {
          if (match.index > lastIndex) {
            appendSegment(text.slice(lastIndex, match.index), inQuestion);
          }

          const matched = match[0].toUpperCase();
          if (matched.includes(qLabelFull.toUpperCase())) {
            inQuestion = true;
          } else if (matched.includes(aLabelFull.toUpperCase())) {
            inQuestion = false;
          }
          lastIndex = rx.qaTextNode.lastIndex;
        }

        if (lastIndex < text.length) {
          appendSegment(text.slice(lastIndex), inQuestion);
        }

        if (frag.textContent !== text) {
          tn.replaceWith(frag);
          changed = true;
          let el = parent?.instanceOf(HTMLElement) ? parent : null;
          while (
            el &&
            el.childNodes.length === 0 &&
            !['P', 'DIV', 'LI'].includes(el.tagName)
          ) {
            const next = el.parentNode?.instanceOf(HTMLElement) ? el.parentNode : null;
            el.remove();
            el = next;
          }
        }
      };

      rx.qaTextNode.lastIndex = 0;
      for (const tn of toUpdate) {
        applyTransform(tn);
      }

      if (changed) {
        container.classList.add('panda-zap-qa-processed');
      }
    });
  }
}
