import { describe, it, expect } from 'vitest';
import { normalizeSettings, buildMarkerRegexes, validationErrors } from '../src/sync/markers';
import { DEFAULT_SETTINGS } from '../src/sync/types';

describe('normalizeSettings', () => {
  it('returns defaults when markers are empty', () => {
    const result = normalizeSettings({
      ...DEFAULT_SETTINGS,
      questionWord: '',
      answerWord: '',
      imageWord: '',
    });
    expect(result.questionWord).toBe(DEFAULT_SETTINGS.questionWord);
    expect(result.answerWord).toBe(DEFAULT_SETTINGS.answerWord);
    expect(result.imageWord).toBe(DEFAULT_SETTINGS.imageWord);
  });

  it('trims whitespace from marker values', () => {
    const result = normalizeSettings({
      ...DEFAULT_SETTINGS,
      questionWord: '  Q  ',
      answerWord: '  A  ',
    });
    expect(result.questionWord).toBe('Q');
    expect(result.answerWord).toBe('A');
  });

  it('preserves valid custom markers', () => {
    const result = normalizeSettings({
      ...DEFAULT_SETTINGS,
      questionWord: 'Question',
      answerWord: 'Answer',
      imageWord: 'Image',
    });
    expect(result.questionWord).toBe('Question');
    expect(result.answerWord).toBe('Answer');
    expect(result.imageWord).toBe('Image');
  });

  it('falls back individually when some markers are empty', () => {
    const result = normalizeSettings({
      ...DEFAULT_SETTINGS,
      questionWord: 'Q',
      answerWord: '',
      imageWord: 'Img',
    });
    expect(result.questionWord).toBe('Q');
    expect(result.answerWord).toBe(DEFAULT_SETTINGS.answerWord);
    expect(result.imageWord).toBe('Img');
  });
});

describe('buildMarkerRegexes', () => {
  it('builds regexes for default markers', () => {
    const markers = normalizeSettings(DEFAULT_SETTINGS);
    expect(buildMarkerRegexes(markers).qLabel.test('Q: test')).toBe(true);
    expect(buildMarkerRegexes(markers).aLabel.test('A: test')).toBe(true);
    expect(buildMarkerRegexes(markers).iLabel.test('I: test')).toBe(true);
  });

  it('builds regexes for custom markers', () => {
    const markers = normalizeSettings({
      ...DEFAULT_SETTINGS,
      questionWord: 'Question',
      answerWord: 'Answer',
      imageWord: 'Image',
    });
    const rx = buildMarkerRegexes(markers);
    expect(rx.qLabel.test('Question: test')).toBe(true);
    expect(rx.aLabel.test('Answer: test')).toBe(true);
    expect(rx.iLabel.test('Image: test')).toBe(true);
    expect(rx.qLabel.test('Q: test')).toBe(false);
    expect(rx.aLabel.test('A: test')).toBe(false);
  });

  it('builds qaTextNode regex matching custom markers', () => {
    const markers = normalizeSettings({
      ...DEFAULT_SETTINGS,
      questionWord: 'Question',
      answerWord: 'Answer',
      imageWord: 'Image',
    });
    const re1 = buildMarkerRegexes(markers).qaTextNode;
    expect(re1.test('Question: What?')).toBe(true);
    const re2 = buildMarkerRegexes(markers).qaTextNode;
    expect(re2.test('Answer: That.')).toBe(true);
    const re3 = buildMarkerRegexes(markers).qaTextNode;
    expect(re3.test('Image: img.png')).toBe(true);
    const re4 = buildMarkerRegexes(markers).qaTextNode;
    expect(re4.test('Q: hardcoded')).toBe(false);
  });

  it('handles bold markers with asterisks', () => {
    const markers = normalizeSettings(DEFAULT_SETTINGS);
    const rx = buildMarkerRegexes(markers);
    expect(rx.qLabel.test('*Q: test')).toBe(true);
    expect(rx.qLabel.test('_Q: test')).toBe(true);
    expect(rx.qStart.test('*Q: what?')).toBeTruthy();
  });
});

describe('validationErrors', () => {
  it('reports collision when questionWord equals answerWord', () => {
    const errors = validationErrors({
      ...DEFAULT_SETTINGS,
      questionWord: 'Note',
      answerWord: 'Note',
      imageWord: 'I',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].toLowerCase()).toContain('question');
    expect(errors[0].toLowerCase()).toContain('answer');
  });

  it('reports collision when questionWord equals imageWord', () => {
    const errors = validationErrors({
      ...DEFAULT_SETTINGS,
      questionWord: 'X',
      answerWord: 'A',
      imageWord: 'X',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('returns empty when all markers are distinct', () => {
    const errors = validationErrors(DEFAULT_SETTINGS);
    expect(errors).toEqual([]);
  });

  it('returns empty when all markers are empty', () => {
    const errors = validationErrors({
      ...DEFAULT_SETTINGS,
      questionWord: '',
      answerWord: '',
      imageWord: '',
    });
    expect(errors).toEqual([]);
  });

  it('returns empty when only one marker is set', () => {
    const errors = validationErrors({
      ...DEFAULT_SETTINGS,
      questionWord: 'Q',
      answerWord: '',
      imageWord: '',
    });
    expect(errors).toEqual([]);
  });
});
