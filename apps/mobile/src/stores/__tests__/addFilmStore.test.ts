import { useAddFilmStore, requestAddFilm, type AddFilmInput } from '../addFilmStore';

const film: AddFilmInput = { tmdb_id: 1, title: 'Parasite', poster_path: '/p.jpg', year: 2019 };

describe('addFilmStore', () => {
  beforeEach(() => {
    useAddFilmStore.setState({ pending: null });
  });

  it('starts with no pending request', () => {
    expect(useAddFilmStore.getState().pending).toBeNull();
  });

  it('request() sets the pending film', () => {
    requestAddFilm(film);
    expect(useAddFilmStore.getState().pending).toEqual(film);
  });

  it('clear() drops the request once the overlay takes ownership', () => {
    requestAddFilm(film);
    useAddFilmStore.getState().clear();
    expect(useAddFilmStore.getState().pending).toBeNull();
  });

  it('a later request replaces an earlier one', () => {
    requestAddFilm(film);
    const other: AddFilmInput = { tmdb_id: 2, title: 'Roma', poster_path: null, year: 2018 };
    requestAddFilm(other);
    expect(useAddFilmStore.getState().pending).toEqual(other);
  });
});
