import { describe, it, expect } from 'vitest';
import { buildMarkerRegexes } from '../src/sync/markers';
import { DEFAULT_SETTINGS } from '../src/sync/types';

describe('buildMarkerRegexes', () => {
  it('builds regexes for default markers', () => {
    expect(buildMarkerRegexes(DEFAULT_SETTINGS).qLabel.test('Q: test')).toBe(true);
    expect(buildMarkerRegexes(DEFAULT_SETTINGS).aLabel.test('A: test')).toBe(true);
    expect(buildMarkerRegexes(DEFAULT_SETTINGS).iLabel.test('I: test')).toBe(true);
  });

  it('builds regexes for custom markers', () => {
    const rx = buildMarkerRegexes({
      ...DEFAULT_SETTINGS,
      questionWord: 'Question',
      answerWord: 'Answer',
      imageWord: 'Image',
    });
    expect(rx.qLabel.test('Question: test')).toBe(true);
    expect(rx.aLabel.test('Answer: test')).toBe(true);
    expect(rx.iLabel.test('Image: test')).toBe(true);
    expect(rx.qLabel.test('Q: test')).toBe(false);
    expect(rx.aLabel.test('A: test')).toBe(false);
  });

  it('builds qaTextNode regex matching custom markers', () => {
    const mk = () =>
      buildMarkerRegexes({
        ...DEFAULT_SETTINGS,
        questionWord: 'Question',
        answerWord: 'Answer',
        imageWord: 'Image',
      });
    expect(mk().qaTextNode.test('Question: What?')).toBe(true);
    expect(mk().qaTextNode.test('Answer: That.')).toBe(true);
    expect(mk().qaTextNode.test('Image: img.png')).toBe(true);
    expect(mk().qaTextNode.test('Q: hardcoded')).toBe(false);
  });

  it('handles bold markers with asterisks', () => {
    const rx = buildMarkerRegexes(DEFAULT_SETTINGS);
    expect(rx.qLabel.test('*Q: test')).toBe(true);
    expect(rx.qLabel.test('_Q: test')).toBe(true);
    expect(rx.qStart.test('*Q: what?')).toBeTruthy();
  });

  it('escapes every regular-expression metacharacter in custom markers', () => {
    for (const marker of ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']) {
      const rx = buildMarkerRegexes({
        ...DEFAULT_SETTINGS,
        questionWord: marker,
        answerWord: marker,
        imageWord: marker,
      });

      expect(rx.qStart.test(`${marker}: exact`), marker).toBe(true);
      expect(rx.aStart.test(`${marker}: exact`), marker).toBe(true);
      expect(rx.iStart.test(`${marker}: exact`), marker).toBe(true);
    }
  });

  it('requires a start or whitespace boundary before labels', () => {
    const rx = buildMarkerRegexes(DEFAULT_SETTINGS);

    expect(rx.qLabel.test('FAQ: prose')).toBe(false);
    expect(rx.aLabel.test('DATA: prose')).toBe(false);
    expect(rx.iLabel.test('Hawaii: prose')).toBe(false);
    expect(rx.qLabel.test('Text Q: actual marker')).toBe(true);
  });

  it('matches and consumes balanced Markdown wrappers around labels', () => {
    const rx = buildMarkerRegexes(DEFAULT_SETTINGS);

    expect('**Q:** question'.match(rx.qStart)?.[1]).toBe('question');
    expect('__A:__ answer'.match(rx.aStart)?.[1]).toBe('answer');
    expect('*I:* image.png'.match(rx.iStart)?.[1]).toBe('image.png');
  });
});
