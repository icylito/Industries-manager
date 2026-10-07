import { safeBack } from './login';

// E1: the back link only ever points at a page of this app
describe('safeBack', () => {
  it('follows a page of this app', () => {
    expect(safeBack('/history')).toBe('/history');
    expect(safeBack('/requests?x=1')).toBe('/requests?x=1');
  });

  it('sends anything that could leave the site to the table', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '/%0d%0a', '/a\r\nb', '/a:b', 'history', '', null]) {
      expect(safeBack(bad)).toBe('/');
    }
  });
});
