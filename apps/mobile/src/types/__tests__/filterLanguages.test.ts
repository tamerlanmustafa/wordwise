import { AVAILABLE_LANGUAGES, filterLanguages } from '../constants';

describe('filterLanguages (onboarding language search, issue #80)', () => {
  it('empty / whitespace query returns the full list', () => {
    expect(filterLanguages(AVAILABLE_LANGUAGES, '')).toHaveLength(AVAILABLE_LANGUAGES.length);
    expect(filterLanguages(AVAILABLE_LANGUAGES, '   ')).toHaveLength(AVAILABLE_LANGUAGES.length);
  });

  it('matches by English name, case-insensitively', () => {
    const hits = filterLanguages(AVAILABLE_LANGUAGES, 'spAn');
    expect(hits.map((l) => l.code)).toEqual(['ES']);
  });

  it('matches by native name', () => {
    const hits = filterLanguages(AVAILABLE_LANGUAGES, 'Españ');
    expect(hits.map((l) => l.code)).toEqual(['ES']);
  });

  it('matches by ISO code', () => {
    const hits = filterLanguages(AVAILABLE_LANGUAGES, 'ja');
    expect(hits.map((l) => l.code)).toContain('JA');
  });

  it('no match → empty list (UI shows a "no languages match" hint)', () => {
    expect(filterLanguages(AVAILABLE_LANGUAGES, 'klingon')).toHaveLength(0);
  });

  it('trims the query before matching', () => {
    expect(filterLanguages(AVAILABLE_LANGUAGES, '  french  ').map((l) => l.code)).toEqual(['FR']);
  });
});
