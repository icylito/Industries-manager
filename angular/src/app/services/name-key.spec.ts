import { describe, expect, it } from 'vitest';
import { nameKey } from './name-key';

describe('the one name rule', () => {
  it('treats names that differ only in case, accents, spaces, punctuation or symbols as one', () => {
    expect(nameKey('Acme, Inc.')).toBe('acmeinc');
    expect(nameKey('ACME inc')).toBe('acmeinc');
    expect(nameKey('acme-inc')).toBe('acmeinc');
    expect(nameKey('Ácmé Inc')).toBe('acmeinc');
    expect(nameKey('ali.k')).toBe(nameKey('ali_k'));
  });

  it('keeps letters and digits of any script, and leaves nothing of a name of symbols', () => {
    expect(nameKey('شركة النفط 2')).toBe('شركةالنفط2');
    expect(nameKey('Acme 1')).not.toBe(nameKey('Acme 2'));
    expect(nameKey('!!! ---')).toBe('');
  });
});
