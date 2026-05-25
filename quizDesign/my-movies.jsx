/* WordWise — MyMoviesScreen
   Flat sortable/filterable list of the user's added movies.
   Replaces the zigzag film reel. Single screen, both modes.

   Renders inside an iOS frame at 402x874.
   `mode` prop: 'dark' | 'light'  →  swaps the full token set.
*/

(function () {
  const { useState } = React;

  // ── Tokens (mirror apps/mobile/src/theme/tokens.ts) ────────────
  const TOKENS = {
    dark: {
      bg:        '#0e0d10',
      paper:     '#1a1a24',
      surface:   '#1F1F30',
      raised:    '#23223a',
      border:    'rgba(255,255,255,0.10)',
      divider:   'rgba(255,255,255,0.06)',
      text:      '#ffffff',
      text2:     'rgba(255,255,255,0.72)',
      text3:     'rgba(255,255,255,0.45)',
      primary:   '#9B7ED9',
      primaryT:  'rgba(124,92,191,0.20)',
      gold:      '#FFD166',
      goldOnSurface: '#FFD166',
      goldDeep:  '#3a2400',
      success:   '#4CAF9A',
      tabBg:     'rgba(20,18,28,0.92)',
      tabBorder: 'rgba(255,255,255,0.08)',
      chipBg:    'rgba(255,255,255,0.06)',
      chipBgOn:  '#FFD166',
      chipTxtOn: '#3a2400',
      shadowCard:'0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 28px rgba(0,0,0,0.45)',
      shadowFab: '0 12px 28px rgba(255,209,102,0.35), 0 2px 0 rgba(0,0,0,0.4)',
    },
    light: {
      bg:        '#F4EFE3',           // warm "contact-sheet" paper
      paper:     '#FFFFFF',
      surface:   '#FFFFFF',
      raised:    '#FFFFFF',
      border:    '#E5DCC4',
      divider:   '#EEE6D2',
      text:      '#2D2418',
      text2:     '#6E5F47',
      text3:     '#9C8E72',
      primary:   '#7C5CBF',
      primaryT:  'rgba(124,92,191,0.10)',
      gold:      '#C58B1B',
      goldOnSurface: '#8B5A00',
      goldDeep:  '#3a2400',
      success:   '#3F8B7B',
      tabBg:     'rgba(255,253,247,0.96)',
      tabBorder: '#E5DCC4',
      chipBg:    '#EEE6D2',
      chipBgOn:  '#2D2418',
      chipTxtOn: '#FFD166',
      shadowCard:'0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 14px rgba(60,40,10,0.10)',
      shadowFab: '0 10px 22px rgba(197,139,27,0.40), 0 2px 0 rgba(58,36,0,0.20)',
    },
  };

  const CEFR = {
    A1: '#4CAF50', A2: '#8BC34A', B1: '#FFC107', B2: '#FF9800', C1: '#F44336', C2: '#9C27B0',
  };

  const SERIF = `'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif`;
  const SANS  = `-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', system-ui, sans-serif`;
  const MONO  = `'JetBrains Mono', 'SF Mono', Menlo, monospace`;

  const TMDB = (p) => p ? `https://image.tmdb.org/t/p/w185${p}` : null;

  // ── Pieces ─────────────────────────────────────────────────────
  function Chip({ label, active, t }) {
    return (
      <div style={{
        padding: '7px 13px', borderRadius: 999, whiteSpace: 'nowrap',
        background: active ? t.chipBgOn : t.chipBg,
        color: active ? t.chipTxtOn : t.text2,
        fontSize: 12, fontWeight: 800, letterSpacing: 0.2,
        border: active ? 'none' : `1px solid ${t.border}`,
      }}>{label}</div>
    );
  }

  function Row({ movie, t }) {
    const cefr = CEFR[movie.level];
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 16px',
        borderBottom: `1px solid ${t.divider}`,
      }}>
        {/* poster */}
        <div style={{
          width: 56, height: 84, borderRadius: 6, overflow: 'hidden',
          background: t.raised, flexShrink: 0, position: 'relative',
          boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
        }}>
          <img src={TMDB(movie.poster)} alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          {/* tiny CEFR corner badge */}
          <div style={{
            position: 'absolute', top: 4, left: 4,
            background: cefr, color: '#fff', fontSize: 9, fontWeight: 900,
            padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3,
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}>{movie.level}</div>
        </div>

        {/* meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: SERIF, fontSize: 17, fontWeight: 600, color: t.text,
            letterSpacing: -0.3, lineHeight: 1.1, marginBottom: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{movie.title}</div>
          <div style={{ fontSize: 11.5, color: t.text3, fontWeight: 600, marginBottom: 8, letterSpacing: 0.2 }}>
            {movie.year} · {movie.director} · {movie.runtime}
          </div>

          {/* progress bar + numbers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              flex: 1, height: 4, borderRadius: 999,
              background: t.divider, overflow: 'hidden',
            }}>
              <div style={{
                width: `${movie.progress}%`, height: '100%',
                background: movie.progress === 100 ? t.gold : cefr,
                borderRadius: 999,
              }} />
            </div>
            <div style={{ fontSize: 10.5, color: t.text2, fontWeight: 800, fontFamily: MONO, minWidth: 64, textAlign: 'right' }}>
              {movie.wordsKnown}/{movie.words} · {movie.progress}%
            </div>
          </div>
        </div>

        <div style={{ color: t.text3, fontSize: 18, fontWeight: 300 }}>›</div>
      </div>
    );
  }

  // ── Screen ─────────────────────────────────────────────────────
  function MyMoviesScreen({ mode = 'dark' }) {
    const t = TOKENS[mode];
    const data = window.WW_TABS_DATA;

    const [activeChip, setActiveChip] = useState('All');
    const chips = ['All', 'In progress', 'Mastered', 'Not started', 'B1', 'B2', 'C1'];
    const [sortBy] = useState('Recently added');

    return (
      <div style={{
        width: '100%', height: '100%',
        background: t.bg, color: t.text,
        fontFamily: SANS, display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* ── Top bar ────────────────────────────────────── */}
        {/* 62px top inset clears the iOS status bar + dynamic island so
            nothing in this screen overlaps with the wifi/time/notch. */}
        <div style={{ height: 62, flexShrink: 0 }} />
        <div style={{
          padding: '8px 18px 8px',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 900, letterSpacing: 2,
              color: t.goldOnSurface, textTransform: 'uppercase', marginBottom: 4,
            }}>Your Library</div>
            <div style={{
              fontFamily: SERIF, fontSize: 30, fontWeight: 600,
              letterSpacing: -0.8, color: t.text, lineHeight: 1,
              whiteSpace: 'nowrap',
            }}>My Movies</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <IconBtn t={t}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
              </svg>
            </IconBtn>
            <IconBtn t={t}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M3 6h18M6 12h12M10 18h4" />
              </svg>
            </IconBtn>
          </div>
        </div>

        {/* ── Stat strip ─────────────────────────────────── */}
        <div style={{
          margin: '6px 18px 14px',
          padding: '14px 16px',
          borderRadius: 14,
          background: t.paper,
          border: `1px solid ${t.border}`,
          boxShadow: t.shadowCard,
          display: 'flex', gap: 14, alignItems: 'center',
        }}>
          <Stat n="10"  l="films"       t={t} />
          <Divider t={t} />
          <Stat n="124" l="words known" t={t} />
          <Divider t={t} />
          <Stat n="38%" l="avg comp."    accent t={t} />
        </div>

        {/* ── Filter chips ───────────────────────────────── */}
        <div style={{
          display: 'flex', gap: 7, padding: '0 18px 12px',
          overflowX: 'auto', flexShrink: 0,
        }}>
          {chips.map((c) => (
            <div key={c} onClick={() => setActiveChip(c)} style={{ cursor: 'pointer' }}>
              <Chip label={c} active={c === activeChip} t={t} />
            </div>
          ))}
        </div>

        {/* ── Sort row ───────────────────────────────────── */}
        <div style={{
          padding: '0 18px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: t.text3, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            10 films · sorted by
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 12, fontWeight: 800, color: t.text2,
            padding: '5px 10px', borderRadius: 8,
            background: t.chipBg, border: `1px solid ${t.border}`,
          }}>
            {sortBy} <span style={{ fontSize: 9, color: t.text3 }}>▼</span>
          </div>
        </div>

        {/* ── List ───────────────────────────────────────── */}
        <div style={{
          flex: 1, overflowY: 'auto', paddingBottom: 90,
          background: t.paper, margin: '0 12px', borderRadius: 14,
          border: `1px solid ${t.border}`, boxShadow: t.shadowCard,
        }}>
          {data.movies.slice(0, 8).map((m) => <Row key={m.id} movie={m} t={t} />)}
        </div>

        {/* ── FAB ────────────────────────────────────────── */}
        <div style={{
          position: 'absolute', right: 22, bottom: 96,
          width: 56, height: 56, borderRadius: 28,
          background: t.gold, color: t.goldDeep,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: t.shadowFab,
          fontSize: 28, fontWeight: 300, lineHeight: 1,
        }}>+</div>

        {/* ── Bottom nav ─────────────────────────────────── */}
        <BottomNav active="movies" t={t} />
      </div>
    );
  }

  // ── Helpers ────────────────────────────────────────────────────
  function IconBtn({ children, t }) {
    return (
      <div style={{
        width: 38, height: 38, borderRadius: 19,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: t.chipBg, color: t.text2,
        border: `1px solid ${t.border}`,
      }}>{children}</div>
    );
  }
  function Stat({ n, l, accent, t }) {
    return (
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div style={{
          fontFamily: SERIF, fontSize: 22, fontWeight: 700, lineHeight: 1,
          color: accent ? t.goldOnSurface : t.text,
        }}>{n}</div>
        <div style={{ fontSize: 10, color: t.text3, marginTop: 4, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>{l}</div>
      </div>
    );
  }
  function Divider({ t }) {
    return <div style={{ width: 1, height: 28, background: t.divider }} />;
  }

  function BottomNav({ active, t }) {
    const items = [
      { id: 'home',     label: 'Home',     icon: 'home' },
      { id: 'movies',   label: 'My Movies',icon: 'film' },
      { id: 'practice', label: 'Practice', icon: 'spark' },
      { id: 'profile',  label: 'Profile',  icon: 'user' },
    ];
    return (
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 78, paddingBottom: 18,
        background: t.tabBg, borderTop: `1px solid ${t.tabBorder}`,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around',
        paddingTop: 8,
      }}>
        {items.map((it) => {
          const on = it.id === active;
          return (
            <div key={it.id} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              color: on ? t.gold : t.text3, fontWeight: 800, fontSize: 10, letterSpacing: 0.4,
            }}>
              <NavIcon kind={it.icon} on={on} t={t} />
              <span style={{ color: on ? t.text : t.text3 }}>{it.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function NavIcon({ kind, on, t }) {
    const stroke = on ? t.gold : t.text3;
    const sw = 1.9;
    const size = 22;
    const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round' };
    if (kind === 'home')    return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>;
    if (kind === 'film')    return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M3 12h18M3 16h18M8 4v16M16 4v16"/></svg>;
    if (kind === 'spark')   return <svg {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3" fill={on ? t.gold : 'none'} /></svg>;
    if (kind === 'user')    return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.6-6 8-6s6.5 2 8 6"/></svg>;
    return null;
  }

  window.WW_MY_MOVIES = { MyMoviesScreen };
})();
