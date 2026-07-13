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
  const boundary = '(?<!\\S)';
  const singleLineAll = new RegExp(
    `${boundary}${rx.qMarker}\\s*(.+?)\\s*${boundary}${rx.aMarker}\\s*(.+?)\\s*${boundary}${rx.iMarker}\\s*(.+)`,
    'i'
  );
  const singleLineQI = new RegExp(
    `${boundary}${rx.qMarker}\\s*(.+?)\\s*${boundary}${rx.iMarker}\\s*(.+)`,
    'i'
  );
  const singleLineQA = new RegExp(
    `${boundary}${rx.qMarker}\\s*(.+?)\\s*${boundary}${rx.aMarker}\\s*(.+)`,
    'i'
  );
  const aLabelAtEnd = new RegExp(`\\s+${rx.aMarker}\\s*$`, 'i');
  const iLabelAtEnd = new RegExp(`\\s+${rx.iMarker}\\s*$`, 'i');
  const openingFencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;

  const lineState: Array<'normal' | 'frontmatter' | 'fenced'> = [];
  let inFrontmatter = false;
  let fenceCharacter: '`' | '~' | null = null;
  let fenceLength = 0;
  let closingFence: RegExp | null = null;

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

    if (fenceCharacter) {
      lineState.push('fenced');
      if (closingFence?.test(lines[k])) {
        fenceCharacter = null;
        fenceLength = 0;
        closingFence = null;
      }
      continue;
    }

    const openingFence = lines[k].match(openingFencePattern);
    if (openingFence && (openingFence[1][0] === '~' || !openingFence[2].includes('`'))) {
      fenceCharacter = openingFence[1][0] as '`' | '~';
      fenceLength = openingFence[1].length;
      closingFence = new RegExp(
        `^ {0,3}${fenceCharacter === '`' ? '`' : '~'}{${fenceLength},}\\s*$`
      );
      lineState.push('fenced');
      continue;
    }

    lineState.push('normal');
  }

  try {
    for (let i = 0; i < lines.length; i++) {
      if (lineState[i] !== 'normal') continue;
      const line = lines[i];

      const matchAll = line.match(singleLineAll);
      if (matchAll) {
        cards.push({
          question: matchAll[1].trim(),
          answer: matchAll[2].trim(),
          image: parseImagePath(matchAll[3]) || undefined,
          line: i + 1,
        });
        continue;
      }

      const matchQI = line.match(singleLineQI);
      if (matchQI) {
        if (!rx.aLabel.test(matchQI[1])) {
          cards.push({
            question: matchQI[1].trim(),
            answer: '',
            image: parseImagePath(matchQI[2]) || undefined,
            line: i + 1,
          });
          continue;
        }
      }

      const matchQA = line.match(singleLineQA);
      if (matchQA) {
        const possibleAnswer = matchQA[2];
        if (!rx.iLabel.test(possibleAnswer)) {
          cards.push({
            question: matchQA[1].trim(),
            answer: possibleAnswer.trim(),
            line: i + 1,
          });
          continue;
        }
      }

      const qMatch = line.match(rx.qStart);
      if (qMatch) {
        const questionText = qMatch[1].replace(aLabelAtEnd, '').replace(iLabelAtEnd, '').trim();
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
            question: questionText,
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
