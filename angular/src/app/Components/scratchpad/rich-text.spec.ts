import { describe, expect, it } from 'vitest';
import { FONT_GROUPS, knownFont, renderBlocks, serializeBlocks } from './rich-text';

describe('note fonts', () => {
  it('keeps only the fonts the list offers, spelled the way the list spells them', () => {
    expect(FONT_GROUPS.flatMap(group => group.fonts).length).toBe(48);
    expect(knownFont('Caveat')).toBe('Caveat');
    expect(knownFont('jetbrains mono')).toBe('JetBrains Mono');
    expect(knownFont('Wingdings Pro')).toBeUndefined();
    expect(knownFont('Times New Roman')).toBeUndefined();
  });

  it('draws an empty line with something in it, so typing goes into that line and adds none (grade 2, D5)', () => {
    const root = document.createElement('div');
    root.innerHTML = renderBlocks([{ id: 'a', list: 'none', runs: [{ text: '' }] }]);
    expect(root.innerHTML).toBe('<div class="blk" data-list="none"><br></div>');
    root.firstElementChild!.textContent = 'abc';
    expect(serializeBlocks(root).map(block => block.runs.map(run => run.text).join(''))).toEqual(['abc']);
  });

  it('keeps no line break the browser only uses to hold a line open, and keeps one the person typed (grade 3, D6)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="blk" data-list="none"><b><br></b></div>';
    expect(serializeBlocks(root)[0].runs).toEqual([{ text: '' }]);
    const typed = [{ id: 'a', list: 'none' as const, runs: [{ text: 'a' }, { text: '\n' }] }];
    root.innerHTML = renderBlocks(typed);
    expect(serializeBlocks(root)[0].runs.map(run => run.text)).toEqual(['a', '\n']);
  });
});
