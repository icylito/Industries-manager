import { describe, expect, it } from 'vitest';
import { dominantColors } from './profile-picture';

const pixels = (...colors: [number, number, number, number][]) =>
  new Uint8ClampedArray(colors.flatMap((c) => c));
const many = (n: number, c: [number, number, number, number]) => Array.from({ length: n }, () => c);

describe('the colours of a profile picture', () => {
  it('takes the most common colour first and a clearly different one second', () => {
    const [first, second] = dominantColors(
      pixels(...many(60, [200, 40, 60, 255]), ...many(30, [20, 60, 160, 255])),
    )!;
    expect(first).toBe('rgb(200 40 60)');
    expect(second).toBe('rgb(20 60 160)');
  });

  it("doesn't let a large white backdrop win over a colourful subject", () => {
    const [first] = dominantColors(
      pixels(...many(50, [250, 250, 250, 255]), ...many(25, [220, 120, 20, 255])),
    )!;
    expect(first).toBe('rgb(220 120 20)');
  });

  it('gives a picture of one colour a darker shade of it, and nothing for a clear picture', () => {
    expect(dominantColors(pixels(...many(10, [100, 150, 200, 255])))).toEqual([
      'rgb(100 150 200)',
      'rgb(60 90 120)',
    ]);
    expect(dominantColors(pixels(...many(10, [100, 150, 200, 0])))).toBeNull();
  });
});
