/* WordWise Web — shared shell (sidebar nav, top bar) + tokens.
   Web is desktop-first 1440px wide. Sidebar fixed at 240px, content fluid.

   Tokens mirror mobile so brand stays consistent across platforms; layout
   doesn't — web gets a sidebar instead of a bottom tab bar, wider grids,
   hover states, denser typography. The cinema language ("Now Showing",
   "Intermission", filmstrip motifs) is preserved.
*/

(function () {
  const { useState } = React;

  const WW_TOKENS = {
    dark: {
      bg:'#0e0d10', bgRaised:'#15141a', paper:'#1a1a24', surface:'#1F1F30', raised:'#23223a',
      border:'rgba(255,255,255,0.10)', divider:'rgba(255,255,255,0.06)',
      text:'#ffffff', text2:'rgba(255,255,255,0.72)', text3:'rgba(255,255,255,0.45)',
      primary:'#9B7ED9', primaryT:'rgba(124,92,191,0.20)',
      gold:'#FFD166', goldOnSurface:'#FFD166', goldDeep:'#3a2400',
      success:'#4CAF9A', successTint:'rgba(76,175,154,0.20)', successBorder:'rgba(76,175,154,0.55)',
      error:'#E57373',  errorTint:'rgba(229,115,115,0.18)',   errorBorder:'rgba(229,115,115,0.55)',
      chipBg:'rgba(255,255,255,0.06)', chipBgOn:'#FFD166', chipTxtOn:'#3a2400',
      sidebarBg:'#08070a', sidebarBorder:'rgba(255,255,255,0.06)',
      hover:'rgba(255,255,255,0.06)',
      shadowCard:'0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 24px rgba(0,0,0,0.45)',
      heroGlow:'radial-gradient(60% 100% at 50% 0%, rgba(255,209,102,0.16) 0%, transparent 70%)',
      lessonRing:'rgba(255,209,102,0.45)',
      nodeLocked:'#2a2935', nodeLockedB:'rgba(255,255,255,0.06)',
      shadowNode:'0 6px 0 rgba(0,0,0,0.45), 0 14px 24px rgba(255,209,102,0.18)',
      shadowNodeLocked:'0 4px 0 rgba(0,0,0,0.40)',
      wordBox:'#0a090d',
    },
    light: {
      bg:'#F4EFE3', bgRaised:'#FAF6E8', paper:'#FFFFFF', surface:'#FFFFFF', raised:'#FFFFFF',
      border:'#E5DCC4', divider:'#EEE6D2',
      text:'#2D2418', text2:'#6E5F47', text3:'#9C8E72',
      primary:'#7C5CBF', primaryT:'rgba(124,92,191,0.10)',
      gold:'#C58B1B', goldOnSurface:'#8B5A00', goldDeep:'#3a2400',
      success:'#3F8B7B', successTint:'rgba(63,139,123,0.14)', successBorder:'rgba(63,139,123,0.55)',
      error:'#D66A6A',  errorTint:'rgba(214,106,106,0.16)',   errorBorder:'rgba(214,106,106,0.55)',
      chipBg:'#EEE6D2', chipBgOn:'#2D2418', chipTxtOn:'#FFD166',
      sidebarBg:'#1E1612', sidebarBorder:'rgba(255,255,255,0.08)',  // dark sidebar even in light = cinema lobby
      hover:'rgba(58,36,0,0.06)',
      shadowCard:'0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 14px rgba(60,40,10,0.10)',
      heroGlow:'radial-gradient(60% 100% at 50% 0%, rgba(197,139,27,0.12) 0%, transparent 70%)',
      lessonRing:'rgba(197,139,27,0.55)',
      nodeLocked:'#E5DCC4', nodeLockedB:'#D7CCB0',
      shadowNode:'0 5px 0 rgba(58,36,0,0.20), 0 10px 18px rgba(197,139,27,0.25)',
      shadowNodeLocked:'0 4px 0 rgba(58,36,0,0.10)',
      wordBox:'#FAF7EE',
    },
  };

  const CEFR = { A1:'#4CAF50', A2:'#8BC34A', B1:'#FFC107', B2:'#FF9800', C1:'#F44336', C2:'#9C27B0' };
  const SERIF = `'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif`;
  const SANS  = `-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', system-ui, sans-serif`;
  const MONO  = `'JetBrains Mono', 'SF Mono', Menlo, monospace`;
  const TMDB  = (p) => p ? `https://image.tmdb.org/t/p/w300${p}` : null;
  const TMDB_BIG = (p) => p ? `https://image.tmdb.org/t/p/w500${p}` : null;

  // ── Sidebar (always dark — feels like a cinema lobby) ────────────
  function Sidebar({ active, t, mode }) {
    const items = [
      { id: 'home',     label: 'Home',     icon: 'home' },
      { id: 'movies',   label: 'My Movies',icon: 'film' },
      { id: 'practice', label: 'Practice', icon: 'spark' },
      { id: 'discover', label: 'Discover', icon: 'compass' },
      { id: 'stats',    label: 'Stats',    icon: 'chart' },
    ];
    // Sidebar palette is independent of mode — always the lobby treatment.
    const sb = {
      bg: t.sidebarBg,
      border: t.sidebarBorder,
      text: '#ffffff',
      text2: 'rgba(255,255,255,0.55)',
      gold: '#FFD166',
      goldDeep: '#3a2400',
      hover: 'rgba(255,255,255,0.06)',
    };
    return (
      <aside style={{
        width: 240, flexShrink: 0,
        background: sb.bg,
        borderRight: `1px solid ${sb.border}`,
        display: 'flex', flexDirection: 'column',
        padding: '24px 0',
        color: sb.text,
      }}>
        {/* Logo */}
        <div style={{ padding: '0 22px 28px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: sb.gold, color: sb.goldDeep,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: SERIF, fontSize: 18, fontWeight: 800, letterSpacing: -1,
          }}>W</div>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>WordWise</div>
            <div style={{ fontSize: 10, color: sb.text2, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginTop: -2 }}>
              Learn from films
            </div>
          </div>
        </div>

        <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((it) => {
            const on = it.id === active;
            return (
              <div key={it.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 8,
                background: on ? sb.hover : 'transparent',
                color: on ? sb.gold : sb.text,
                fontSize: 13, fontWeight: 700, letterSpacing: 0.1,
                position: 'relative',
                cursor: 'pointer',
              }}>
                {on ? (
                  <div style={{
                    position: 'absolute', left: -12, top: 8, bottom: 8, width: 3,
                    background: sb.gold, borderRadius: '0 3px 3px 0',
                  }} />
                ) : null}
                <SidebarIcon kind={it.icon} color={on ? sb.gold : sb.text2} />
                <span>{it.label}</span>
              </div>
            );
          })}
        </div>

        {/* spacer */}
        <div style={{ flex: 1 }} />

        {/* Streak card */}
        <div style={{ padding: '0 16px 20px' }}>
          <div style={{
            padding: '14px 14px',
            borderRadius: 12,
            background: 'rgba(255,209,102,0.10)',
            border: '1px solid rgba(255,209,102,0.25)',
            color: sb.text,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>🔥</span>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 900, color: sb.gold, lineHeight: 1 }}>14</div>
                <div style={{ fontSize: 10, fontWeight: 800, color: sb.text2, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 3 }}>day streak</div>
              </div>
            </div>
            <div style={{
              marginTop: 10, height: 4, borderRadius: 999,
              background: 'rgba(255,255,255,0.10)', overflow: 'hidden',
            }}>
              <div style={{ width: '67%', height: '100%', background: sb.gold, borderRadius: 999 }} />
            </div>
            <div style={{ fontSize: 10, color: sb.text2, fontWeight: 700, marginTop: 6, letterSpacing: 0.4 }}>
              2 of 3 minutes today
            </div>
          </div>
        </div>

        {/* User row */}
        <div style={{
          padding: '12px 16px',
          borderTop: `1px solid ${sb.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 16, flexShrink: 0,
            background: 'linear-gradient(135deg, #FFD166, #C58B1B)',
            color: '#3a2400',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, fontSize: 13,
          }}>TM</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: sb.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Tamerlan M.</div>
            <div style={{ fontSize: 10, color: sb.text2, fontWeight: 700, letterSpacing: 0.6 }}>B2 · Russian</div>
          </div>
        </div>
      </aside>
    );
  }

  function SidebarIcon({ kind, color }) {
    const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
    if (kind === 'home')     return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>;
    if (kind === 'film')     return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M3 12h18M3 16h18M8 4v16M16 4v16"/></svg>;
    if (kind === 'spark')    return <svg {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3" /></svg>;
    if (kind === 'compass')  return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6z"/></svg>;
    if (kind === 'chart')    return <svg {...p}><path d="M4 19V5M4 19h16M8 15v-3M12 15V8M16 15v-5"/></svg>;
    return null;
  }

  // Top bar inside content area — search + theme toggle + notif
  function TopBar({ t, mode, onToggleMode }) {
    return (
      <div style={{
        height: 64, padding: '0 32px', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 16,
        borderBottom: `1px solid ${t.divider}`,
        background: t.bgRaised,
      }}>
        {/* Search */}
        <div style={{
          flex: 1, maxWidth: 520,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 10,
          background: t.paper, border: `1px solid ${t.border}`,
          color: t.text2,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
          </svg>
          <span style={{ fontSize: 13, color: t.text3, fontWeight: 500 }}>Search films, words, or actors…</span>
          <div style={{
            marginLeft: 'auto', padding: '2px 6px', borderRadius: 4,
            background: t.chipBg, fontFamily: MONO, fontSize: 10, fontWeight: 800, color: t.text3,
          }}>⌘K</div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Theme toggle */}
        <div onClick={onToggleMode} style={{
          width: 38, height: 38, borderRadius: 19,
          background: t.chipBg, border: `1px solid ${t.border}`,
          color: t.text2, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        }}>
          {mode === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </div>

        {/* Notif */}
        <div style={{
          width: 38, height: 38, borderRadius: 19, position: 'relative',
          background: t.chipBg, border: `1px solid ${t.border}`,
          color: t.text2, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>
          <div style={{
            position: 'absolute', top: 6, right: 8, width: 8, height: 8, borderRadius: 4, background: t.gold, border: `2px solid ${t.bgRaised}`,
          }} />
        </div>
      </div>
    );
  }

  // Page header inside content area
  function PageHeader({ eyebrow, title, subtitle, t, right }) {
    return (
      <div style={{
        padding: '36px 32px 24px',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 900, letterSpacing: 2.4,
            color: t.goldOnSurface, textTransform: 'uppercase', marginBottom: 8,
          }}>{eyebrow}</div>
          <h1 style={{
            margin: 0, fontFamily: SERIF, fontSize: 44, fontWeight: 600,
            letterSpacing: -1.2, lineHeight: 1.05, color: t.text,
          }}>{title}</h1>
          {subtitle ? (
            <div style={{
              fontSize: 15, color: t.text2, marginTop: 8, maxWidth: 640,
              lineHeight: 1.4, fontWeight: 500,
            }}>{subtitle}</div>
          ) : null}
        </div>
        {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
      </div>
    );
  }

  window.WW_WEB_SHELL = { WW_TOKENS, CEFR, SERIF, SANS, MONO, TMDB, TMDB_BIG, Sidebar, TopBar, PageHeader };
})();
