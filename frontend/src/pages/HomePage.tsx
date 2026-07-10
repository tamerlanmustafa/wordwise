/**
 * HomePage — the redesigned web Home (the ranked film feed).
 *
 * Desktop counterpart to the mobile ranked-feed home, re-skinned into the
 * cinema / contact-sheet system (home/home-web.jsx). Renders inside the
 * shared AppShell (always-dark sidebar + top bar), so this page only owns
 * the content column:
 *   • PageHeader — eyebrow `YOUR FEED · {level} LEVEL`, subtitle,
 *     right-aligned gold level pill (no serif title).
 *   • Feed column — toolbar (`{n} FILMS AT YOUR LEVEL` + SORT chips) over a
 *     single-column list of RankedFeedRow cards (same fields + Add affordance
 *     as the mobile card; rank numerals differ).
 *   • Right rail (340px) — Today's Word card.
 *
 * Data source is the existing web feed query (TMDB top-rated) — unchanged.
 * Today's Word comes from srsApi (same endpoint the mobile app uses). The
 * "+ Add to list" chips read/write the shared reelStore.
 *
 * NOTE: the mockup's right rail also shows a "Continue watching" card, but
 * the app has no watch-progress data yet, so it's intentionally omitted
 * here (same call as the mobile floating Continue pill) rather than faked.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/shell/PageHeader';
import { RankedFeedRow, type RankedFeedMovie } from '../components/RankedFeedRow';
import { SERIF, useThemeColors, type ThemeTokens } from '../theme/tokens';
import { useAuth } from '../contexts/AuthContext';
import { useReelStore } from '../stores/reelStore';
import { srsApi, type TodaysWord } from '../services/srsApi';
import apiClient from '../services/api';
import { fetchTopRatedMovies, type TMDBMovie } from '../services/tmdbService';
import { watchedApi } from '../services/watchedApi';

type SortKey = 'rating' | 'popularity' | 'level';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'rating', label: 'Rating' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'level', label: 'Level %' },
];

export default function HomePage() {
  const t = useThemeColors();
  const navigate = useNavigate();
  const { user } = useAuth();
  const level = user?.proficiency_level || 'B1';

  const [movies, setMovies] = useState<TMDBMovie[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('rating');
  const [sortAsc, setSortAsc] = useState(false);
  const [todaysWord, setTodaysWord] = useState<TodaysWord | null>(null);

  // Hydrate the reel once so the "+ Add to list" chips reflect membership.
  const reelHydrated = useReelStore((s) => s.hydrated);
  const hydrateReel = useReelStore((s) => s.hydrate);
  useEffect(() => {
    if (!reelHydrated) void hydrateReel();
  }, [reelHydrated, hydrateReel]);

  // Web feed query — TMDB top-rated. The web feed doesn't use the CEFR
  // endpoint (which filters server-side), so we exclude the user's watched /
  // "not interested" movies client-side here.
  useEffect(() => {
    (async () => {
      try {
        const [res, watched, hiddenIds] = await Promise.all([
          fetchTopRatedMovies(1),
          watchedApi.listWatched().catch(() => []),
          watchedApi.listHiddenIds().catch(() => []),
        ]);
        const excluded = new Set<number>([
          ...watched.map((w) => w.tmdb_id),
          ...hiddenIds,
        ]);
        setMovies(res.results.filter((m) => !excluded.has(m.id)).slice(0, 20));
      } catch (err) {
        console.error('Failed to load homepage feed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // "Seen it" → Watched list; "Not interested" → hidden. Both drop the row
  // from the feed immediately and persist server-side (mirrors the mobile
  // swipe). Web has no toast/undo yet, so these are deliberate hover clicks.
  const handleWatched = async (m: RankedFeedMovie) => {
    const tmdbId = m.tmdb_id ?? m.id;
    setMovies((prev) => prev.filter((x) => x.id !== tmdbId));
    try {
      await watchedApi.markWatched({
        tmdb_id: tmdbId,
        title: m.title,
        poster_path: m.poster_path,
        year: m.release_date ? parseInt(m.release_date.slice(0, 4), 10) : null,
      });
    } catch {
      /* best-effort; the row is already gone locally */
    }
  };

  const handleNotInterested = async (m: RankedFeedMovie) => {
    const tmdbId = m.tmdb_id ?? m.id;
    setMovies((prev) => prev.filter((x) => x.id !== tmdbId));
    try {
      await watchedApi.hide(tmdbId);
    } catch {
      /* best-effort */
    }
  };

  // Word of the hour — same endpoint the mobile Home uses.
  useEffect(() => {
    srsApi.todaysWord(0).then(setTodaysWord).catch(() => {});
  }, []);

  const sorted = useMemo(() => {
    const arr = [...movies];
    if (sort === 'rating') {
      arr.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
    }
    // 'popularity' and 'level' have no client-side signal in the TMDB
    // top-rated feed (no popularity/difficulty fields), so they keep the
    // feed's own order. They light up automatically if a CEFR feed with
    // those fields is wired in later.
    if (sortAsc) arr.reverse();
    return arr;
  }, [movies, sort, sortAsc]);

  const onSortPress = (key: SortKey) => {
    if (key === sort) setSortAsc((v) => !v);
    else {
      setSort(key);
      setSortAsc(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <PageHeader
        eyebrow={`Your feed · ${level} level`}
        subtitle="Top-rated films matched to your level. Add any to your list to start learning its words."
        right={<LevelPill level={level} t={t} />}
      />

      <div style={{ flex: 1, padding: '0 32px 32px', display: 'flex', gap: 28 }}>
        {/* Feed column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 16,
              paddingBottom: 12,
              borderBottom: `1px solid ${t.divider}`,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 1.4,
                color: t.text3,
                textTransform: 'uppercase',
              }}
            >
              {movies.length} films at your level
            </div>
            <div style={{ flex: 1 }} />
            <span
              style={{
                fontSize: 11,
                color: t.text3,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              Sort
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {SORTS.map((sopt) => {
                const on = sopt.key === sort;
                return (
                  <button
                    key={sopt.key}
                    type="button"
                    onClick={() => onSortPress(sopt.key)}
                    style={{
                      ...buttonReset,
                      padding: '6px 13px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: 'pointer',
                      background: on ? t.gold : t.chipBg,
                      color: on ? t.goldDeep : t.text2,
                      border: on ? 'none' : `1px solid ${t.border}`,
                    }}
                  >
                    {sopt.label}
                    {on ? (sortAsc ? ' ↑' : ' ↓') : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 132,
                    borderRadius: 16,
                    background: t.paper,
                    border: `1px solid ${t.border}`,
                  }}
                />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sorted.map((m, i) => (
                <RankedFeedRow
                  key={m.id}
                  movie={m as RankedFeedMovie}
                  rank={i + 1}
                  onOpen={() => navigate(`/movie/${m.id}`)}
                  onWatched={handleWatched}
                  onNotInterested={handleNotInterested}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right rail */}
        <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <TodayWordCard t={t} word={todaysWord} />
        </div>
      </div>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

function LevelPill({ level, t }: { level: string; t: ThemeTokens }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        borderRadius: 999,
        background: t.gold,
        color: t.goldDeep,
        fontSize: 13,
        fontWeight: 900,
        letterSpacing: 0.3,
        cursor: 'default',
        boxShadow: '0 8px 18px rgba(255,209,102,0.28)',
      }}
    >
      <StarIcon color={t.goldDeep} />
      {level} · Your level
      <ChevronIcon color={t.goldDeep} />
    </div>
  );
}

