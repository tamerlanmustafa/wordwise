/**
 * RankedFeedRow — the desktop expression of the mobile RankedMovieList card.
 *
 * A single-column, full-width ranked row used by the web Home feed:
 *   • 132px tall, backdrop + left→right dark gradient scrim
 *   • serif rank numeral (1, 2, 3 …) on the far left
 *   • poster 74×104, title 19/700 white
 *   • `★ rating • CEFR level%` subtext, mono `N words`
 *   • the same "+ Add to list / Added" affordance as mobile, wired to the
 *     shared `reelStore` (stroked plus icon → stroked star when added)
 *
 * Keeps the exact fields + Add affordance of the mobile card; only the
 * dimensions and the rank numeral differ. Fields that the current web feed
 * (TMDB top-rated) doesn't carry — CEFR level %, word count — are simply
 * omitted via `filter(Boolean)`, exactly like the mobile card, so the row
 * lights them up automatically if a CEFR feed is wired in later.
 */

import { MONO, SERIF, useThemeColors, type ThemeTokens } from '../theme/tokens';
import { useReelStore } from '../stores/reelStore';

const BACKDROP = (p: string | null | undefined): string | null =>
  p ? `https://image.tmdb.org/t/p/w780${p}` : null;
const POSTER = (p: string | null | undefined): string | null =>
  p ? `https://image.tmdb.org/t/p/w185${p}` : null;

function scoreToCefr(score: number | null | undefined): string | null {
  if (score == null) return null;
  if (score < 30) return 'A1';
  if (score < 45) return 'A2';
  if (score < 60) return 'B1';
  if (score < 75) return 'B2';
  if (score < 90) return 'C1';
  return 'C2';
}

export interface RankedFeedMovie {
  id: number;
  tmdb_id?: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  vote_average?: number;
  difficulty_score?: number | null;
  unique_words?: number;
}

interface Props {
  movie: RankedFeedMovie;
  rank: number;
  onOpen: () => void;
}

export function RankedFeedRow({ movie, rank, onOpen }: Props) {
  const t = useThemeColors();
  const s = makeRowStyle(t);

  const tmdbId = movie.tmdb_id ?? (typeof movie.id === 'number' ? movie.id : undefined);
  const added = useReelStore((st) => (tmdbId != null ? st.has(tmdbId) : false));
  const add = useReelStore((st) => st.add);
  const remove = useReelStore((st) => st.remove);

  const rating =
    movie.vote_average && movie.vote_average > 0
      ? `★ ${Number(movie.vote_average).toFixed(1)}`
      : null;
  const cefr = scoreToCefr(movie.difficulty_score);
  const level =
    cefr && movie.difficulty_score != null ? `${cefr} ${movie.difficulty_score}%` : null;
  const wordCount =
    movie.unique_words && movie.unique_words > 0 ? `${movie.unique_words} words` : null;
  const subtext = [rating, level].filter(Boolean).join('   •   ');

  const onAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (tmdbId == null) return;
    if (added) {
      await remove(tmdbId);
    } else {
      await add({
        tmdb_id: tmdbId,
        title: movie.title,
        poster_path: movie.poster_path,
        year: movie.release_date ? parseInt(movie.release_date.slice(0, 4), 10) : null,
      });
    }
  };

  return (
    <button type="button" onClick={onOpen} style={s.row}>
      <div style={s.scrim} />
      <div style={s.content}>
        <div style={s.rank}>{rank}</div>
        {POSTER(movie.poster_path) ? (
          <img src={POSTER(movie.poster_path)!} alt="" style={s.poster} />
        ) : (
          <div style={{ ...s.poster, ...s.posterFallback }} />
        )}
        <div style={s.info}>
          <div style={s.title}>{movie.title}</div>
          {subtext ? <div style={s.sub}>{subtext}</div> : null}
          {wordCount ? <div style={s.words}>{wordCount}</div> : null}
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={onAdd}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onAdd(e as unknown as React.MouseEvent);
            }
          }}
          style={{
            ...s.addChip,
            background: added ? 'rgba(255,209,102,0.95)' : 'rgba(0,0,0,0.5)',
            borderColor: added ? 'rgba(255,209,102,1)' : 'rgba(255,255,255,0.28)',
            color: added ? '#3a2400' : '#fff',
          }}
        >
          <AddIcon added={added} />
          {added ? 'Added' : 'Add to list'}
        </div>
      </div>
    </button>
  );
}

function AddIcon({ added }: { added: boolean }) {
  if (added) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="#3a2400">
        <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.3L12 17.3 6.4 20.3l1.1-6.3L3 9.6l6.2-.9z" />
      </svg>
    );
  }
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="3"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

const buttonReset: React.CSSProperties = {
  border: 'none',
  font: 'inherit',
  background: 'none',
  appearance: 'none',
  padding: 0,
  margin: 0,
  textAlign: 'left',
};

function makeRowStyle(t: ThemeTokens): Record<string, React.CSSProperties> {
  return {
    row: {
      ...buttonReset,
      position: 'relative',
      height: 132,
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: t.shadowCard,
      cursor: 'pointer',
      width: '100%',
      display: 'block',
      background: '#000',
    },
    scrim: {
      position: 'absolute',
      inset: 0,
      background:
        'linear-gradient(90deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.5) 55%, rgba(0,0,0,0.42) 100%)',
    },
    content: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      height: '100%',
      padding: '0 18px',
      gap: 16,
    },
    rank: {
      fontFamily: SERIF,
      fontSize: 34,
      fontWeight: 700,
      color: 'rgba(255,255,255,0.45)',
      width: 34,
      textAlign: 'center',
      flexShrink: 0,
    },
    poster: {
      width: 74,
      height: 104,
      borderRadius: 8,
      objectFit: 'cover',
      flexShrink: 0,
      background: 'rgba(255,255,255,0.1)',
    },
    posterFallback: {},
    info: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontSize: 19,
      fontWeight: 700,
      color: '#fff',
      lineHeight: 1.2,
      marginBottom: 6,
      letterSpacing: -0.2,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    sub: {
      fontSize: 13,
      color: 'rgba(255,255,255,0.88)',
      fontWeight: 600,
      marginBottom: 3,
    },
    words: {
      fontSize: 12,
      color: 'rgba(255,255,255,0.66)',
      fontFamily: MONO,
      fontWeight: 700,
    },
    addChip: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '8px 14px',
      borderRadius: 999,
      border: '1px solid',
      flexShrink: 0,
      fontSize: 12,
      fontWeight: 800,
      letterSpacing: 0.3,
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    },
  };
}

/** Expose the backdrop helper for the page to preload if desired. */
export { BACKDROP as rankedRowBackdrop };
