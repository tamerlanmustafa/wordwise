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

  // Hex → rgba(a) helper for the fade-out scrim above the bottom nav.
  function withAlpha(c, a) {
    const m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
    const rgba = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${a})`;
    return c;
  }

  // Horizontal x-offsets (in px from center) for the 5 lesson nodes inside
  // a unit. Gentle zigzag, NOT the rejected film-reel scroll.
  const X_OFFSETS = [0, 56, 24, -32, -8];

  // Vertical spacing between node centers within a unit.
  const NODE_SIZE = 68;          // film-cell body
  const NODE_HIT  = 84;          // includes perforation rows
  const NODE_GAP  = 36;          // visual gap between two cells
  const ROW_H     = NODE_HIT + NODE_GAP;  // 120

  // ── Lesson node — FILM CELL (rounded square + perforations) ────
  function LessonNode({ kind, state, t, number }) {
    const isDone   = state === 'done';
    const isActive = state === 'active';
    const isLocked = state === 'locked';

    const bg     = isLocked ? t.nodeLocked : t.gold;
    const fg     = isLocked ? t.text3      : t.goldDeep;
    const perfFg = isLocked ? t.text3      : t.goldDeep;

    return (
      <div style={{
        position: 'relative',
        width: NODE_SIZE, height: NODE_HIT,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        {/* Active glow ring sits behind everything */}
        {isActive ? (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: -10, right: -10,
            borderRadius: 18,
            border: `2.5px dashed ${t.lessonRing}`,
            animation: 'wwSpin 18s linear infinite',
          }} />
        ) : null}

        {/* Top perforation strip */}
        <Perforations color={perfFg} dim={isLocked} />

        {/* Cell body */}
        <div style={{
          position: 'relative',
          width: NODE_SIZE, height: NODE_SIZE,
          borderRadius: 12,
          background: bg,
          border: isLocked ? `2px solid ${t.nodeLockedB}` : 'none',
          boxShadow: isLocked ? t.shadowNodeLocked : t.shadowNode,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: fg,
          marginTop: 2,
        }}>
          <NodeIcon kind={isDone ? 'check' : (isLocked ? 'lock' : kind)} color={fg} />

          {/* Number badge — overflows top-left so user always sees progress 1..N */}
          {number != null ? (
            <div style={{
              position: 'absolute',
              top: -10, left: -10,
              minWidth: 22, height: 22,
              padding: '0 5px',
              borderRadius: 11,
              background: isLocked ? t.paper : t.text,
              color: isLocked ? t.text3 : t.gold,
              border: `2px solid ${isLocked ? t.nodeLockedB : t.goldDeep}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 900, fontFamily: MONO,
              letterSpacing: -0.2,
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}>{number}</div>
          ) : null}
        </div>

        {/* Bottom perforation strip */}
        <Perforations color={perfFg} dim={isLocked} bottom />

        {/* "START" callout below active */}
        {isActive ? (
          <div style={{
            position: 'absolute', top: NODE_HIT + 6, left: '50%',
            transform: 'translateX(-50%)',
            background: t.text, color: t.bg,
            padding: '4px 10px', borderRadius: 6,
            fontSize: 10, fontWeight: 900, letterSpacing: 1.2,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
          }}>
            START
            <div style={{
              position: 'absolute', top: -3, left: '50%',
              transform: 'translateX(-50%) rotate(45deg)',
              width: 8, height: 8, background: t.text,
            }} />
          </div>
        ) : null}
      </div>
    );
  }

  function Perforations({ color, dim, bottom }) {
    // 5 small rounded rects across the top or bottom edge — reads as
    // film-strip sprocket holes. Stops the cell from feeling generic.
    const opacity = dim ? 0.35 : 0.55;
    return (
      <div style={{
        width: NODE_SIZE,
        height: 6,
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        marginTop: bottom ? 2 : 0,
        marginBottom: bottom ? 0 : 0,
      }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{
            width: 7, height: 4, borderRadius: 1.5,
            background: color, opacity,
          }} />
        ))}
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
  // Single positioned container: SVG underlay draws connectors as small
  // film-strip segments (band + sprocket holes), then nodes are absolute-
  // positioned on top. The container's height is fixed, so nothing bleeds
  // past it into the bottom nav.
  function UnitPath({ unit, t, startIndex = 1 }) {
    const W = 320;
    const N = unit.lessons.length;
    const H = (N - 1) * ROW_H + NODE_HIT + 22;

    const centers = unit.lessons.map((l, i) => {
      const x = (W / 2) + X_OFFSETS[i % X_OFFSETS.length];
      // Path climbs UP: lesson 1 sits near the bottom of the unit, the
      // final lesson at the top. Numbers therefore read 1 → N from
      // bottom-to-top, like a hill the user is climbing.
      const y = H - 6 - i * ROW_H - NODE_HIT / 2;
      return { x, y };
    });

    return (
      <div style={{
        position: 'relative',
        width: W, height: H,
        margin: '8px auto 4px',
      }}>
        {/* SVG connectors — each is a tiny filmstrip */}
        <svg
          width={W} height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {centers.slice(0, -1).map((p, i) => {
            // start/end pulled in so the strip doesn't peek out past the cell
            const inset = NODE_HIT / 2 - 4;
            const dx = centers[i + 1].x - p.x;
            const dy = centers[i + 1].y - p.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const stripLen = len - inset * 2;
            if (stripLen <= 0) return null;

            const done = unit.lessons[i].state === 'done';
            return (
              <FilmStripSegment
                key={`conn-${i}`}
                x={p.x + Math.cos(angle * Math.PI / 180) * inset}
                y={p.y + Math.sin(angle * Math.PI / 180) * inset}
                length={stripLen}
                angle={angle}
                done={done}
                t={t}
              />
            );
          })}
        </svg>

        {/* Nodes on top */}
        {unit.lessons.map((l, i) => {
          const c = centers[i];
          return (
            <div key={l.id} style={{
              position: 'absolute',
              left: c.x - NODE_SIZE / 2,
              top:  c.y - NODE_HIT / 2,
            }}>
              <LessonNode kind={l.kind} state={l.state} t={t} number={startIndex + i} />
            </div>
          );
        })}
      </div>
    );
  }

  // A short filmstrip used to connect two cells. Two parallel sprocket
  // rails with a row of tiny rectangle perforations between them. Far more
  // on-brand than a flat line, and reads instantly as "frame to frame".
  function FilmStripSegment({ x, y, length, angle, done, t }) {
    const railColor = done ? t.gold : t.divider;
    const holeColor = done ? t.goldDeep : 'transparent';
    const opacity   = done ? 1 : 0.85;
    const stripH    = 12;
    const railH     = 1.6;

    // Perforations: ~one every 9px, leaving 5px end-pads.
    const holePitch = 9;
    const usableLen = Math.max(0, length - 10);
    const nHoles    = Math.max(2, Math.floor(usableLen / holePitch));
    const startX    = 5 + (usableLen - (nHoles - 1) * holePitch) / 2;

    return (
      <g
        transform={`translate(${x} ${y}) rotate(${angle})`}
        opacity={opacity}
        style={{ pointerEvents: 'none' }}
      >
        {/* top rail */}
        <rect
          x={0} y={-stripH / 2}
          width={length} height={railH}
          fill={railColor}
          rx={railH / 2}
          strokeDasharray={done ? '0' : '4 4'}
          stroke={done ? 'none' : railColor}
          strokeWidth={done ? 0 : 1.4}
        />
        {/* bottom rail */}
        <rect
          x={0} y={stripH / 2 - railH}
          width={length} height={railH}
          fill={railColor}
          rx={railH / 2}
          strokeDasharray={done ? '0' : '4 4'}
          stroke={done ? 'none' : railColor}
          strokeWidth={done ? 0 : 1.4}
        />
        {/* perforations between rails (only on completed strips — keeps
            locked segments lighter and obviously "not yet") */}
        {done
          ? Array.from({ length: nHoles }).map((_, i) => (
              <rect
                key={`h-${i}`}
                x={startX + i * holePitch}
                y={-2}
                width={4} height={4} rx={0.8}
                fill={holeColor}
              />
            ))
          : null}
      </g>
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
        {/* paddingBottom guarantees the last lesson node can scroll well
            above the 78px bottom nav. A fade-out gradient just above the
            nav softens any chrome that hasn't scrolled away yet. */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 160, position: 'relative', zIndex: 1 }}>

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
              <UnitPath unit={unit} t={t} startIndex={1} />
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

        {/* Fade-out scrim sitting just above the bottom nav so any lesson
            node still on screen doesn't visually crash into the tabs. */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 78, height: 56,
          background: `linear-gradient(to bottom, ${withAlpha(t.bg, 0)}, ${t.bg} 75%)`,
          pointerEvents: 'none', zIndex: 3,
        }} />

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
