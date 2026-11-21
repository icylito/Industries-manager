import { Industry } from '../../../domain/models/industry';
import {
  Row,
  Selection,
  bandEdges,
  bandOf,
  browseParams,
  buildDims,
  buildPeriods,
  derive,
  emptySelection,
  periodOf,
  rankRows,
  thousands,
  tonesFor,
  toRow,
} from './overview-data';

const item = (id: number, over: Partial<Industry> = {}): Industry => ({
  id,
  name: 'Row ' + id,
  sector: 'Public Sector',
  price: 1,
  release: '2012-06-01',
  duplicateOf: null,
  importedFrom: null,
  lostFields: null,
  extra: null,
  ...over,
});

const sel = (over: Partial<Selection> = {}): Selection => ({ ...emptySelection, ...over });

// Runs the whole pipeline the way the page does
function run(items: Industry[], over: Partial<Selection> = {}) {
  const rows = items.map(toRow);
  const dims = buildDims(rows, null);
  const periods = buildPeriods(rows.map((r) => r.year).filter((y): y is number => y !== null));
  return { rows, dims, periods, d: derive(rows, dims, periods, sel(over), 10) };
}

describe('price bands', () => {
  it('puts a price of exactly 2.5 in the band 2.5 to 5, and 10 in the last band', () => {
    const edges = bandEdges(null);
    expect(edges).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(bandOf(0, edges)).toBe(0);
    expect(bandOf(2.4999, edges)).toBe(0);
    expect(bandOf(2.5, edges)).toBe(1);
    expect(bandOf(7.5, edges)).toBe(3);
    expect(bandOf(10, edges)).toBe(3);
    // Nothing falls outside the four bands, even a price the rules would refuse today
    expect(bandOf(11, edges)).toBe(3);
    expect(bandOf(-1, edges)).toBe(0);
  });

  it('follows the price rule instead of a fixed 0 to 10', () => {
    expect(
      bandEdges({
        key: 'price',
        label: 'Price',
        type: 'number',
        required: false,
        maxLength: null,
        min: 0,
        max: 20,
        custom: false,
        hidden: false,
      }),
    ).toEqual([0, 5, 10, 15, 20]);
  });

  it('asks Browse for 2.4999 as the top of a band, so no price with 4 decimals is missed', () => {
    const { dims } = run([item(1)]);
    const band = dims.find((d) => d.id === 'band')!;
    expect(band.browse('0 to 2.5')).toEqual({ maxPrice: 2.4999 });
    expect(band.browse('2.5 to 5')).toEqual({ minPrice: 2.5, maxPrice: 4.9999 });
    expect(band.browse('7.5 to 10')).toEqual({ minPrice: 7.5 });
  });
});

describe('release periods', () => {
  it('uses whole 5 year periods from 1995, the last one ends at the newest year', () => {
    const periods = buildPeriods([1995, 2026]);
    expect(periods.map((p) => p.label)).toEqual([
      '1995 to 1999',
      '2000 to 2004',
      '2005 to 2009',
      '2010 to 2014',
      '2015 to 2019',
      '2020 to 2024',
      '2025 to 2026',
    ]);
    expect(periodOf(1999, periods)).toBe(0);
    expect(periodOf(2000, periods)).toBe(1);
    expect(periodOf(2026, periods)).toBe(6);
    expect(periodOf(null, periods)).toBe(-1);
    expect(periodOf(1990, periods)).toBe(-1);
  });

  it('does not make hundreds of bars for a date typed wrong', () => {
    expect(buildPeriods([1, 9999, 2010]).length).toBe(7);
  });
});

