/* WordWise Web — Practice tab.
   Desktop layout: sidebar + main. Main = daily-review hero band on top,
   then a centered learning path (climbs upward, film-cell nodes,
   filmstrip connectors), with a right-side rail showing the current unit
   detail + word preview.
*/

(function () {
  const { useState } = React;
  const { WW_TOKENS, CEFR, SERIF, SANS, MONO, TMDB, Sidebar, TopBar, PageHeader } = window.WW_WEB_SHELL;

  const UNITS = [
    {
      id:'u-parasite', title:'Parasite', poster:'/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
      level:'B2', done:4, total:5, tagline:'Class & survival',
      compFrom:64, compTo:78,
      lessons:[
        { kind:'recall', state:'done',   label:'Words 1–5',   wcount:5 },
        { kind:'mcq',    state:'done',   label:'Synonyms',    wcount:5 },
        { kind:'recall', state:'done',   label:'Words 6–10',  wcount:5 },
        { kind:'listen', state:'done',   label:'In context',  wcount:8 },
        { kind:'chest',  state:'active', label:'Final cut',   wcount:10 },
      ],
    },
    {
      id:'u-past-lives', title:'Past Lives', poster:'/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg',
      level:'B1', done:0, total:5, tagline:'Memory & longing',
      compFrom:42, compTo:62,
      lessons:[
        { kind:'recall', state:'locked', label:'Words 1–5',   wcount:5 },
        { kind:'mcq',    state:'locked', label:'Synonyms',    wcount:5 },
        { kind:'recall', state:'locked', label:'Words 6–10',  wcount:5 },
        { kind:'listen', state:'locked', label:'In context',  wcount:8 },
        { kind:'star',   state:'locked', label:'Mastery',     wcount:10 },
      ],
    },
  ];

  const SAMPLE_WORDS = [
    { w:'phosphorescent', t:'фосфоресцентный', pos:'adj.', cefr:'B2' },
    { w:'whisper',        t:'шёпот',           pos:'noun', cefr:'B1' },
    { w:'unravel',        t:'распутывать',     pos:'verb', cefr:'B2' },
    { w:'reluctant',      t:'неохотный',       pos:'adj.', cefr:'B1' },
    { w:'magnitude',      t:'величина',        pos:'noun', cefr:'B2' },
  ];

  // ── Lesson node — film-cell (same primitive as mobile, scaled for web) ─
  function LessonNode({ kind, state, t, number }) {
    const done = state === 'done', active = state === 'active', locked = state === 'locked';
    const bg = locked ? t.nodeLocked : t.gold;
    const fg = locked ? t.text3      : t.goldDeep;
    const SIZE = 84;

    return (
      <div style={{ position: 'relative', width: SIZE, height: 110, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {active ? (
          <div style={{
            position: 'absolute', top: 0, bottom: 14, left: -10, right: -10,
            borderRadius: 20, border: `2.5px dashed ${t.lessonRing}`,
            animation: 'wwSpin 18s linear infinite',
          }} />
        ) : null}

        <Perfs color={fg} dim={locked} />

        <div style={{
          position: 'relative',
          width: SIZE, height: SIZE, borderRadius: 14, background: bg,
          border: locked ? `2px solid ${t.nodeLockedB}` : 'none',
          boxShadow: locked ? t.shadowNodeLocked : t.shadowNode,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: fg, marginTop: 3,
        }}>
          <NodeIcon kind={done ? 'check' : (locked ? 'lock' : kind)} color={fg} size={36} />
          <div style={{
            position: 'absolute', top: -12, left: -12,
            minWidth: 28, height: 28, padding: '0 7px', borderRadius: 14,
            background: locked ? t.paper : t.text,
            color: locked ? t.text3 : t.gold,
            border: `2.5px solid ${locked ? t.nodeLockedB : t.goldDeep}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 900, fontFamily: MONO, letterSpacing: -0.3,
            boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
          }}>{number}</div>
        </div>

        <Perfs color={fg} dim={locked} />

        {active ? (
          <div style={{
            position: 'absolute', top: 116, left: '50%', transform: 'translateX(-50%)',
            background: t.text, color: t.bg, padding: '5px 12px', borderRadius: 6,
            fontSize: 11, fontWeight: 900, letterSpacing: 1.4, whiteSpace: 'nowrap',
            boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
          }}>
            START NEXT
            <div style={{
              position: 'absolute', top: -3, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
              width: 8, height: 8, background: t.text,
            }} />
          </div>
        ) : null}
      </div>
    );
  }
  function Perfs({ color, dim }) {
    return (
      <div style={{ width: 84, height: 7, display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ width: 9, height: 5, borderRadius: 2, background: color, opacity: dim ? 0.32 : 0.55 }} />
        ))}
      </div>
    );
  }

  function NodeIcon({ kind, color, size = 28 }) {
    const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' };
    if (kind === 'check')  return <svg {...p}><path d="M5 12l4 4 10-10" /></svg>;
    if (kind === 'lock')   return <svg {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>;
    if (kind === 'recall') return <svg {...p}><path d="M4 5h12a4 4 0 0 1 0 8H6l-2 3z"/></svg>;
    if (kind === 'mcq')    return <svg {...p}><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>;
    if (kind === 'listen') return <svg {...p}><path d="M4 14V10a8 8 0 0 1 16 0v4M4 14a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2zM20 14a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z"/></svg>;
    if (kind === 'chest')  return <svg {...p}><path d="M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M3 11h18v8H3z"/><path d="M12 11v3M9.5 14h5"/></svg>;
    if (kind === 'star')   return <svg {...p}><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.3L12 17.3 6.4 20.3l1.1-6.3L3 9.6l6.2-.9z" fill={color} stroke="none"/></svg>;
    return null;
  }

  // ── Filmstrip connector (rotated to span any two nodes) ─────────
  function FilmStripSegment({ x, y, length, angle, done, t }) {
    const railColor = done ? t.gold : t.divider;
    const stripH = 14, railH = 2;
    const usable = Math.max(0, length - 12);
    const nHoles = Math.max(2, Math.floor(usable / 10));
    const startX = 6 + (usable - (nHoles - 1) * 10) / 2;
    return (
      <g transform={`translate(${x} ${y}) rotate(${angle})`} style={{ pointerEvents: 'none' }}>
        <rect x={0} y={-stripH/2} width={length} height={railH} fill={railColor} rx={1}
          stroke={done ? 'none' : railColor} strokeWidth={done ? 0 : 1.4} strokeDasharray={done ? '0' : '5 5'} />
        <rect x={0} y={stripH/2 - railH} width={length} height={railH} fill={railColor} rx={1}
          stroke={done ? 'none' : railColor} strokeWidth={done ? 0 : 1.4} strokeDasharray={done ? '0' : '5 5'} />
        {done ? Array.from({ length: nHoles }).map((_, i) => (
          <rect key={i} x={startX + i * 10} y={-2.5} width={5} height={5} rx={0.8} fill={t.goldDeep} />
        )) : null}
      </g>
    );
  }

  // x-offsets (px from center) for 5 lessons. Wider zigzag than mobile.
  const X_OFFSETS = [0, 90, 40, -50, -10];
  const ROW_H = 168;
  const NODE_HIT = 110;

  function UnitPath({ unit, t, startIndex }) {
    const W = 460;
    const N = unit.lessons.length;
    const H = (N - 1) * ROW_H + NODE_HIT + 30;

    const centers = unit.lessons.map((l, i) => {
      const x = (W / 2) + X_OFFSETS[i % X_OFFSETS.length];
      // climb up — lesson 1 at the bottom, lesson N at the top
      const y = H - 12 - i * ROW_H - NODE_HIT / 2;
      return { x, y };
    });

    return (
      <div style={{ position: 'relative', width: W, height: H, margin: '0 auto' }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }}>
          {centers.slice(0, -1).map((p, i) => {
            const q = centers[i + 1];
            const inset = NODE_HIT / 2 - 4;
            const dx = q.x - p.x, dy = q.y - p.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const stripLen = len - inset * 2;
            if (stripLen <= 0) return null;
            const done = unit.lessons[i].state === 'done';
            return (
              <FilmStripSegment
                key={i}
                x={p.x + Math.cos(angle * Math.PI / 180) * inset}
                y={p.y + Math.sin(angle * Math.PI / 180) * inset}
                length={stripLen} angle={angle} done={done} t={t}
              />
            );
          })}
        </svg>
        {unit.lessons.map((l, i) => {
          const c = centers[i];
          return (
            <div key={i} style={{
              position: 'absolute',
              left: c.x - 42, top: c.y - NODE_HIT / 2,
            }}>
              <LessonNode kind={l.kind} state={l.state} t={t} number={startIndex + i} />
            </div>
          );
        })}
      </div>
    );
  }

  function UnitMarquee({ unit, t, first }) {
    const cefr = CEFR[unit.level];
    return (
      <div style={{
        margin: first ? '0 0 16px' : '32px 0 16px',
        padding: '16px 20px',
        borderRadius: 16, background: t.paper, border: `1px solid ${t.border}`,
        boxShadow: t.shadowCard,
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'relative', maxWidth: 720, marginLeft: 'auto', marginRight: 'auto',
      }}>
        <div style={{
          position: 'absolute', top: -5, left: 22, right: 22,
          display: 'flex', justifyContent: 'space-between',
        }}>
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: '50%',
              background: i % 2 === 0 ? t.gold : 'transparent',
              border: i % 2 === 0 ? 'none' : `1px solid ${t.border}`,
              boxShadow: i % 2 === 0 ? `0 0 7px ${t.gold}` : 'none',
              opacity: i % 2 === 0 ? 0.9 : 1,
            }} />
          ))}
        </div>
        <div style={{
          width: 62, height: 92, borderRadius: 6, overflow: 'hidden',
          background: t.raised, flexShrink: 0, boxShadow: '0 4px 10px rgba(0,0,0,0.45)',
        }}>
          <img src={TMDB(unit.poster)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2, color: t.goldOnSurface, marginBottom: 4 }}>
            UNIT · NOW SHOWING
          </div>
          <div style={{
            fontFamily: SERIF, fontSize: 22, fontWeight: 600, color: t.text,
            letterSpacing: -0.4, lineHeight: 1.05, marginBottom: 6,
          }}>{unit.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: cefr, color: '#fff', fontSize: 10, fontWeight: 900, padding: '2px 7px', borderRadius: 3, letterSpacing: 0.4 }}>{unit.level}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.text3 }}>{unit.tagline}</div>
          </div>
        </div>
        <div style={{
          padding: '8px 12px', borderRadius: 999,
          background: t.chipBg, border: `1px solid ${t.border}`,
          fontSize: 13, fontWeight: 900, color: t.text, fontFamily: MONO,
        }}>
          {unit.done}<span style={{ color: t.text3 }}>/{unit.total}</span>
        </div>
      </div>
    );
  }

  // Side rail with current unit details + word peek
  function SideRail({ t, unit }) {
    return (
      <div style={{
        width: 320, flexShrink: 0,
        padding: '32px 32px 32px 0',
      }}>
        <div style={{ position: 'sticky', top: 24 }}>
          <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 1.8, color: t.text3, textTransform: 'uppercase', marginBottom: 12 }}>
            Up next
          </div>

          {/* Hero card for active lesson */}
          <div style={{
            padding: '18px 18px', borderRadius: 14,
            background: t.paper, border: `1px solid ${t.border}`,
            boxShadow: t.shadowCard, marginBottom: 18,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 46, height: 46, borderRadius: 10,
                background: t.gold, color: t.goldDeep,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <NodeIcon kind="chest" color={t.goldDeep} size={24} />
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 1.6, color: t.goldOnSurface, textTransform: 'uppercase' }}>
                  Lesson 5 · {unit.title}
                </div>
                <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: t.text, letterSpacing: -0.3 }}>
                  Final cut
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: t.text2, marginBottom: 14, lineHeight: 1.45 }}>
              The mastery node. 10 words from <strong style={{ color: t.text }}>{unit.title}</strong>,
              mixed quiz types. Pass with 8/10 to mark the film as mastered.
            </div>

            {/* Comprehension delta */}
            <div style={{ padding: '12px 14px', borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.4, color: t.text3, textTransform: 'uppercase', marginBottom: 4 }}>
                Comprehension after pass
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 900, color: t.text3 }}>{unit.compFrom}%</span>
                <svg width="20" height="14" viewBox="0 0 20 14" fill="none" stroke={t.success} strokeWidth="2"><path d="M2 7h14M11 2l5 5-5 5"/></svg>
                <span style={{ fontFamily: MONO, fontSize: 28, fontWeight: 900, color: t.success }}>{unit.compTo}%</span>
              </div>
              <div style={{ fontSize: 11, color: t.text3, fontWeight: 700, marginTop: 4 }}>
                +{unit.compTo - unit.compFrom} points if you pass — frequency-weighted.
              </div>
            </div>

            <div style={{
              padding: '12px 16px', borderRadius: 10,
              background: t.gold, color: t.goldDeep,
              fontSize: 13, fontWeight: 900, letterSpacing: 0.6, textAlign: 'center', textTransform: 'uppercase',
              boxShadow: '0 8px 16px rgba(255,209,102,0.30)',
              cursor: 'pointer',
            }}>
              Start lesson →
            </div>
          </div>

          {/* Word preview */}
          <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 1.8, color: t.text3, textTransform: 'uppercase', marginBottom: 12 }}>
            Words in this lesson
          </div>
          <div style={{
            padding: '6px 0', borderRadius: 12,
            background: t.paper, border: `1px solid ${t.border}`,
            boxShadow: t.shadowCard,
          }}>
            {SAMPLE_WORDS.map((w, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                borderBottom: i < SAMPLE_WORDS.length - 1 ? `1px solid ${t.divider}` : 'none',
              }}>
                <div style={{
                  background: CEFR[w.cefr], color: '#fff',
                  fontSize: 9, fontWeight: 900, padding: '1px 5px', borderRadius: 3,
                  letterSpacing: 0.3, minWidth: 22, textAlign: 'center',
                }}>{w.cefr}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 600, color: t.text, letterSpacing: -0.2 }}>{w.w}</div>
                  <div style={{ fontSize: 11, color: t.text3, fontWeight: 600, fontStyle: 'italic' }}>{w.pos} · {w.t}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.text3} strokeWidth="2"><path d="M9 6l6 6-6 6"/></svg>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function PracticeWeb({ mode = 'dark', onToggleMode }) {
    const t = WW_TOKENS[mode];
    const activeUnit = UNITS[0];

    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: t.bg, color: t.text, fontFamily: SANS, overflow: 'hidden' }}>
        <Sidebar active="practice" t={t} mode={mode} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <TopBar t={t} mode={mode} onToggleMode={onToggleMode} />

          <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400, background: t.heroGlow, pointerEvents: 'none' }} />

            <PageHeader
              eyebrow="Daily practice"
              title="Practice"
              subtitle="Two minutes of spaced review, plus film-anchored lessons. Climb each movie's path to mark it mastered."
              t={t}
              right={
                <div style={{ display: 'flex', gap: 12 }}>
                  <Stat n="124" l="words known" t={t} />
                </div>
              }
            />

            {/* Study path + side rail */}
            <div style={{ display: 'flex', gap: 24, padding: '0 0 32px 32px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 16, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.8, color: t.text3, textTransform: 'uppercase' }}>
                    Your study path · climbs upward
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: t.goldOnSurface, cursor: 'pointer' }}>See all units →</div>
                </div>

                {UNITS.map((unit, i) => {
                  const startIdx = UNITS.slice(0, i).reduce((a, u) => a + u.lessons.length, 0) + 1;
                  return (
                    <React.Fragment key={unit.id}>
                      <UnitMarquee unit={unit} t={t} first={i === 0} />
                      <UnitPath unit={unit} t={t} startIndex={startIdx} />
                      {i < UNITS.length - 1 ? (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '20px 24px 8px', maxWidth: 720, margin: '0 auto',
                          color: t.text3, fontSize: 10.5, fontWeight: 800, letterSpacing: 1.6,
                        }}>
                          <div style={{ flex: 1, height: 1, background: t.divider }} />
                          INTERMISSION
                          <div style={{ flex: 1, height: 1, background: t.divider }} />
                        </div>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </div>

              <SideRail t={t} unit={activeUnit} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  function Stat({ n, l, t, accent }) {
    return (
      <div style={{
        padding: '12px 18px', borderRadius: 12,
        background: t.paper, border: `1px solid ${t.border}`,
        boxShadow: t.shadowCard,
        minWidth: 92,
      }}>
        <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 900, color: accent ? t.goldOnSurface : t.text, lineHeight: 1 }}>{n}</div>
        <div style={{ fontSize: 10, fontWeight: 800, color: t.text3, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>{l}</div>
      </div>
    );
  }

  window.WW_WEB_PRACTICE = { PracticeWeb };
})();
