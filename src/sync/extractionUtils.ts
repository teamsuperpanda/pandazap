import { AnkiCard, PandaZapSettings } from './types';
import { buildMarkerRegexes, escapeRegex } from './markers';

const FRONTMATTER_DECK_KEY = /^deck\s*:\s*(.*)$/;

/** Anki nests decks with `::`, while note overrides accept either separator. */
function normalizeDeckTarget(value: string | undefined): string | undefined {
  const target = (value ?? '').trim().replace(/\//g, '::');
  return target || undefined;
}

/** Drops one matching pair of YAML single or double quotes around a value. */
function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Reads the deck a note targets from its header. A leading YAML frontmatter
 * block wins with a top-level `deck:` key; otherwise the first line after the
 * block may carry `<overrideWord>:: Name`. A `deck:` key anywhere in the body
 * is plain text and never an override. The extraction layer can reuse this to
 * parse note headers in one place.
 */
export function extractDeckOverride(content: string, overrideWord: string): string | undefined {
  if (!content) return undefined;
  const lines = content.split(/\r?\n/);

  let bodyStart = 0;
  if (lines[0]?.trim() === '---') {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    // An unclosed block is malformed, not frontmatter, so it carries no key.
    if (closing !== -1) {
      let deck: string | undefined;
      for (const line of lines.slice(1, closing)) {
        const match = line.match(FRONTMATTER_DECK_KEY);
        const value = match ? stripYamlQuotes(match[1]) : '';
        if (value) deck = value;
      }
      if (deck) return normalizeDeckTarget(deck);
      bodyStart = closing + 1;
    }
  }

  const word = overrideWord.trim();
  if (!word) return undefined;
  const firstLine = lines[bodyStart] ?? '';
  const match = firstLine.match(new RegExp(`^${escapeRegex(word)}::\\s*(.+)$`, 'i'));
  return normalizeDeckTarget(match?.[1]);
}

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
  const htmlCommentPattern = /^ {0,3}<!--/;
  const listItemPattern = /^(\s*)([-*+]|\d{1,9}[.)])\s+/;

  const leadingIndent = (line: string): number => {
    let width = 0;
    for (const char of line) {
      if (char === ' ') width += 1;
      else if (char === '\t') width += 4;
      else break;
    }
    return width;
  };

  const columnAfter = (text: string, startColumn = 0): number => {
    let column = startColumn;
    for (const char of text) {
      column = char === '\t' ? column + 4 - (column % 4) : column + 1;
    }
    return column;
  };

  // Line-state pass. Only 'normal' lines are parsed as cards. Fences win over
  // indented code, which wins over HTML comments. Indented code follows the
  // CommonMark list shape: open list items are tracked by content column, blank
  // lines keep them open, and a non-blank line indented less than the innermost
  // content column closes items. Code starts at 4+ columns past the innermost
  // content column (or 4+ at top level) after a blank line or at file start.
  // Known limits: leading indentation counts a tab as 4 columns (list content
  // columns use tab stops), list markers inside paragraphs are still tracked,
  // and only comment openers at 0-3 spaces are recognised.
  const lineState: Array<'normal' | 'frontmatter' | 'fenced' | 'comment' | 'code'> = [];
  const listContentColumns: number[] = [];
  let inFrontmatter = false;
  let inComment = false;
  let inIndentedCode = false;
  let codeIndent = 4;
  let fenceCharacter: '`' | '~' | null = null;
  let fenceLength: number;
  let closingFence: RegExp | null = null;

  for (let k = 0; k < lines.length; k++) {
    const trimmed = lines[k].trim();
    const indent = leadingIndent(lines[k]);

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
        closingFence = null;
      }
      continue;
    }

    if (inIndentedCode) {
      if (trimmed === '' || indent >= codeIndent) {
        lineState.push('code');
        continue;
      }
      inIndentedCode = false;
    }

    if (inComment) {
      lineState.push('comment');
      if (lines[k].includes('-->')) {
        inComment = false;
      }
      continue;
    }

    if (trimmed !== '') {
      while (
        listContentColumns.length > 0 &&
        indent < listContentColumns[listContentColumns.length - 1]
      ) {
        listContentColumns.pop();
      }
    }

    const codeThreshold =
      (listContentColumns.length > 0 ? listContentColumns[listContentColumns.length - 1] : 0) + 4;

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

    if (htmlCommentPattern.test(lines[k])) {
      lineState.push('comment');
      if (lines[k].indexOf('-->', lines[k].indexOf('<!--') + 4) === -1) {
        inComment = true;
      }
      continue;
    }

    if ((k === 0 || lines[k - 1].trim() === '') && indent >= codeThreshold) {
      inIndentedCode = true;
      codeIndent = codeThreshold;
      lineState.push('code');
      continue;
    }

    const listItem = lines[k].match(listItemPattern);
    if (listItem) {
      const markerEnd = columnAfter(listItem[1] + listItem[2]);
      const gap = listItem[0].slice(listItem[1].length + listItem[2].length);
      const gapWidth = columnAfter(gap, markerEnd) - markerEnd;
      listContentColumns.push(gapWidth > 4 ? markerEnd + 1 : markerEnd + gapWidth);
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
          if (lineState[j] === 'comment') {
            j++;
            continue;
          }
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
