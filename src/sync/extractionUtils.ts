import { AnkiCard, PandaZapSettings } from './types';
import { buildMarkerRegexes } from './markers';

function parseImagePath(text: string): string | null {
  if (!text) return null;
  let clean = text.trim();

  const wikiMatch = clean.match(/^!{0,1}\[\[(.*?)\]\]$/);
  if (wikiMatch) {
    clean = wikiMatch[1];
    const pipeIndex = clean.lastIndexOf('|');
    if (pipeIndex !== -1) {
      clean = clean.substring(0, pipeIndex);
    }
    return clean.trim();
  }

  const mdMatch = clean.match(/^!\[.*?\]\(((?:[^()]+|\([^()]*\))*)\)$/);
  if (mdMatch) {
    const dest = mdMatch[1];
    const angleMatch = dest.match(/^<([^>]+)>\s*$/);
    if (angleMatch) {
      return angleMatch[1].trim();
    }
    const titleSplit = dest.match(/^(.*?)\s+(["'])(.*)\2$/);
    if (titleSplit) {
      return titleSplit[1].trim();
    }
    return dest.trim();
  }

  const wikiFind = clean.match(/!{0,1}\[\[(.*?)\]\]/);
  if (wikiFind) {
    const inner = wikiFind[1];
    const pipeIndex = inner.lastIndexOf('|');
    return pipeIndex !== -1 ? inner.substring(0, pipeIndex).trim() : inner.trim();
  }

  const mdFind = clean.match(/!\[.*?\]\(((?:[^()]+|\([^()]*\))*)\)/);
  if (mdFind) {
    const d = mdFind[1];
    const titleSplit = d.match(/^(.*?)\s+(?:"|')(.*)(?:"|')$/);
    if (titleSplit) {
      return titleSplit[1].trim();
    }
    return d.trim();
  }

  return clean;
}

export function extractQACardsFromText(content: string, settings: PandaZapSettings): AnkiCard[] {
  if (!content || !settings) {
    return [];
  }

  const rx = buildMarkerRegexes(settings);

  const cards: AnkiCard[] = [];
  const lines = content.split('\n');

  const lineState: Array<'normal' | 'frontmatter' | 'fenced'> = [];
  let inFrontmatter = false;
  let inFenced = false;

  for (let k = 0; k < lines.length; k++) {
    const trimmed = lines[k].trim();

    if (k === 0 && trimmed === '---') {
      inFrontmatter = true;
      lineState.push('frontmatter');
      continue;
    }

    if (inFrontmatter) {
      if (trimmed === '---') {
        inFrontmatter = false;
      }
      lineState.push('frontmatter');
      continue;
    }

    if (trimmed.startsWith('```')) {
      inFenced = !inFenced;
      lineState.push('fenced');
      continue;
    }

    if (inFenced) {
      lineState.push('fenced');
      continue;
    }

    lineState.push('normal');
  }

  try {
    for (let i = 0; i < lines.length; i++) {
      if (lineState[i] !== 'normal') continue;
      const line = lines[i];

      const singleLineAll = new RegExp(
        `(?:[*_]{0,2})${rx.qFull}\\s*(.+?)\\s*(?:[*_]{0,2})${rx.aFull}\\s*(.+?)\\s*(?:[*_]{0,2})${rx.iFull}\\s*(.+)`,
        'i'
      );
      const matchAll = line.match(singleLineAll);
      if (matchAll) {
        cards.push({
          question: matchAll[1].replace(/[*_]+/g, '').trim(),
          answer: matchAll[2].replace(/[*_]+/g, '').trim(),
          image: parseImagePath(matchAll[3]) || undefined,
          line: i + 1,
        });
        continue;
      }

      const singleLineQI = new RegExp(
        `(?:[*_]{0,2})${rx.qFull}\\s*(.+?)\\s*(?:[*_]{0,2})${rx.iFull}\\s*(.+)`,
        'i'
      );
      const matchQI = line.match(singleLineQI);
      if (matchQI) {
        if (!rx.aLabel.test(matchQI[1])) {
          cards.push({
            question: matchQI[1].replace(/[*_]+/g, '').trim(),
            answer: '',
            image: parseImagePath(matchQI[2]) || undefined,
            line: i + 1,
          });
          continue;
        }
      }

      const singleLineQA = new RegExp(
        `(?:[*_]{0,2})${rx.qFull}\\s*(.+?)\\s*(?:[*_]{0,2})${rx.aFull}\\s*(.+)`,
        'i'
      );
      const matchQA = line.match(singleLineQA);
      if (matchQA) {
        const possibleAnswer = matchQA[2];
        if (!rx.iLabel.test(possibleAnswer)) {
          cards.push({
            question: matchQA[1].replace(/[*_]+/g, '').trim(),
            answer: possibleAnswer.replace(/[*_]+/g, '').trim(),
            line: i + 1,
          });
          continue;
        }
      }

      const qMatch = line.match(rx.qStart);
      if (qMatch) {
        const aLabelRegex = new RegExp(`\\s*(?:[*_]{0,2})${rx.aFull}\\s*$`, 'i');
        const iLabelRegex = new RegExp(`\\s*(?:[*_]{0,2})${rx.iFull}\\s*$`, 'i');
        const questionText = qMatch[1].replace(aLabelRegex, '').replace(iLabelRegex, '').trim();
        const answerLines: string[] = [];
        let imagePath: string | undefined = undefined;
        let hasAnswer = false;

        let currentMode: 'none' | 'answer' | 'image' = 'none';

        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];

          if (nextLine.trim() === '') break;
          if (rx.qStart.test(nextLine)) break;
          if (lineState[j] !== 'normal') break;

          const iMatch = nextLine.match(rx.iStart);
          if (iMatch) {
            currentMode = 'image';
            imagePath = parseImagePath(iMatch[1]);
            j++;
            continue;
          }

          const aMatch = nextLine.match(rx.aStart);
          if (aMatch) {
            currentMode = 'answer';
            hasAnswer = true;
            if (aMatch[1].trim()) {
              answerLines.push(aMatch[1]);
            }
            j++;
            continue;
          }

          if (currentMode === 'answer') {
            answerLines.push(nextLine);
          } else if (currentMode === 'image') {
            if (!imagePath) {
              imagePath = parseImagePath(nextLine);
            }
          } else if (currentMode === 'none') {
            currentMode = 'answer';
            hasAnswer = true;
            answerLines.push(nextLine);
          }

          j++;
        }

        if (hasAnswer || imagePath) {
          cards.push({
            question: questionText.replace(/[*_]+/g, '').trim(),
            answer: answerLines.join('\n').trim(),
            image: imagePath || undefined,
            line: i + 1,
          });
          i = j - 1;
        }
      }
    }
  } catch (e: unknown) {
    console.warn('PandaZap: extraction error', e);
    return [];
  }

  return cards;
}

export default extractQACardsFromText;
