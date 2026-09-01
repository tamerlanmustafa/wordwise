import { quizReturnScreen } from '../quizReturn';

describe('quizReturnScreen', () => {
  it('returns a preview-hub quiz to the hub', () => {
    expect(
      quizReturnScreen({ origin: 'reel-preview', hasPreviewTile: true, hasSelectedMovie: false }),
    ).toBe('moviePreview');
  });

  it('returns a movie-detail quiz to the movie', () => {
    expect(
      quizReturnScreen({ origin: 'movie-detail', hasPreviewTile: false, hasSelectedMovie: true }),
    ).toBe('movieDetail');
  });

  it('prefers the origin when both contexts are alive', () => {
    // Studying a film from the hub leaves both a preview tile and a selected
    // movie behind, so the origin is the only thing that can tell them apart.
    expect(
      quizReturnScreen({ origin: 'reel-preview', hasPreviewTile: true, hasSelectedMovie: true }),
    ).toBe('moviePreview');
    expect(
      quizReturnScreen({ origin: 'movie-detail', hasPreviewTile: true, hasSelectedMovie: true }),
    ).toBe('movieDetail');
  });

  it('never sends the user to a screen that has lost its state', () => {
    // The bug this guards: aiming at a screen whose render condition is false
    // paints nothing but the tab bar.
    expect(
      quizReturnScreen({ origin: 'movie-detail', hasPreviewTile: true, hasSelectedMovie: false }),
    ).toBe('moviePreview');
    expect(
      quizReturnScreen({ origin: 'reel-preview', hasPreviewTile: false, hasSelectedMovie: true }),
    ).toBe('movieDetail');
  });

  it('falls back to Home when nothing survived', () => {
    expect(
      quizReturnScreen({ origin: null, hasPreviewTile: false, hasSelectedMovie: false }),
    ).toBe('home');
    expect(
      quizReturnScreen({ origin: 'reel-preview', hasPreviewTile: false, hasSelectedMovie: false }),
    ).toBe('home');
  });
});
