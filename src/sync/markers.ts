import { DEFAULT_SETTINGS } from './types';
import type { PandaZapSettings } from './types';

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

export interface MarkerRegexes {
  qFull: string;
  aFull: string;
  iFull: string;
  qLabel: RegExp;
  aLabel: RegExp;
  iLabel: RegExp;
  qStart: RegExp;
  aStart: RegExp;
  iStart: RegExp;
  qaTextNode: RegExp;
}

export function buildMarkerRegexes(settings: PandaZapSettings): MarkerRegexes {
  const qWord = (settings.questionWord || '').trim() || DEFAULT_SETTINGS.questionWord;
  const aWord = (settings.answerWord || '').trim() || DEFAULT_SETTINGS.answerWord;
  const iWord = (settings.imageWord || '').trim() || DEFAULT_SETTINGS.imageWord;
  const escQ = escapeRegex(qWord);
  const escA = escapeRegex(aWord);
  const escI = escapeRegex(iWord);

  const qFull = `${escQ}:`;
  const aFull = `${escA}:`;
  const iFull = `${escI}:`;

  const optBold = '(?:[*_]{0,2})';

  return {
    qFull,
    aFull,
    iFull,

    qLabel: new RegExp(`${optBold}${qFull}`, 'i'),
    aLabel: new RegExp(`${optBold}${aFull}`, 'i'),
    iLabel: new RegExp(`${optBold}${iFull}`, 'i'),

    qStart: new RegExp(`^${optBold}${qFull}\\s*(.+)`, 'i'),
    aStart: new RegExp(`^${optBold}${aFull}\\s*(.*)`, 'i'),
    iStart: new RegExp(`^${optBold}${iFull}\\s*(.*)`, 'i'),

    qaTextNode: new RegExp(
      `${optBold}${qFull}|${optBold}${aFull}|${optBold}${iFull}`,
      'gi'
    ),
  };
}


