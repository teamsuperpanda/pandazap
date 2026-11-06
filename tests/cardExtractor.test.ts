// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({}));
vi.mock('../src/main', () => ({ default: class {} }));

import { CardExtractor } from '../src/sync/CardExtractor';
import { DEFAULT_SETTINGS, type PandaZapSettings } from '../src/sync/types';
import { installObsidianDom } from './obsidianDom';

function settings(overrides: Partial<PandaZapSettings> = {}): PandaZapSettings {
  return { ...DEFAULT_SETTINGS, boldQuestionInReadingMode: true, ...overrides };
}

function process(markup: string, overrides: Partial<PandaZapSettings> = {}) {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  const root = document.createElement('div');
  for (const child of Array.from(parsed.body.childNodes)) {
    root.appendChild(document.importNode(child, true));
  }
  new CardExtractor().processQACards(root, { settings: settings(overrides) } as never);
  return root;
}

function paragraph(root: HTMLElement): HTMLElement {
  const el = root.querySelector('p');
  if (!el) throw new Error('expected a paragraph');
  return el;
}

describe('CardExtractor.processQACards', () => {
  beforeEach(() => {
    installObsidianDom();
  });

  it('marks a container with Q and A markers as processed', () => {
    const root = process('<p>Q: What is TypeScript? A: A typed superset of JavaScript</p>');

    expect(paragraph(root).classList.contains('panda-zap-qa-processed')).toBe(true);
  });

  it('treats the I marker as a card marker too', () => {
    const root = process('<p>Q: What is this? I: diagram.png A: A diagram</p>');

    expect(paragraph(root).classList.contains('panda-zap-qa-processed')).toBe(true);
  });

  it('bolds the question when boldQuestionInReadingMode is on', () => {
    const root = process('<p>Q: What is TypeScript? A: A typed superset</p>');

    const strong = paragraph(root).querySelector('strong');
    expect(strong?.textContent?.trim()).toBe('What is TypeScript?');
    expect(paragraph(root).textContent).not.toContain('Q:');
  });

  it('leaves the question unbolded when the setting is off', () => {
    const root = process('<p>Q: What is TypeScript? A: A typed superset</p>', {
      boldQuestionInReadingMode: false,
    });

    expect(paragraph(root).querySelector('strong')).toBeNull();
    expect(paragraph(root).classList.contains('panda-zap-qa-processed')).toBe(true);
  });

  it('skips containers already marked panda-zap-qa-processed', () => {
    const root = process('<p class="panda-zap-qa-processed">Q: Already A: Done</p>');

    const p = paragraph(root);
    expect(p.querySelector('strong')).toBeNull();
    expect(p.textContent).toBe('Q: Already A: Done');
  });

  it('never rewrites text inside code or pre', () => {
    const root = process(
      '<p>Q: Question <code>Q: not a question A: not an answer</code> A: Answer</p>'
    );

    expect(paragraph(root).querySelector('code')?.textContent).toBe(
      'Q: not a question A: not an answer'
    );
    expect(paragraph(root).querySelector('code strong')).toBeNull();
  });

  it('leaves a pre block holding markers untouched', () => {
    const root = process('<p>Q: Question A: Answer</p><pre>Q: raw A: raw</pre>');

    expect(root.querySelector('pre')?.textContent).toBe('Q: raw A: raw');
    expect(root.querySelector('pre strong')).toBeNull();
  });

  it('leaves containers without markers untouched', () => {
    const root = process('<p>Just a plain paragraph with no markers</p>');

    const p = paragraph(root);
    expect(p.classList.contains('panda-zap-qa-processed')).toBe(false);
    expect(p.textContent).toBe('Just a plain paragraph with no markers');
  });
});
