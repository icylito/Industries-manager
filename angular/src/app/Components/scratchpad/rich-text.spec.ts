import { describe, expect, it } from 'vitest';
import { FONT_GROUPS, knownFont } from './rich-text';

describe('note fonts', () => {
  it('keeps only the fonts the list offers, spelled the way the list spells them', () => {
    expect(FONT_GROUPS.flatMap(group => group.fonts).length).toBe(28);
    expect(knownFont('Caveat')).toBe('Caveat');
    expect(knownFont('jetbrains mono')).toBe('JetBrains Mono');
    expect(knownFont('Wingdings Pro')).toBeUndefined();
    expect(knownFont('Times New Roman')).toBeUndefined();
  });
});
