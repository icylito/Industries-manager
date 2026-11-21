import { describe, expect, it } from 'vitest';
import { hasNoLetters, sameName } from './name-key';

// The same examples as testing/check_names.py, where the database and the API are held to them too
export const NAME_PAIRS: [string, string, boolean][] = [
  ['Acme, Inc.', 'acme-inc', true],
  ['Ácmé Inc', 'ACME inc', true],
  ['ali.k', 'ali_k', true],
  ['काम', 'कम', false],
  ['ΟΔΟΣ', 'οδος', true],
  ['İzmir', 'izmir', true],
  ['Acme 1', 'Acme 2', false],
  ['Sales 2', 'sales. (2)', true],
  ['شركة', 'شَرِكة', true],
  ['Ｆｕｌｌ', 'full', true],
  ['a+b', 'ab', true],
  ['$Cash', 'cash', true],
  ['𠀀𠀁', '𠀀𠀂', false],
  ['Café', 'Cafe', true],
  ['straße', 'strasse', true],
  ['Zero​Width', 'zerowidth', true],
];

describe('the one name rule', () => {
  for (const [a, b, same] of NAME_PAIRS) {
    it(`${a} and ${b} are ${same ? 'one name' : 'two names'}`, () =>
      expect(sameName(a, b)).toBe(same));
  }

  it('finds no name in a name of only symbols, and one in a rare script', () => {
    expect(hasNoLetters('!!! ---')).toBe(true);
    expect(hasNoLetters('$')).toBe(true);
    expect(hasNoLetters('𠀀𠀁')).toBe(false);
    expect(hasNoLetters('شركة')).toBe(false);
  });
});
