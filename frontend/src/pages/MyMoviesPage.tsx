/**
 * MyMoviesPage — the user's library of added films.
 *
 * Desktop layout (web/my-movies.jsx):
 *   • PageHeader with eyebrow + serif title + ADD A FILM CTA
 *   • Stat strip: 4 stats + secondary "Practice N words →" CTA
 *   • Body: left filter rail (Status / Level / Added) + 4-col poster grid
 *
 * Data: `reelStore` (mirrors mobile). Click on a poster routes to the
 * existing /movie/:tmdbId detail page. Add-a-film opens /search.
 */

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/shell/PageHeader';
import {
  CEFR,
  MONO,
  SERIF,
  TMDB,
  useThemeColors,
  type ThemeTokens,
} from '../theme/tokens';
import { useReelStore } from '../stores/reelStore';
import {
  SORT_LABELS,
  SORT_ORDER,
  useMyMoviesUiStore,
  type MyMoviesFilter,
  type MyMoviesSort,
} from '../stores/myMoviesUiStore';
import type { ReelTile } from '../services/reelApi';

const CEFR_RANK: Record<string, number> = {
  A1: 0,
  A2: 1,
  B1: 2,
  B2: 3,
  C1: 4,
  C2: 5,
};

// ── Helpers ────────────────────────────────────────────────────────────

function applyFilter(tiles: ReelTile[], filter: MyMoviesFilter): ReelTile[] {
  if (filter === 'all') return tiles;
  if (filter === 'in_progress') {
    return tiles.filter((tile) => {
      const p = tile.comprehensibility_percent ?? 0;
      return p > 0 && p < 100;
    });
  }
  if (filter === 'mastered') {
    return tiles.filter((tile) => tile.status === 'mastered');
  }
  if (filter === 'not_started') {
    return tiles.filter((tile) => {
      const p = tile.comprehensibility_percent ?? 0;
      return p === 0 && tile.status !== 'mastered';
    });
  }
  // CEFR chip
  return tiles.filter((tile) => tile.cefr_level === filter);
}

function applySort(tiles: ReelTile[], sort: MyMoviesSort): ReelTile[] {
  const arr = [...tiles];
  switch (sort) {
    case 'recently_added':
      return arr;
    case 'title_asc':
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case 'year_desc':
      return arr.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case 'year_asc':
      return arr.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    case 'comprehension_desc':
      return arr.sort(
        (a, b) =>
          (b.comprehensibility_percent ?? 0) -
          (a.comprehensibility_percent ?? 0),
      );
    case 'comprehension_asc':
      return arr.sort(
        (a, b) =>
          (a.comprehensibility_percent ?? 0) -
          (b.comprehensibility_percent ?? 0),
      );
    case 'cefr_easy_first':
      return arr.sort((a, b) => {
        const al = a.cefr_level ?? '';
        const bl = b.cefr_level ?? '';
        return (CEFR_RANK[al] ?? 99) - (CEFR_RANK[bl] ?? 99);
      });
    case 'rating_desc':
      return arr;
  }
}

// ── Page ───────────────────────────────────────────────────────────────

