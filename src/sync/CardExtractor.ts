import { buildMarkerRegexes } from './markers';
import { markerLabels } from '../settings';
import PandaZapPlugin from '../main';

export class CardExtractor {
  processQACards(element: HTMLElement, plugin: PandaZapPlugin) {
    const containers = element.querySelectorAll('p, div, span, li');
    const rx = buildMarkerRegexes(plugin.settings);

    containers.forEach((container) => {
      if (
        !container.instanceOf(HTMLElement) ||
        container.classList.contains('panda-zap-qa-processed')
      ) {
        return;
      }

      const fullText = container.textContent || '';

      if (!rx.qLabel.test(fullText) && !rx.aLabel.test(fullText) && !rx.iLabel.test(fullText)) {
        return;
      }

      const boldQuestion = plugin.settings.boldQuestionInReadingMode;

      const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const toUpdate: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        const textNode = node as Text;
        if (!textNode.parentElement?.closest('code, pre')) {
          const t = textNode.nodeValue ?? '';
          rx.qaTextNode.lastIndex = 0;
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

      const labels = markerLabels(plugin.settings);
      const qLabelFull = `${labels.q}:`;
      const aLabelFull = `${labels.a}:`;

      const applyTransform = (tn: Text) => {
        const parent = tn.parentNode;
        const text = tn.nodeValue ?? '';
        const frag = createFragment();

        const appendSegment = (segment: string, question: boolean) => {
          if (!segment) return;
          if (boldQuestion && question) {
            const strong = frag.createEl('strong');
            strong.setText(segment);
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
          while (el && el.childNodes.length === 0 && !['P', 'DIV', 'LI'].includes(el.tagName)) {
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