describe('selection and the Open in Browse filters', () => {
  const items = [
    item(1, { sector: 'Private Sector', price: 2.5, release: '2014-12-31' }),
    item(2, { sector: 'Private Sector', price: 2.4999, release: '2015-01-01' }),
    item(3, { sector: 'Public Sector', price: null, release: null }),
    item(4, { sector: 'Public Sector', price: 9, release: '2021-03-03', duplicateOf: 1 }),
    item(5, { sector: 'Private Sector', price: 4, release: '2010-01-01', lostFields: ['price'] }),
  ];

  it('counts a slice from the rows, and leaves rows with no value for the split out of the circle', () => {
    const { d } = run(items, { dim: 'band' });
    expect(d.slices.map((s) => [s.key, s.count])).toEqual([
      ['0 to 2.5', 1],
      ['2.5 to 5', 2],
      ['5 to 7.5', 0],
      ['7.5 to 10', 1],
    ]);
    expect(d.total).toBe(4);
    expect(d.insight2).toContain('1 industry has no price band');
  });

  it('combines several attention chips as OR, and with everything else as AND', () => {
    const { d } = run(items, { attns: ['dup', 'lost'] });
    expect(d.selected.map((r) => r.id)).toEqual([4, 5]);
    const priv = run(items, { pick: 'Private Sector', attns: ['dup', 'lost'] });
    expect(priv.d.selected.map((r) => r.id)).toEqual([5]);
    const none = run(items, { attns: ['nop', 'nod'] });
    expect(none.d.selected.map((r) => r.id)).toEqual([3]);
  });

  it('sends Browse exactly the filters of the selection', () => {
    const q = (over: Partial<Selection>) => run(items, over).d.browse;
    expect(q({ pick: 'Private Sector' })).toEqual({ sector: 'Private Sector' });
    expect(q({ dim: 'band', pick: '0 to 2.5' })).toEqual({ maxPrice: 2.4999 });
    expect(q({ dim: 'era', pick: '2010s' })).toEqual({
      releaseFrom: '2010-01-01',
      releaseTo: '2019-12-31',
    });
    expect(q({ bar: 3 })).toEqual({ releaseFrom: '2010-01-01', releaseTo: '2014-12-31' });
    expect(q({ attns: ['dup', 'lost', 'nop', 'nod'] })).toEqual({
      flags: ['duplicate', 'lost', 'noprice', 'nodate'],
    });
    // An era and a period are both date ranges, the rows have to be inside both
    expect(q({ dim: 'era', pick: '2010s', bar: 4 })).toEqual({
      releaseFrom: '2015-01-01',
      releaseTo: '2019-12-31',
    });
  });

  it('turns the filters into the address Browse reads', () => {
    expect(
      browseParams({
        sector: 'Public Sector',
        minPrice: 2.5,
        maxPrice: 4.9999,
        releaseFrom: '2010-01-01',
        releaseTo: '2014-12-31',
        flags: ['duplicate', 'lost'],
      }),
    ).toEqual({
      sector: 'Public Sector',
      minPrice: '2.5',
      maxPrice: '4.9999',
      releaseFrom: '2010-01-01',
      releaseTo: '2014-12-31',
      flags: 'duplicate,lost',
    });
    expect(browseParams({})).toEqual({});
  });

  it('hides the link rather than show a count Browse cannot match', () => {
    // Compare mode has two groups, Browse has one list
    expect(
      run(items, { cmp: true, cmpKeys: ['Private Sector', 'Public Sector'] }).d.browse,
    ).toBeNull();
    // A custom field is not a Browse filter
    const rows = items.map(toRow);
    const dims = buildDims(rows, [
      {
        key: 'region',
        label: 'Region',
        type: 'text',
        required: false,
        maxLength: null,
        min: null,
        max: null,
        custom: true,
        hidden: false,
        options: ['Muscat', 'Dhofar'],
      },
    ]);
    const region = dims.find((x) => x.id === 'extra:region')!;
    expect(region.custom).toBe(true);
    expect(region.browse('Muscat')).toBeNull();
    expect(
      derive(rows, dims, buildPeriods([2010]), sel({ dim: 'extra:region', pick: 'Muscat' }), 10)
        .browse,
    ).toBeNull();
  });

  it('says when the filters match nothing together', () => {
    const { d } = run(items, { pick: 'Public Sector', attns: ['lost'] });
    expect(d.selected).toHaveLength(0);
    expect(d.noMatch).toBe(true);
  });

  it('groups the tail into Other when a split has more than 4 options', () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map((s, i) => toRow(item(i + 1, { sector: s })));
    const sector = buildDims(rows, null)[0];
    expect(sector.keys).toEqual(['A', 'B', 'C', 'Other']);
    expect(sector.of(rows[4])).toBe('Other');
    expect(sector.browse('Other')).toBeNull();
    expect(sector.browse('A')).toEqual({ sector: 'A' });
  });

  it('keeps the sector rule order, then other sectors found in the table', () => {
    const rows = [
      item(1, { sector: 'Mining' }),
      item(2, { sector: 'Public Sector' }),
      item(3, { sector: 'Mining' }),
    ].map(toRow);
    const dims = buildDims(rows, [
      {
        key: 'sector',
        label: 'Sector',
        type: 'text',
        required: true,
        maxLength: 25,
        min: null,
        max: null,
        custom: false,
        hidden: false,
        options: ['Public Sector', 'Private Sector'],
      },
    ]);
    expect(dims[0].keys).toEqual(['Public Sector', 'Private Sector', 'Mining']);
  });
});

