import { age } from './age';

// "How old is this" in words, for the saved copies list on History
describe('age', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const ago = (iso: string) => age(iso, now);

  it('reads in hours under a day', () => {
    expect(ago('2026-10-08T11:00:00Z')).toBe('1 hour');
    expect(ago('2026-10-08T03:00:00Z')).toBe('9 hours');
    expect(ago('2026-10-07T13:00:00Z')).toBe('23 hours');
  });

  it('reads in days and hours from a day on', () => {
    expect(ago('2026-10-07T12:00:00Z')).toBe('1 day');
    expect(ago('2026-10-07T08:00:00Z')).toBe('1 day 4 hours');
    expect(ago('2026-10-06T12:00:00Z')).toBe('2 days');
    expect(ago('2026-10-06T09:00:00Z')).toBe('2 days 3 hours');
    expect(ago('2026-10-06T11:00:00Z')).toBe('2 days 1 hour');
  });

  it('says less than an hour rather than counting minutes', () => {
    expect(ago('2026-10-08T11:59:00Z')).toBe('less than an hour');
    expect(ago('2026-10-08T12:00:00Z')).toBe('less than an hour');
  });

  it('never reads as a negative when a clock is ahead of ours', () => {
    expect(ago('2026-10-08T13:00:00Z')).toBe('less than an hour');
  });

  it('says nothing at all for a date it cannot read', () => {
    expect(ago('')).toBe('');
    expect(ago('not a date')).toBe('');
  });
});
