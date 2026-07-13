import { DEFAULT_SETTINGS } from './types';
import type { PandaZapSettings } from './types';

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface MarkerRegexes {
  qFull: string;
  aFull: string;
  iFull: string;
  qMarker: string;
  aMarker: string;
  iMarker: string;
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

  const wrappedMarker = (marker: string): string =>
    `(?:\\*\\*${marker}(?:\\*\\*)?|__${marker}(?:__)?|\\*${marker}(?:\\*)?|_${marker}(?:_)?|${marker})`;
  const qMarker = wrappedMarker(qFull);
  const aMarker = wrappedMarker(aFull);
  const iMarker = wrappedMarker(iFull);
  const boundary = '(?<!\\S)';

  return {
    qFull,
    aFull,
    iFull,
    qMarker,
    aMarker,
    iMarker,

    qLabel: new RegExp(`${boundary}${qMarker}`, 'i'),
    aLabel: new RegExp(`${boundary}${aMarker}`, 'i'),
    iLabel: new RegExp(`${boundary}${iMarker}`, 'i'),

    qStart: new RegExp(`^${qMarker}\\s*(.+)`, 'i'),
    aStart: new RegExp(`^${aMarker}\\s*(.*)`, 'i'),
    iStart: new RegExp(`^${iMarker}\\s*(.*)`, 'i'),

    qaTextNode: new RegExp(`${boundary}(?:${qMarker}|${aMarker}|${iMarker})`, 'gi'),
  };
}