export default function MyMoviesPage() {
  const t = useThemeColors();
  const navigate = useNavigate();

  const tiles = useReelStore((s) => s.tiles);
  const reelHydrated = useReelStore((s) => s.hydrated);
  const hydrateReel = useReelStore((s) => s.hydrate);

  const sort = useMyMoviesUiStore((s) => s.sort);
  const filter = useMyMoviesUiStore((s) => s.filter);
  const uiHydrated = useMyMoviesUiStore((s) => s.hydrated);
  const hydrateUi = useMyMoviesUiStore((s) => s.hydrate);
  const setSort = useMyMoviesUiStore((s) => s.setSort);
  const setFilter = useMyMoviesUiStore((s) => s.setFilter);

  useEffect(() => {
    if (!reelHydrated) void hydrateReel();
  }, [reelHydrated, hydrateReel]);
  useEffect(() => {
    if (!uiHydrated) hydrateUi();
  }, [uiHydrated, hydrateUi]);

  const visible = useMemo(() => applyFilter(tiles, filter), [tiles, filter]);
  const sorted = useMemo(() => applySort(visible, sort), [visible, sort]);

  // ── Derived counts for the filter rail ──────────────────────────────
  const counts = useMemo(() => {
    const inProgress = tiles.filter((tile) => {
      const p = tile.comprehensibility_percent ?? 0;
      return p > 0 && p < 100;
    }).length;
    const mastered = tiles.filter((tile) => tile.status === 'mastered').length;
    const notStarted = tiles.filter((tile) => {
      const p = tile.comprehensibility_percent ?? 0;
      return p === 0 && tile.status !== 'mastered';
    }).length;

    const byCefr: Record<string, number> = {};
    for (const tile of tiles) {
      const lvl = tile.cefr_level;
      if (lvl) byCefr[lvl] = (byCefr[lvl] ?? 0) + 1;
    }
    return {
      all: tiles.length,
      in_progress: inProgress,
      mastered,
      not_started: notStarted,
      byCefr,
    };
  }, [tiles]);

  // ── Stat strip values ───────────────────────────────────────────────
  const filmsCount = tiles.length;
  const avgComp = useMemo(() => {
    if (tiles.length === 0) return 0;
    const sum = tiles.reduce(
      (acc, tile) => acc + (tile.comprehensibility_percent ?? 0),
      0,
    );
    return Math.round(sum / tiles.length);
  }, [tiles]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <PageHeader
        eyebrow="Your library"
        title="My Movies"
        subtitle="Films you're learning from. Click any poster to study its words or start a quick quiz."
        right={
          <button
            type="button"
            onClick={() => navigate('/search')}
            style={{
              ...buttonReset,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 18px',
              borderRadius: 10,
              background: t.gold,
              color: t.goldDeep,
              fontSize: 13,
              fontWeight: 900,
              letterSpacing: 0.4,
              boxShadow: '0 8px 18px rgba(255,209,102,0.30)',
              cursor: 'pointer',
            }}
          >
            <PlusIcon /> ADD A FILM
          </button>
        }
      />

      {/* Stat strip */}
      <div
        style={{
          margin: '0 32px 24px',
          padding: '16px 22px',
          borderRadius: 12,
          background: t.paper,
          border: `1px solid ${t.border}`,
          boxShadow: t.shadowCard,
          display: 'flex',
          gap: 32,
          alignItems: 'center',
        }}
      >
        <Stat n={String(filmsCount)} l="Films in library" t={t} />
        <Divider t={t} />
        <Stat n={'—'} l="Words known" t={t} />
        <Divider t={t} />
        <Stat n={`${avgComp}%`} l="Avg comprehension" t={t} accent />
        <Divider t={t} />
        <Stat n={'—'} l="Words due today" t={t} accent2 />
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => navigate('/practice')}
          style={{
            ...buttonReset,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 999,
            background: t.primaryT,
            color: t.primary,
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            cursor: 'pointer',
            border: `1px solid ${t.primary}`,
          }}
        >
          <span>📚</span> Practice →
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          padding: '0 32px 32px',
          display: 'flex',
          gap: 24,
        }}
      >
        <FilterRail
          t={t}
          activeFilter={filter}
          onChangeFilter={setFilter}
          counts={counts}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Toolbar */}
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
              Showing {visible.length} of {tiles.length}{' '}
              {tiles.length === 1 ? 'film' : 'films'}
            </div>
            <div style={{ flex: 1 }} />
            <SortDropdown value={sort} onChange={setSort} t={t} />
          </div>

          {/* Grid / empty states */}
          {!reelHydrated ? (
            <EmptyState
              title="Loading your library…"
              body="One moment while we fetch your reel."
              t={t}
            />
          ) : tiles.length === 0 ? (
            <EmptyState
              title="Your library is empty"
              body="Add a movie to start building your vocab deck. We'll pull words from its script and slot them into your daily practice."
              actionLabel="Add a film"
              onAction={() => navigate('/search')}
              t={t}
            />
          ) : sorted.length === 0 ? (
            <EmptyState
              title="No films match"
              body="Your current filter excludes everything in your library. Try another chip — or clear the filter."
              actionLabel="Show all films"
              onAction={() => setFilter('all')}
              t={t}
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 18,
              }}
            >
              {sorted.map((tile) => (
                <MovieCard
                  key={tile.tmdb_id}
                  tile={tile}
                  t={t}
                  onClick={() => navigate(`/movie/${tile.tmdb_id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────

function MovieCard({
  tile,
  t,
  onClick,
}: {
  tile: ReelTile;
  t: ThemeTokens;
  onClick: () => void;
}) {
  const level = tile.cefr_level ?? null;
  const cefrColor = level ? CEFR[level] : t.text3;
  const progress = Math.max(
    0,
    Math.min(100, Math.round(tile.comprehensibility_percent ?? 0)),
  );
  const mastered = tile.status === 'mastered' || progress >= 100;
  const posterUrl = TMDB(tile.poster_path);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...buttonReset,
        background: t.paper,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: t.shadowCard,
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        textAlign: 'left',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {/* Poster */}
      <div
        style={{
          position: 'relative',
          aspectRatio: '2/3',
          background: t.raised,
        }}
      >
        {posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: t.text3,
              fontFamily: SERIF,
              fontSize: 22,
              padding: 16,
              textAlign: 'center',
            }}
          >
            {tile.title}
          </div>
        )}

        {level ? (
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              background: cefrColor,
              color: '#fff',
              fontSize: 10,
              fontWeight: 900,
              padding: '2px 7px',
              borderRadius: 4,
              letterSpacing: 0.4,
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            }}
          >
            {level}
          </div>
        ) : null}

        {mastered ? (
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              background: '#FFD166',
              color: '#3a2400',
              fontSize: 9,
              fontWeight: 900,
              padding: '2px 6px',
              borderRadius: 3,
              letterSpacing: 0.4,
              border: '1px solid #3a2400',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            }}
          >
            FINAL CUT
          </div>
        ) : null}

        {/* Bottom gradient with progress */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '24px 12px 10px',
            background:
              'linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0) 100%)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                flex: 1,
                height: 3,
                borderRadius: 999,
                background: 'rgba(255,255,255,0.15)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: mastered ? '#FFD166' : cefrColor,
                  borderRadius: 999,
                }}
              />
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: MONO,
                fontWeight: 900,
                color: '#fff',
                minWidth: 28,
                textAlign: 'right',
              }}
            >
              {progress}%
            </div>
          </div>
          {tile.year ? (
            <div
              style={{
                fontSize: 9,
                fontFamily: MONO,
                fontWeight: 800,
                color: 'rgba(255,255,255,0.7)',
                letterSpacing: 0.4,
              }}
            >
              {tile.year}
            </div>
          ) : null}
        </div>
      </div>

      {/* Title */}
      <div style={{ padding: '12px 14px 14px' }}>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 16,
            fontWeight: 600,
            color: t.text,
            letterSpacing: -0.3,
            lineHeight: 1.15,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {tile.title}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: t.text3,
            fontWeight: 700,
            marginTop: 4,
            letterSpacing: 0.2,
          }}
        >
          {tile.year ?? ''}
        </div>
      </div>
    </button>
  );
}

interface FilterRailCounts {
  all: number;
  in_progress: number;
  mastered: number;
  not_started: number;
  byCefr: Record<string, number>;
}

function FilterRail({
  t,
  activeFilter,
  onChangeFilter,
  counts,
}: {
  t: ThemeTokens;
  activeFilter: MyMoviesFilter;
  onChangeFilter: (f: MyMoviesFilter) => void;
  counts: FilterRailCounts;
}) {
  const statusItems: Array<{ value: MyMoviesFilter; label: string; count: number }> = [
    { value: 'all', label: 'All films', count: counts.all },
    { value: 'in_progress', label: 'In progress', count: counts.in_progress },
    { value: 'mastered', label: 'Mastered', count: counts.mastered },
    { value: 'not_started', label: 'Not started', count: counts.not_started },
  ];

  const cefrLevels = Object.keys(counts.byCefr).sort(
    (a, b) => (CEFR_RANK[a] ?? 99) - (CEFR_RANK[b] ?? 99),
  );

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        padding: '8px 0 24px 0',
      }}
    >
      <FilterSection title="Status" t={t}>
        {statusItems.map((it) => (
          <FilterItem
            key={String(it.value)}
            label={it.label}
            count={it.count}
            active={activeFilter === it.value}
            onClick={() => onChangeFilter(it.value)}
            t={t}
          />
        ))}
      </FilterSection>

      {cefrLevels.length > 0 ? (
        <FilterSection title="Level" t={t}>
          {cefrLevels.map((lvl) => (
            <FilterItem
              key={lvl}
              label={lvl}
              count={counts.byCefr[lvl]}
              swatch={CEFR[lvl]}
              active={activeFilter === lvl}
              onClick={() => onChangeFilter(lvl)}
              t={t}
            />
          ))}
        </FilterSection>
      ) : null}
    </aside>
  );
}

function FilterSection({
  title,
  t,
  children,
}: {
  title: string;
  t: ThemeTokens;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 900,
          letterSpacing: 1.8,
          color: t.text3,
          textTransform: 'uppercase',
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children}
      </div>
    </div>
  );
}

function FilterItem({
  label,
  count,
  swatch,
  active,
  onClick,
  t,
}: {
  label: string;
  count: number;
  swatch?: string;
  active: boolean;
  onClick: () => void;
  t: ThemeTokens;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...buttonReset,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 10px',
        borderRadius: 6,
        background: active ? t.primaryT : 'transparent',
        color: active ? t.text : t.text2,
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      {swatch ? (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            background: swatch,
            flexShrink: 0,
          }}
        />
      ) : null}
      <span style={{ flex: 1 }}>{label}</span>
      <span
        style={{
          fontSize: 11,
          color: t.text3,
          fontFamily: MONO,
          fontWeight: 700,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function SortDropdown({
  value,
  onChange,
  t,
}: {
  value: MyMoviesSort;
  onChange: (s: MyMoviesSort) => void;
  t: ThemeTokens;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
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
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            ...buttonReset,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 8,
            background: t.chipBg,
            border: `1px solid ${t.border}`,
            fontSize: 12,
            fontWeight: 800,
            color: t.text,
            cursor: 'pointer',
          }}
        >
          {SORT_LABELS[value]} <span style={{ fontSize: 9, color: t.text3 }}>▼</span>
        </button>
      </div>
      {open ? (
        <div
          // Click-outside dismisses; backdrop catches it without dimming.
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 5,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              right: 32,
              marginTop: 8,
              minWidth: 220,
              background: t.paper,
              border: `1px solid ${t.border}`,
              borderRadius: 10,
              boxShadow: t.shadowCard,
              padding: 6,
              zIndex: 6,
            }}
          >
            {SORT_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                style={{
                  ...buttonReset,
                  display: 'block',
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  textAlign: 'left',
                  fontSize: 13,
                  fontWeight: 600,
                  color: s === value ? t.text : t.text2,
                  background: s === value ? t.primaryT : 'transparent',
                  cursor: 'pointer',
                }}
              >
                {SORT_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  n,
  l,
  t,
  accent,
  accent2,
}: {
  n: string;
  l: string;
  t: ThemeTokens;
  accent?: boolean;
  accent2?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 26,
          fontWeight: 700,
          lineHeight: 1,
          color: accent ? t.goldOnSurface : accent2 ? t.primary : t.text,
        }}
      >
        {n}
      </div>
      <div
        style={{
          fontSize: 11,
          color: t.text3,
          marginTop: 4,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          fontWeight: 800,
        }}
      >
        {l}
      </div>
    </div>
  );
}

function Divider({ t }: { t: ThemeTokens }) {
  return <div style={{ width: 1, height: 32, background: t.divider }} />;
}

function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  t,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  t: ThemeTokens;
}) {
  return (
    <div
      style={{
        padding: '64px 24px',
        textAlign: 'center',
        background: t.paper,
        border: `1px dashed ${t.border}`,
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 22,
          fontWeight: 700,
          color: t.text,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 14,
          color: t.text2,
          maxWidth: 480,
          margin: '0 auto 18px',
          lineHeight: 1.5,
        }}
      >
        {body}
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          style={{
            ...buttonReset,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            borderRadius: 10,
            background: t.gold,
            color: t.goldDeep,
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: 0.4,
            cursor: 'pointer',
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

const buttonReset: CSSProperties = {
  border: 'none',
  font: 'inherit',
  background: 'none',
  appearance: 'none',
};

// keep Fragment importable in case future sections fan out
void Fragment;
