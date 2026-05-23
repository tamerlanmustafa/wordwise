/* WordWise — PracticeScreen
   Duolingo-style vertical path. Each "unit" = a movie. 5 lesson nodes per
   unit, slight zigzag layout, movie-themed marquee header per unit.

   Light + dark via `mode` prop.
*/

(function () {
  const { useState } = React;

  // Pull the same token shape used by MyMoviesScreen — keeps them visually
  // aligned across tabs. Two extra Practice-only tokens added on top.
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
      gold:      '#FFD166',
      goldOnSurface: '#FFD166',
      goldDeep:  '#3a2400',
      success:   '#4CAF9A',
      tabBg:     'rgba(20,18,28,0.92)',
      tabBorder: 'rgba(255,255,255,0.08)',
      chipBg:    'rgba(255,255,255,0.06)',
      // Practice-only:
      heroGlow:  'radial-gradient(120% 60% at 50% 0%, rgba(255,209,102,0.18) 0%, transparent 60%)',
      lessonRing:'rgba(255,209,102,0.45)',
      nodeDone:  '#FFD166',
      nodeActive:'#FFD166',
      nodeLocked:'#2a2935',
      nodeLockedB:'rgba(255,255,255,0.06)',
      shadowCard:'0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 28px rgba(0,0,0,0.45)',
      shadowNode:'0 6px 0 rgba(0,0,0,0.45), 0 14px 24px rgba(255,209,102,0.20)',
      shadowNodeLocked:'0 4px 0 rgba(0,0,0,0.45)',
    },
    light: {
      bg:        '#F4EFE3',
      paper:     '#FFFFFF',
      surface:   '#FFFFFF',
      raised:    '#FFFFFF',
      border:    '#E5DCC4',
      divider:   '#EEE6D2',
      text:      '#2D2418',
      text2:     '#6E5F47',
      text3:     '#9C8E72',
      primary:   '#7C5CBF',
      gold:      '#C58B1B',
      goldOnSurface: '#8B5A00',
      goldDeep:  '#3a2400',
      success:   '#3F8B7B',
      tabBg:     'rgba(255,253,247,0.96)',
      tabBorder: '#E5DCC4',
      chipBg:    '#EEE6D2',
      heroGlow:  'radial-gradient(120% 60% at 50% 0%, rgba(197,139,27,0.14) 0%, transparent 60%)',
      lessonRing:'rgba(197,139,27,0.55)',
      nodeDone:  '#C58B1B',
      nodeActive:'#C58B1B',
      nodeLocked:'#E5DCC4',
      nodeLockedB:'#D7CCB0',
      shadowCard:'0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 14px rgba(60,40,10,0.10)',
      shadowNode:'0 5px 0 rgba(58,36,0,0.18), 0 10px 18px rgba(197,139,27,0.25)',
      shadowNodeLocked:'0 4px 0 rgba(58,36,0,0.10)',
    },
  };

  const CEFR = {
    A1: '#4CAF50', A2: '#8BC34A', B1: '#FFC107', B2: '#FF9800', C1: '#F44336', C2: '#9C27B0',
  };

  const SERIF = `'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif`;
  const SANS  = `-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', system-ui, sans-serif`;
  const MONO  = `'JetBrains Mono', 'SF Mono', Menlo, monospace`;

  const TMDB = (p) => p ? `https://image.tmdb.org/t/p/w185${p}` : null;

  // Horizontal x-positions for the 5 lesson nodes inside a unit. Gentle
  // zigzag (Duolingo's pattern), NOT the rejected film-reel scroll.
  const X_OFFSETS = [0, 56, 24, -32, -8];

  // ── Lesson node ────────────────────────────────────────────────
  function LessonNode({ kind, state, t, label }) {
    const isDone   = state === 'done';
    const isActive = state === 'active';
    const isLocked = state === 'locked';

    const bg = isLocked ? t.nodeLocked : t.gold;
    const fg = isLocked ? t.text3      : t.goldDeep;
    const ring = isActive;

    return (
      <div style={{
        position: 'relative',
        width: 76, height: 76,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* Active glow ring */}
        {ring ? (
          <div style={{
            position: 'absolute', inset: -10,
            borderRadius: '50%',
            border: `2.5px dashed ${t.lessonRing}`,
            animation: 'wwSpin 18s linear infinite',
          }} />
        ) : null}

        {/* Node body */}
        <div style={{
          width: 68, height: 68, borderRadius: '50%',
          background: bg,
          border: isLocked ? `2px solid ${t.nodeLockedB}` : 'none',
          boxShadow: isLocked ? t.shadowNodeLocked : t.shadowNode,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: fg,
        }}>
          <NodeIcon kind={isDone ? 'check' : (isLocked ? 'lock' : kind)} color={fg} />
        </div>

        {/* "START" callout below active */}
        {isActive ? (
          <div style={{
            position: 'absolute', top: 78, left: '50%',
            transform: 'translateX(-50%)',
            background: t.text, color: t.bg,
            padding: '4px 10px', borderRadius: 6,
            fontSize: 10, fontWeight: 900, letterSpacing: 1.2,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
          }}>
            START
            <div style={{
              position: 'absolute', top: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
              width: 8, height: 8, background: t.text,
            }} />
          </div>
        ) : null}
      </div>
    );
  }

  function NodeIcon({ kind, color }) {
    const p = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
    if (kind === 'check')  return <svg {...p}><path d="M5 12l4 4 10-10" /></svg>;
    if (kind === 'lock')   return <svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    if (kind === 'recall') return <svg {...p}><path d="M4 5h12a4 4 0 0 1 0 8H6l-2 3z" /></svg>;
    if (kind === 'mcq')    return <svg {...p}><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>;
    if (kind === 'listen') return <svg {...p}><path d="M4 14V10a8 8 0 0 1 16 0v4M4 14a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2zM20 14a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z" /></svg>;
    if (kind === 'chest')  return <svg {...p}><path d="M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M3 11h18v8H3z"/><path d="M12 11v3M9.5 14h5"/></svg>;
    if (kind === 'star')   return <svg {...p}><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.3L12 17.3 6.4 20.3l1.1-6.3L3 9.6l6.2-.9z" fill={color} stroke="none"/></svg>;
    return <svg {...p}><circle cx="12" cy="12" r="6" /></svg>;
  }

  // ── Unit (movie) header ────────────────────────────────────────
  function UnitMarquee({ unit, t, first }) {
    const cefr = CEFR[unit.level];
    return (
      <div style={{
        margin: first ? '8px 16px 8px' : '32px 16px 8px',
        padding: '12px 14px',
        borderRadius: 14,
        background: t.paper,
        border: `1px solid ${t.border}`,
        boxShadow: t.shadowCard,
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'relative',
      }}>
        {/* marquee bulbs row */}
        <div style={{
          position: 'absolute', top: -4, left: 14, right: 14,
          display: 'flex', justifyContent: 'space-between',
        }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: '50%',
              background: i % 2 === 0 ? t.gold : 'transparent',
              border: i % 2 === 0 ? 'none' : `1px solid ${t.border}`,
              opacity: i % 2 === 0 ? 0.85 : 1,
              boxShadow: i % 2 === 0 ? `0 0 6px ${t.gold}` : 'none',
            }} />
          ))}
        </div>

        {/* poster */}
        <div style={{
          width: 46, height: 68, borderRadius: 5, overflow: 'hidden',
          background: t.raised, flexShrink: 0,
          boxShadow: '0 3px 8px rgba(0,0,0,0.4)',
        }}>
          <img src={TMDB(unit.poster)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: 1.8, color: t.goldOnSurface, marginBottom: 2 }}>
            UNIT · NOW SHOWING
          </div>
          <div style={{
            fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: t.text,
            letterSpacing: -0.3, lineHeight: 1.1, marginBottom: 4,
          }}>{unit.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              background: cefr, color: '#fff',
              fontSize: 9, fontWeight: 900, padding: '2px 6px', borderRadius: 3,
              letterSpacing: 0.3,
            }}>{unit.level}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.text3 }}>
              {unit.tagline}
            </div>
          </div>
        </div>

        {/* progress badge */}
        <div style={{
          padding: '6px 10px', borderRadius: 999,
          background: t.chipBg, border: `1px solid ${t.border}`,
          fontSize: 11, fontWeight: 900, color: t.text, fontFamily: MONO,
        }}>
          {unit.done}<span style={{ color: t.text3 }}>/{unit.total}</span>
        </div>
      </div>
    );
  }

  // ── Lesson path inside a unit ──────────────────────────────────
  function UnitPath({ unit, t }) {
    return (
      <div style={{ padding: '8px 0 4px', position: 'relative' }}>
        {unit.lessons.map((l, i) => {
          const x = X_OFFSETS[i % X_OFFSETS.length];
          const prev = i > 0 ? X_OFFSETS[(i - 1) % X_OFFSETS.length] : null;
          return (
            <div key={l.id} style={{ position: 'relative' }}>
              {/* connector */}
              {i > 0 ? (
                <Connector x1={prev} x2={x} t={t} done={unit.lessons[i - 1].state === 'done'} />
              ) : null}

              <div style={{
                display: 'flex', justifyContent: 'center',
                transform: `translateX(${x}px)`,
                padding: '14px 0',
              }}>
                <LessonNode kind={l.kind} state={l.state} t={t} label={l.label} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function Connector({ x1, x2, t, done }) {
    // SVG sized to span 1 row height (~58px gap). Centered.
    const W = 200, H = 58;
    const cx = W / 2;
    const x1c = cx + x1;
    const x2c = cx + x2;
    const color = done ? t.gold : t.divider;
    const dash = done ? '0' : '4 6';
    return (
      <div style={{
        position: 'relative', height: H, marginTop: -14, marginBottom: -14,
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
      }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <line x1={x1c} y1={0} x2={x2c} y2={H}
            stroke={color} strokeWidth={done ? 4 : 3}
            strokeDasharray={dash} strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  // ── Screen ─────────────────────────────────────────────────────
  function PracticeScreen({ mode = 'dark' }) {
    const t = TOKENS[mode];
    const data = window.WW_TABS_DATA;

    return (
      <div style={{
        width: '100%', height: '100%',
        background: t.bg, color: t.text,
        fontFamily: SANS, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative',
      }}>
        {/* top warm glow */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 280,
          background: t.heroGlow, pointerEvents: 'none',
        }} />

        {/* ── Top bar ────────────────────────────────────── */}
        {/* 62px top inset clears the iOS status bar + dynamic island. */}
        <div style={{ height: 62, flexShrink: 0, position: 'relative', zIndex: 2 }} />
        <div style={{
          padding: '6px 18px 6px',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          position: 'relative', zIndex: 2,
        }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 900, letterSpacing: 2,
              color: t.goldOnSurface, textTransform: 'uppercase', marginBottom: 4,
            }}>Daily practice</div>
            <div style={{
              fontFamily: SERIF, fontSize: 30, fontWeight: 600,
              letterSpacing: -0.8, color: t.text, lineHeight: 1,
            }}>Practice</div>
          </div>
          {/* streak chip */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 999,
            background: t.paper, border: `1px solid ${t.border}`,
            boxShadow: t.shadowCard,
          }}>
            <span style={{ fontSize: 16 }}>🔥</span>
            <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 900, color: t.text }}>14</span>
            <span style={{ fontSize: 10, fontWeight: 800, color: t.text3, letterSpacing: 0.6 }}>DAYS</span>
          </div>
        </div>

        {/* ── Scrolling content ──────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 90, position: 'relative', zIndex: 1 }}>

          {/* Daily review hero */}
          <div style={{
            margin: '12px 16px 16px',
            padding: '16px 18px',
            borderRadius: 16,
            background: t.gold, color: t.goldDeep,
            boxShadow: `0 12px 28px ${mode === 'dark' ? 'rgba(255,209,102,0.25)' : 'rgba(197,139,27,0.30)'}, 0 2px 0 rgba(0,0,0,0.25)`,
            position: 'relative', overflow: 'hidden',
          }}>
            {/* subtle film perforation strip */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: 0, width: 8,
              backgroundImage: `linear-gradient(${t.goldDeep} 50%, transparent 50%)`,
              backgroundSize: '100% 12px', opacity: 0.25,
            }} />
            <div style={{ paddingLeft: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.8, opacity: 0.7, textTransform: 'uppercase' }}>
                Today's review
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, letterSpacing: -0.4, marginTop: 4, lineHeight: 1.1 }}>
                12 words · ~2&nbsp;min
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '8px 16px', borderRadius: 999,
                  background: t.goldDeep, color: t.gold,
                  fontSize: 12, fontWeight: 900, letterSpacing: 0.6,
                }}>START SESSION →</div>
                <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.7, letterSpacing: 0.4 }}>
                  +25 XP · keeps streak
                </div>
              </div>
            </div>
          </div>

          {/* Stat row */}
          <div style={{
            margin: '0 16px 18px', display: 'flex', gap: 8,
          }}>
            <MiniStat icon="⭐" n="480" l="XP today"  t={t} />
            <MiniStat icon="📚" n="124" l="words"     t={t} />
            <MiniStat icon="🎬" n="2"   l="in progress" t={t} />
          </div>

          {/* Section header */}
          <div style={{
            padding: '0 22px 4px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.8, color: t.text3, textTransform: 'uppercase' }}>
              Your study path
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: t.goldOnSurface }}>See all</div>
          </div>

          {/* Path */}
          {data.units.map((unit, i) => (
            <React.Fragment key={unit.id}>
              <UnitMarquee unit={unit} t={t} first={i === 0} />
              <UnitPath unit={unit} t={t} />
              {/* between-unit divider */}
              {i < data.units.length - 1 ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 24px',
                  color: t.text3, fontSize: 10, fontWeight: 800, letterSpacing: 1.4,
                }}>
                  <div style={{ flex: 1, height: 1, background: t.divider }} />
                  INTERMISSION
                  <div style={{ flex: 1, height: 1, background: t.divider }} />
                </div>
              ) : null}
            </React.Fragment>
          ))}

          <div style={{ height: 32 }} />
        </div>

        <BottomNav active="practice" t={t} />
      </div>
    );
  }

  function MiniStat({ icon, n, l, t }) {
    return (
      <div style={{
        flex: 1,
        padding: '10px 12px',
        borderRadius: 12,
        background: t.paper, border: `1px solid ${t.border}`,
        boxShadow: t.shadowCard,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ fontSize: 18 }}>{icon}</div>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 900, color: t.text, lineHeight: 1 }}>{n}</div>
          <div style={{ fontSize: 9, color: t.text3, letterSpacing: 0.8, fontWeight: 800, marginTop: 2, textTransform: 'uppercase' }}>{l}</div>
        </div>
      </div>
    );
  }

  // ── Bottom nav (duplicated locally so this file is self-contained) ──
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
              fontWeight: 800, fontSize: 10, letterSpacing: 0.4,
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
    const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' };
    if (kind === 'home')    return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>;
    if (kind === 'film')    return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M3 12h18M3 16h18M8 4v16M16 4v16"/></svg>;
    if (kind === 'spark')   return <svg {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3" fill={on ? t.gold : 'none'} /></svg>;
    if (kind === 'user')    return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.6-6 8-6s6.5 2 8 6"/></svg>;
    return null;
  }

  window.WW_PRACTICE = { PracticeScreen };
})();
