import {
  tmdbApi,
  SrsPaywallError,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
} from '../api';

describe('tmdbApi.getPosterUrl', () => {
  it('returns null for a null poster path', () => {
    expect(tmdbApi.getPosterUrl(null)).toBeNull();
  });

  it('builds a w300 URL by default', () => {
    expect(tmdbApi.getPosterUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w300/abc.jpg');
  });

  it('honours an explicit size', () => {
    expect(tmdbApi.getPosterUrl('/abc.jpg', 'w500')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
  });
});

// enrichMoviesWithTmdb and the rest of the TMDB client moved behind our own
// proxy in issue #125 — they're covered in tmdbProxy.test.ts.

describe('SrsPaywallError', () => {
  it('defaults to the preview-exhausted kind', () => {
    const err = new SrsPaywallError('no previews left', 3, 3);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SrsPaywallError');
    expect(err.kind).toBe('preview_exhausted');
    expect(err.previews_used).toBe(3);
    expect(err.previews_limit).toBe(3);
  });

  it('carries the daily-cap kind when specified', () => {
    const err = new SrsPaywallError('come back tomorrow', 1, 1, 'daily_cap_reached');
    expect(err.kind).toBe('daily_cap_reached');
  });
});

describe('label / threshold maps', () => {
  it('has a label for every report reason', () => {
    (['WRONG_TRANSLATION', 'WRONG_CONTEXT', 'WRONG_SPELLING', 'INAPPROPRIATE_CONTENT', 'OTHER'] as const).forEach(
      (r) => expect(REPORT_REASON_LABELS[r]).toBeTruthy(),
    );
  });

  it('has a label for every report status', () => {
    (['PENDING', 'REVIEWED', 'RESOLVED', 'DISMISSED'] as const).forEach((s) =>
      expect(REPORT_STATUS_LABELS[s]).toBeTruthy(),
    );
  });
});
