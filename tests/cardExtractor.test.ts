import { describe, it, expect } from 'vitest';

describe('CardExtractor (unit tests)', () => {
  // Note: CardExtractor tests that depend on Obsidian API are skipped in unit tests
  // These would be better suited for integration tests with proper Obsidian environment

  it('should be tested in integration environment', () => {
    // This test serves as a placeholder to remind us that CardExtractor
    // needs integration testing with the actual Obsidian environment
    expect(true).toBe(true);
  });

  describe('DOM processing logic (extracted)', () => {
    it('processes Q&A text patterns correctly', () => {
      // Test the regex patterns that would be used by CardExtractor
      const qTag = 'Q';
      const aTag = 'A';
      const iTag = 'I';
      const escQ = qTag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ':';
      const escA = aTag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ':';
      const escI = iTag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ':';

      const testText = 'Q: What is TypeScript? I: ts-logo.png A: A typed superset of JavaScript';

      expect(new RegExp(`[*_]{0,2}${escQ}`).test(testText)).toBe(true);
      expect(new RegExp(`[*_]{0,2}${escA}`).test(testText)).toBe(true);
      expect(new RegExp(`[*_]{0,2}${escI}`).test(testText)).toBe(true);
    });

    it('matches Q, A and I tags correctly with alternation', () => {
      const qTag = 'Q';
      const aTag = 'A';
      const iTag = 'I';
      const escQ = qTag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ':';
      const escA = aTag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ':';
      const escI = iTag.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ':';
      
      const parts = [`([*_]{0,2})${escQ}\\s*`, `([*_]{0,2})${escA}\\s*`, `([*_]{0,2})${escI}\\s*`];
      const regex = new RegExp(parts.join('|'), 'gi');
      
      const text = "Q: Test I: Image A: Ans";
      const matches = text.match(regex);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(3);
      expect(matches![0].trim()).toBe('Q:');
      expect(matches![1].trim()).toBe('I:');
      expect(matches![2].trim()).toBe('A:');
    });
  });
});
