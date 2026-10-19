import { parseMarks, renderInto, serialize } from './format';

describe('ticket text marks', () => {
  function roundTrip(text: string) {
    const box = document.createElement('div');
    renderInto(box, text);
    return { box, back: serialize(box) };
  }

  it('shows marks as the real effect and hands the same text back', () => {
    const { box, back } = roundTrip('use **big** and _slanted_ and `x`\nnext line');
    expect(box.querySelector('b')?.textContent).toBe('big');
    expect(box.querySelector('i')?.textContent).toBe('slanted');
    expect(box.querySelector('code')?.textContent).toBe('x');
    expect(box.textContent).not.toContain('**');
    expect(back).toBe('use **big** and _slanted_ and `x`\nnext line');
  });

  it('turns what the browser makes of typing into marks, spaces outside them', () => {
    const box = document.createElement('div');
    box.innerHTML =
      'make <strong>it fast </strong>now<div>second</div><div><br></div><div><em>last</em></div>';
    expect(serialize(box)).toBe('make **it fast** now\nsecond\n_last_');
  });

  it('keeps bold and italic together and leaves markup and snake_case alone', () => {
    const both = roundTrip('**_both_**');
    expect(both.box.querySelector('b i, i b')?.textContent).toBe('both');
    expect(roundTrip(both.back).back).toBe(both.back);
    const pieces = parseMarks('use **big** `x` and some_field_name <b>');
    expect(pieces.map((p) => [p.text, p.bold, p.code])).toEqual([
      ['use ', false, false],
      ['big', true, false],
      [' ', false, false],
      ['x', false, true],
      [' and some_field_name <b>', false, false],
    ]);
  });
});