describe('bars', () => {
  it('stacks every bar from the circle slices and keeps the total', () => {
    const { d } = run([
      item(1, { release: '1996-01-01' }),
      item(2, { sector: 'Private Sector', release: '1997-01-01' }),
      item(3, { sector: null, release: '1998-01-01' }),
    ]);
    expect(d.stacked).toBe(true);
    const first = d.bars[0];
    expect(first.all).toBe(3);
    expect(first.perSlice).toEqual([1, 1]);
    // The industry with no sector is the light piece that makes the bar add up
    expect(first.missH).toBeGreaterThan(0);
  });

  it('cannot stack an average, and shows the picked slice against the total', () => {
    expect(run([item(1)], { metric: 'avg' }).d.stacked).toBe(false);
    const picked = run([item(1), item(2, { sector: 'Private Sector' })], {
      pick: 'Private Sector',
    });
    expect(picked.d.stacked).toBe(false);
    const bar = picked.d.bars[picked.periods.findIndex((p) => p.from === 2010)];
    expect([bar.all, bar.shown]).toEqual([2, 1]);
  });
});

describe('top list and find', () => {
  it('ranks by price, cheapest first when asked, and skips rows with no price', () => {
    const items = [
      item(1, { price: 3 }),
      item(2, { price: 9 }),
      item(3, { price: null }),
      item(4, { price: 1 }),
      item(5, { price: 5 }),
    ];
    expect(run(items).d.cols[0].rows.map((r) => r.id)).toEqual([2, 5, 1]);
    expect(run(items).d.cols[0].note).toBe('1 without a price skipped');
    expect(run(items, { topMode: 'low3' }).d.cols[0].rows.map((r) => r.id)).toEqual([4, 1, 5]);
    const { rank, ranked } = rankRows(items.map(toRow));
    expect(ranked).toBe(4);
    expect(rank.get(2)).toBe(1);
    expect(rank.has(3)).toBe(false);
  });
});

describe('numbers and shades people read', () => {
  it('puts a comma in every big count', () => {
    expect(thousands(30001)).toBe('30,001');
    expect(thousands(999)).toBe('999');
    expect(thousands(1234567)).toBe('1,234,567');
  });

  it('keeps even the faintest slice at 3:1 or better on the card, light and dark', () => {
    // Ink drawn at an opacity over the card, the way the circle and bars draw it. 3:1 is the bar for chart marks.
    const lum = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const contrast = (a: number, b: number) =>
      (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const over = (ink: number, card: number, alpha: number) => card + (ink - card) * alpha;
    for (const n of [2, 3, 4]) {
      const faintest = Math.min(...tonesFor(n));
      expect(contrast(over(10, 255, faintest), 255)).toBeGreaterThanOrEqual(3); // light: #0a0a0a on white
      expect(contrast(over(226, 28, faintest), 28)).toBeGreaterThanOrEqual(3); // dark: #e2e2e2 on #1c1c1c
    }
  });

  it('says it plainly when the biggest slice is the grouped smaller ones, and when one industry is left out', () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
      .flatMap((s, i) =>
        Array.from({ length: i < 3 ? 1 : 3 }, (_, k) => item(i * 10 + k + 1, { sector: s })),
      )
      .concat([item(99, { sector: null })]);
    const { d } = run(rows);
    expect(d.insight1).toBe(
      'The smaller sector groups together are the biggest slice, 40% of the industries with a sector.',
    );
    expect(d.insight2).toBe('1 industry has no sector and is left out.');
  });

  it('writes a tiny slice as under 1%, never 0%', () => {
    const rows = [
      ...Array.from({ length: 300 }, (_, i) => item(i + 1, { sector: 'Public Sector' })),
      item(999, { sector: 'Private Sector' }),
    ];
    const { d } = run(rows);
    expect(d.slices.map((s) => s.pct)).toEqual(['100%', '<1%']);
  });
});
