import { DEFAULT_SETTINGS } from './types';
import type { PandaZapSettings } from './types';

export interface NormalizedMarkers {
  questionWord: string;
  answerWord: string;
  imageWord: string;
}

export function normalizeSettings(
  settings: PandaZapSettings
): NormalizedMarkers {
  return {
    questionWord: (settings.questionWord || '').trim() || DEFAULT_SETTINGS.questionWord,
    answerWord: (settings.answerWord || '').trim() || DEFAULT_SETTINGS.answerWord,
    imageWord: (settings.imageWord || '').trim() || DEFAULT_SETTINGS.imageWord,
  };
}

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

export function buildMarkerRegexes(markers: NormalizedMarkers): MarkerRegexes {
  const escQ = escapeRegex(markers.questionWord);
  const escA = escapeRegex(markers.answerWord);
  const escI = escapeRegex(markers.imageWord);

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

export function validationErrors(
  settings: PandaZapSettings
): string[] {
  const errors: string[] = [];
  const q = (settings.questionWord || '').trim();
  const a = (settings.answerWord || '').trim();
  const i = (settings.imageWord || '').trim();

  if (!q && !a && !i) {
    return errors;
  }

  if (q && a && q.toLowerCase() === a.toLowerCase()) {
    errors.push('Question word and answer word must be different.');
  }
  if (q && i && q.toLowerCase() === i.toLowerCase()) {
    errors.push('Question word and image word must be different.');
  }
  if (a && i && a.toLowerCase() === i.toLowerCase()) {
    errors.push('Answer word and image word must be different.');
  }

  return errors;
}