function TodayWordCard({ t, word }: { t: ThemeTokens; word: TodaysWord | null }) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!word) {
    return (
      <div
        style={{
          background: t.paper,
          border: `1px solid ${t.border}`,
          borderRadius: 14,
          padding: 20,
          boxShadow: t.shadowCard,
          minHeight: 160,
        }}
      />
    );
  }

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaved((p) => !p);
    try {
      // Today's word is movie-independent, so this is a global save —
      // same `/user/words/save` endpoint the vocabulary lists use.
      const res = await apiClient.post<{ saved: boolean }>('/user/words/save', {
        word: word.word,
      });
      setSaved(res.data.saved);
    } catch {
      setSaved((p) => !p);
    }
    setSaving(false);
  };

  return (
    <div
      style={{
        background: t.paper,
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        padding: 20,
        boxShadow: t.shadowCard,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 900,
            color: t.goldOnSurface,
            letterSpacing: 1.8,
            textTransform: 'uppercase',
          }}
        >
          Today's word
        </span>
        {word.movie_title ? (
          <span style={{ fontSize: 11, color: t.text3, fontWeight: 600 }}>
            from {word.movie_title}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 34,
            fontWeight: 700,
            color: t.text,
            letterSpacing: -0.8,
            lineHeight: 1,
          }}
        >
          {word.word}
        </div>
        {word.cefr_level ? (
          <div style={{ fontSize: 13, fontStyle: 'italic', color: t.text3, fontWeight: 600 }}>
            {word.cefr_level}
          </div>
        ) : null}
      </div>

      {word.example_sentence ? (
        <div
          style={{
            fontSize: 14,
            color: t.text2,
            fontStyle: 'italic',
            lineHeight: 1.5,
            marginBottom: word.translated_sentence ? 6 : 16,
          }}
        >
          "{word.example_sentence}"
        </div>
      ) : null}
      {word.translated_sentence ? (
        <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.45, marginBottom: 16 }}>
          {word.translated_sentence}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSave}
        style={{
          ...buttonReset,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          padding: '11px 16px',
          borderRadius: 10,
          border: `1px solid ${saved ? t.success : t.gold}`,
          background: saved ? t.successTint : 'transparent',
          color: saved ? t.success : t.goldOnSurface,
          cursor: 'pointer',
        }}
      >
        {saved ? <CheckIcon color={t.success} /> : <BookmarkIcon color={t.goldOnSurface} />}
        <span style={{ fontSize: 14, fontWeight: 800 }}>
          {saved ? 'Saved to your words' : 'Save this word'}
        </span>
      </button>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────

function StarIcon({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={color}>
      <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.3L12 17.3 6.4 20.3l1.1-6.3L3 9.6l6.2-.9z" />
    </svg>
  );
}

function ChevronIcon({ color }: { color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function BookmarkIcon({ color }: { color: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4h12v16l-6-4-6 4z" />
    </svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l4 4 10-10" />
    </svg>
  );
}

const buttonReset: CSSProperties = {
  border: 'none',
  font: 'inherit',
  background: 'none',
  appearance: 'none',
};
