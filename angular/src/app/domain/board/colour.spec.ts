import {
  brightness,
  cssToHex,
  fold,
  hexToRgb,
  hsvToRgb,
  isDark,
  isHex,
  parseHex,
  rgbToHex,
  rgbToHsv,
} from './colour';

describe('colour', () => {
  it('reads hex the way people type it', () => {
    expect(parseHex('#5823CD')).toBe('#5823cd');
    expect(parseHex('5823cd')).toBe('#5823cd');
    expect(parseHex('#abc')).toBe('#aabbcc');
    expect(parseHex('  #FFF ')).toBe('#ffffff');
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('red')).toBeNull();
  });

  it('only accepts #rrggbb as a stored colour', () => {
    expect(isHex('#5823cd')).toBe(true);
    expect(isHex('#abc')).toBe(false);
    expect(isHex(null)).toBe(false);
  });

  it('goes between hex and rgb without drifting', () => {
    expect(hexToRgb('#5823cd')).toEqual({ r: 88, g: 35, b: 205 });
    expect(rgbToHex({ r: 88, g: 35, b: 205 })).toBe('#5823cd');
    expect(rgbToHex({ r: 300, g: -4, b: NaN })).toBe('#ff0000');
  });

  it('goes between rgb and hsv, and back to the same colour', () => {
    for (const hex of [
      '#5823cd',
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#808080',
      '#000000',
      '#ffffff',
      '#f4d35e',
    ]) {
      expect(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex))))).toBe(hex);
    }
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
  });

  it('tells a dark paper from a light one', () => {
    expect(isDark('#111111')).toBe(true);
    expect(isDark('#fff3bf')).toBe(false);
    expect(brightness('#ffffff')).toBeCloseTo(1);
  });

  it('makes the folded corner darker on a light paper and lighter on a dark one', () => {
    expect(brightness(fold('#ffffff'))).toBeLessThan(1);
    expect(brightness(fold('#111111'))).toBeGreaterThan(brightness('#111111'));
  });

  it('reads a computed css colour', () => {
    expect(cssToHex('rgb(88, 35, 205)')).toBe('#5823cd');
    expect(cssToHex('rgba(0, 0, 0, 0.5)')).toBe('#000000');
    expect(cssToHex('transparent')).toBeNull();
  });
});
