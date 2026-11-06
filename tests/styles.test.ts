import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/**
 * Rule selectors in the stylesheet, without comments, at-rules or the
 * `from`/`to`/`50%` steps inside keyframes.
 */
function ruleSelectors(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  const rule = /([^{}]+)\{/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(withoutComments)) !== null) {
    const selector = match[1].trim();
    if (selector.startsWith('@')) continue;
    if (selector === 'from' || selector === 'to' || /^\d+%$/.test(selector)) continue;
    selectors.push(
      ...selector
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    );
  }
  return selectors;
}

const selectors = ruleSelectors(css);

describe('styles.css', () => {
  it('uses theme variables instead of hardcoded hex colors', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('namespaces the connection result classes', () => {
    expect(selectors.filter((selector) => /\.connection-/.test(selector))).toEqual([]);
    for (const name of ['content', 'icon', 'text', 'details']) {
      expect(css).toContain(`.panda-zap-connection-${name}`);
    }
  });

  it('has no fixed modal min-width that overflows narrow windows', () => {
    expect(css).not.toMatch(/min-width:\s*(520|600)px/);
  });

  it('scopes every selector to a panda-zap class', () => {
    const unscoped = selectors.filter((selector) => !selector.includes('.panda-zap-'));
    expect(unscoped).toEqual([]);
  });

  it('gives the interactive section header a keyboard focus style', () => {
    expect(css).toMatch(/\.panda-zap-section-header:focus-visible\s*\{[^}]*outline:/);
  });
});
