import { describe, it, expect } from 'vitest';
import { extractQACardsFromText } from '../src/sync/extractionUtils';
import { DEFAULT_SETTINGS } from '../src/sync/types';

describe('extractQACardsFromText - image paths', () => {
  it('extracts markdown image with spaces in path', () => {
    const text = `Q: Question
A: Answer
I: ![x](folder/my image.png)`;
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('folder/my image.png');
  });

  it('extracts markdown image with quoted title', () => {
    const text = `Q: Question
A: Answer
I: ![alt](path/to/image.png "Title")`;
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('path/to/image.png');
  });

  it('extracts markdown image with single-quoted title', () => {
    const text = `Q: Question
A: Answer
I: ![alt](path/img.png 'A title')`;
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('path/img.png');
  });

  it('extracts markdown image with angle-bracket URL', () => {
    const text = `Q: Question
A: Answer
I: ![alt](<path/to/image.png>)`;
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('path/to/image.png');
  });

  it('extracts single-line markdown image with spaces in path', () => {
    const text = 'Q: Question A: Answer I: ![x](folder/my image.png)';
    const cards = extractQACardsFromText(text, DEFAULT_SETTINGS);
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('folder/my image.png');
  });
});

describe('extractQACardsFromText - empty markers fallback', () => {
  it('uses default markers when questionWord is empty', () => {
    const text = 'Q: What? A: Answer';
    const cards = extractQACardsFromText(text, {
      ...DEFAULT_SETTINGS,
      questionWord: '',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('What?');
  });

  it('uses default markers when answerWord is empty', () => {
    const text = 'Q: What? A: Answer';
    const cards = extractQACardsFromText(text, {
      ...DEFAULT_SETTINGS,
      answerWord: '',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].answer).toBe('Answer');
  });

  it('uses default markers when imageWord is empty', () => {
    const text = 'Q: What? A: Answer I: [[img.png]]';
    const cards = extractQACardsFromText(text, {
      ...DEFAULT_SETTINGS,
      imageWord: '',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('img.png');
  });

  it('uses imageWord default when empty in single-line Q/I', () => {
    const text = 'Q: Question I: [[img.png]]';
    const cards = extractQACardsFromText(text, {
      ...DEFAULT_SETTINGS,
      imageWord: '',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].image).toBe('img.png');
  });
});

describe('extractQACardsFromText - marker correctness', () => {
  it('extracts custom markers containing regular-expression metacharacters', () => {
    const cards = extractQACardsFromText('[Q.*+?^${}()|]: What? (A)[.*]: Answer', {
      ...DEFAULT_SETTINGS,
      questionWord: '[Q.*+?^${}()|]',
      answerWord: '(A)[.*]',
    });

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('What?');
    expect(cards[0].answer).toBe('Answer');
  });

  it('does not treat marker letters inside natural words as labels', () => {
    const cards = extractQACardsFromText(
      'FAQ: DATA: Hawaii: prose\nQ: FAQ, DATA, and Hawaii: are words A: Correct',
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('FAQ, DATA, and Hawaii: are words');
    expect(cards[0].answer).toBe('Correct');
  });

  it('preserves underscores and Markdown in questions and answers', () => {
    const cards = extractQACardsFromText(
      'Q: **snake_case** and `code_value` A: _answer_value_ with [a_link](target)',
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('**snake_case** and `code_value`');
    expect(cards[0].answer).toBe('_answer_value_ with [a_link](target)');
  });

  it('consumes balanced Markdown wrappers around inline labels only', () => {
    const cards = extractQACardsFromText(
      '**Q:** **question_text** __A:__ _answer_text_ *I:* [[image.png]]',
      DEFAULT_SETTINGS
    );

    expect(cards).toEqual([
      {
        question: '**question_text**',
        answer: '_answer_text_',
        image: 'image.png',
      },
    ]);
  });

  it('ignores cards in tilde-fenced blocks', () => {
    const cards = extractQACardsFromText(
      ['~~~markdown', 'Q: Hidden A: Hidden', '~~~', 'Q: Visible A: Visible'].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Visible');
  });

  it('does not close a four-backtick fence with three backticks', () => {
    const cards = extractQACardsFromText(
      ['````markdown', '```', 'Q: Hidden A: Hidden', '````', 'Q: Visible A: Visible'].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Visible');
  });
});

describe('extractQACardsFromText - code blocks and HTML comments', () => {
  it('ignores a single-line HTML comment', () => {
    const cards = extractQACardsFromText(
      ['<!-- Q: Hidden A: Hidden -->', 'Q: Visible A: Visible'].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Visible');
  });

  it('ignores a multiline HTML comment', () => {
    const cards = extractQACardsFromText(
      ['<!--', 'Q: Hidden A: Hidden', 'still hidden', '-->', 'Q: Visible A: Visible'].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Visible');
  });

  it('skips a comment line between a question and its answer', () => {
    const cards = extractQACardsFromText(
      ['Q: Question', '<!-- note -->', 'A: Answer'].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Question');
    expect(cards[0].answer).toBe('Answer');
  });

  it('ignores four-space indented code blocks', () => {
    const cards = extractQACardsFromText(
      ['    Q: Hidden A: Hidden', '', '    still code', 'Q: Visible A: Visible'].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Visible');
  });

  it('does not let a four-space comment opener swallow the note', () => {
    const cards = extractQACardsFromText(
      ['Intro.', '', '    <!-- example', '    Q: Hidden A: Hidden', '', 'Q: Real A: Real'].join(
        '\n'
      ),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Real');
  });

  it('lets an unclosed comment at three spaces hide the rest of the note', () => {
    const cards = extractQACardsFromText(
      ['   <!-- unclosed note', 'Q: Hidden A: Hidden'].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(0);
  });

  it('extracts four-space list content after a blank line', () => {
    const cards = extractQACardsFromText('- Parent\n\n    Q: Four A: Four', DEFAULT_SETTINGS);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Four');
  });

  it('extracts four-space ordered list content after a blank line', () => {
    const cards = extractQACardsFromText(
      '1. Parent\n\n    Q: Ordered A: Ordered',
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Ordered');
  });

  it('extracts six-space nested list content after a blank line', () => {
    const cards = extractQACardsFromText(
      '- a\n  - b\n\n      Q: Nested A: Nested',
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Nested');
  });

  it('expands a tab after an unordered list marker to the next tab stop', () => {
    const cards = extractQACardsFromText('-\titem\n\n      Q: T6 A: T6', DEFAULT_SETTINGS);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('T6');
  });

  it('expands a tab after a star list marker to the next tab stop', () => {
    const cards = extractQACardsFromText('*\titem\n\n      Q: T6 A: T6', DEFAULT_SETTINGS);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('T6');
  });

  it('expands a tab after an ordered list marker to the next tab stop', () => {
    const cards = extractQACardsFromText('1)\titem\n\n       Q: T7 A: T7', DEFAULT_SETTINGS);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('T7');
  });

  it('expands a space and tab after a list marker to the next tab stop', () => {
    const cards = extractQACardsFromText('- \titem\n\n       Q: T7 A: T7', DEFAULT_SETTINGS);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('T7');
  });

  it('starts list content one column after the marker when the gap is five spaces', () => {
    const cards = extractQACardsFromText('-     item\n\n      Q: C A: C', DEFAULT_SETTINGS);

    expect(cards).toHaveLength(0);
  });

  it('ignores tab-indented code blocks', () => {
    const cards = extractQACardsFromText(
      ['\tQ: Hidden A: Hidden', '\tstill code', 'Q: Visible A: Visible'].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Visible');
  });

  it('still extracts cards nested in list items', () => {
    const cards = extractQACardsFromText(
      [
        '- Parent',
        '  - Child',
        '    Q: Four-space question A: Four-space answer',
        '  Q: Two-space question A: Two-space answer',
        '   Q: Three-space question A: Three-space answer',
      ].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(3);
    expect(cards[0].question).toBe('Four-space question');
    expect(cards[1].question).toBe('Two-space question');
    expect(cards[2].question).toBe('Three-space question');
  });

  it('still skips fenced code blocks', () => {
    const cards = extractQACardsFromText(
      [
        '```',
        '    Q: Hidden A: Hidden',
        'Q: Hidden A: Hidden',
        '```',
        'Q: Visible A: Visible',
      ].join('\n'),
      DEFAULT_SETTINGS
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Visible');
  });
});
