import { describe, expect, it } from 'vitest';
import { fieldsMatch, normalizeField, normalizeHtmlField } from '../src/sync/fieldComparison';

describe('normalizeField', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeField('  Question \n')).toBe('Question');
  });

  it('leaves inner whitespace alone', () => {
    expect(normalizeField('  two  words ')).toBe('two  words');
  });

  it('treats a missing value as empty', () => {
    expect(normalizeField('')).toBe('');
  });
});

describe('normalizeHtmlField', () => {
  it('decodes the entities Anki writes', () => {
    expect(normalizeHtmlField('a&nbsp;b &amp; c &lt;d&gt; &quot;e&quot;')).toBe('a b & c <d> "e"');
  });

  it('turns line-break markup into newlines', () => {
    expect(normalizeHtmlField('one<br>two<br />three')).toBe('one\ntwo\nthree');
    expect(normalizeHtmlField('<div>one</div><p>two</p>')).toBe('one\n\ntwo');
  });

  it('drops span markup without breaking the line', () => {
    expect(normalizeHtmlField('<span class="x">one</span> two')).toBe('one two');
  });

  it('normalises CRLF and collapses blank-line runs', () => {
    expect(normalizeHtmlField('one\r\ntwo')).toBe('one\ntwo');
    expect(normalizeHtmlField('one\n\n\n\ntwo')).toBe('one\n\ntwo');
  });

  it('trims the result', () => {
    expect(normalizeHtmlField('  <span>one</span>  ')).toBe('one');
  });
});

describe('fieldsMatch', () => {
  it('matches identical fields', () => {
    expect(fieldsMatch('Question', 'Question')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(fieldsMatch(' Question ', 'Question')).toBe(true);
  });

  it('matches fields that differ only in Anki HTML', () => {
    expect(fieldsMatch('one<br>two', 'one\ntwo')).toBe(true);
    expect(fieldsMatch('<div>one&nbsp;two</div>', 'one two')).toBe(true);
  });

  it('rejects fields whose content differs', () => {
    expect(fieldsMatch('Question', 'Question two')).toBe(false);
    expect(fieldsMatch('one\ntwo', 'one two')).toBe(false);
  });
});
