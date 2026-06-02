/* WordWise — Home (mobile, iOS)
   The ranked-feed home screen re-skinned into the cinema / contact-sheet
   system used by My Movies, Practice and the Quiz screens.

   KEY RULE: the movie cards themselves (RankedMovieList → MovieCard) are
   reproduced 1:1 from apps/mobile/src/components/home/RankedMovieList.tsx —
   same 116px backdrop card, poster-left, rating · level · words, and the
   "+ Add to list" chip. Only the chrome AROUND the list changes.

   Light + dark via the `mode` prop. `scenario` toggles the search dropdown.
*/

(function () {
  const { useState } = React;

  // ── Tokens (identical shape to tabs/my-movies.jsx + tabs/practice.jsx) ──
  const TOKENS = {
    dark: {
      bg:'#0e0d10', paper:'#1a1a24', surface:'#1F1F30', raised:'#23223a',
      border:'rgba(255,255,255,0.10)', divider:'rgba(255,255,255,0.06)',
      text:'#ffffff', text2:'rgba(255,255,255,0.72)', text3:'rgba(255,255,255,0.45)',
      gold:'#FFD166', goldOnSurface:'#FFD166', goldDeep:'#3a2400',
      success:'#4CAF9A',
      tabBg:'rgba(20,18,28,0.92)', tabBorder:'rgba(255,255,255,0.08)',
      chipBg:'rgba(255,255,255,0.06)', chipBgOn:'#FFD166', chipTxtOn:'#3a2400',
      heroGlow:'radial-gradient(120% 60% at 50% 0%, rgba(255,209,102,0.16) 0%, transparent 62%)',
      shadowCard:'0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 28px rgba(0,0,0,0.45)',
    },
    light: {
      bg:'#F4EFE3', paper:'#FFFFFF', surface:'#FFFFFF', raised:'#F1E9D6',
      border:'#E5DCC4', divider:'#EEE6D2',
      text:'#2D2418', text2:'#6E5F47', text3:'#9C8E72',
      gold:'#C58B1B', goldOnSurface:'#8B5A00', goldDeep:'#3a2400',
      success:'#3F8B7B',
      tabBg:'rgba(255,253,247,0.96)', tabBorder:'#E5DCC4',
      chipBg:'#EEE6D2', chipBgOn:'#2D2418', chipTxtOn:'#FFD166',
      heroGlow:'radial-gradient(120% 60% at 50% 0%, rgba(197,139,27,0.12) 0%, transparent 62%)',
      shadowCard:'0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 14px rgba(60,40,10,0.10)',
    },
  };

  const CEFR = { A1:'#4CAF50', A2:'#8BC34A', B1:'#FFC107', B2:'#FF9800', C1:'#F44336', C2:'#9C27B0' };
  const SERIF = `'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif`;
  const SANS  = `-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', system-ui, sans-serif`;
  const MONO  = `'JetBrains Mono', 'SF Mono', Menlo, monospace`;
  const POSTER  = (p, w='w185') => p ? `https://image.tmdb.org/t/p/${w}${p}` : null;

  function scoreToCefr(score) {
    if (score == null) return null;
    if (score < 30) return 'A1';
    if (score < 45) return 'A2';
    if (score < 60) return 'B1';
    if (score < 75) return 'B2';
    if (score < 90) return 'C1';
    return 'C2';
  }

  // Small stroked icon set — replaces every emoji that used to live here.
  function Icon({ name, size=18, color='currentColor', sw=2, fill='none' }) {
    const p = { width:size, height:size, viewBox:'0 0 24 24', fill, stroke:color, strokeWidth:sw, strokeLinecap:'round', strokeLinejoin:'round' };
    switch (name) {
      case 'search':  return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>;
      case 'close':   return <svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>;
      case 'chevron': return <svg {...p}><path d="M6 9l6 6 6-6"/></svg>;
      case 'play':    return <svg {...p} fill={color} stroke="none"><path d="M8 5v14l11-7z"/></svg>;
      case 'bookmark':return <svg {...p}><path d="M6 4h12v16l-6-4-6 4z"/></svg>;
      case 'check':   return <svg {...p}><path d="M5 12l4 4 10-10"/></svg>;
      case 'star':    return <svg {...p} fill={color} stroke="none"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.3L12 17.3 6.4 20.3l1.1-6.3L3 9.6l6.2-.9z"/></svg>;
      case 'bell':    return <svg {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>;
      case 'home':    return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>;
      case 'film':    return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M3 12h18M3 16h18M8 4v16M16 4v16"/></svg>;
      case 'spark':   return <svg {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>;
      case 'user':    return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.6-6 8-6s6.5 2 8 6"/></svg>;
      default: return null;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  MOVIE CARD — reproduced verbatim from RankedMovieList.tsx.
  //  DO NOT restyle. CARD_H=116, poster 70×84, backdrop + 0.52 scrim,
  //  rating · level · words, top-right "+ Add to list" chip.
  // ════════════════════════════════════════════════════════════════
  const CARD_H = 116, CARD_GAP = 8;

  function MovieCard({ movie, added }) {
    const backdropUri = POSTER(movie.backdrop_path, 'w780');
    const posterUri   = POSTER(movie.poster_path, 'w185');
    const rating = movie.vote_average > 0 ? `★ ${Number(movie.vote_average).toFixed(1)}` : null;
    const cefr   = scoreToCefr(movie.difficulty_score);
    const level  = cefr && movie.difficulty_score != null ? `${cefr} ${movie.difficulty_score}%` : null;
    const wordCount = movie.unique_words > 0 ? `${movie.unique_words} words` : null;

    return (
      <div style={{ height: CARD_H, marginBottom: CARD_GAP }}>
        <div style={{
          height: '100%', borderRadius: 14, overflow: 'hidden', position: 'relative',
          boxShadow: '0 5px 10px rgba(0,0,0,0.18)',
          backgroundImage: backdropUri ? `url(${backdropUri})` : 'none',
          backgroundColor: '#000', backgroundSize: 'cover', backgroundPosition: 'center',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.52)' }} />
          <div style={{
            position: 'relative', display: 'flex', flexDirection: 'row',
            alignItems: 'stretch', height: '100%', padding: '0 12px', gap: 12,
          }}>
            <img src={posterUri} alt="" style={{
              width: 70, height: 84, borderRadius: 8, objectFit: 'cover',
              alignSelf: 'center', background: 'rgba(255,255,255,0.1)',
            }} />
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              justifyContent: 'flex-end', alignItems: 'flex-start',
              padding: '6px 0', gap: 4, minWidth: 0,
            }}>
              <div style={{
                fontSize: 15, fontWeight: 700, color: '#fff', lineHeight: 1.2,
                overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>{movie.title}</div>
              {(rating || level) && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
                  {[rating, level].filter(Boolean).join('  •  ')}
                </div>
              )}
              {wordCount && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{wordCount}</div>}
            </div>
          </div>
          {/* + Add to list chip (top-right) — unchanged */}
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <div style={{
              padding: '5px 10px', borderRadius: 999, border: '1px solid',
              background: added ? 'rgba(255,209,102,0.92)' : 'rgba(0,0,0,0.55)',
              borderColor: added ? 'rgba(255,209,102,1)' : 'rgba(255,255,255,0.25)',
              color: added ? '#3a2400' : '#fff',
              fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, whiteSpace: 'nowrap',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }}>{added ? '✓ Added · tap to remove' : '+ Add to list'}</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Re-skinned chrome ───────────────────────────────────────────

  // Search bar — cinema paper field, stroked search glyph, optional dropdown.
  function SearchBar({ t, query, focused, suggestions, suggestionsTotal }) {
    const showDropdown = focused && suggestions.length > 0;
    return (
      <div style={{ padding: '0 18px 12px', position: 'relative' }}>
        <div style={{ position: 'relative', zIndex: 100 }}>
          <div style={{
            background: t.paper, borderRadius: 12, height: 48,
            padding: query ? '0 40px 0 14px' : '0 14px',
            border: `1px solid ${focused ? t.gold : t.border}`,
            boxShadow: t.shadowCard,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Icon name="search" size={18} color={t.text3} sw={2.2} />
            <span style={{ fontSize: 15, color: query ? t.text : t.text3, fontWeight: query ? 600 : 500 }}>
              {query || 'Search films, words, or actors…'}
            </span>
            {focused && (
              <span style={{
                display: 'inline-block', width: 1.5, height: 18, marginLeft: 1,
                background: t.gold, animation: 'wwCaret 1s steps(2) infinite',
              }} />
            )}
          </div>
          {query && (
            <div style={{
              position: 'absolute', right: 12, top: 0, bottom: 0,
              display: 'flex', alignItems: 'center', color: t.text3,
            }}><Icon name="close" size={16} color={t.text3} sw={2.4} /></div>
          )}

          {showDropdown && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
              background: t.paper, borderRadius: 12, border: `1px solid ${t.border}`,
              boxShadow: '0 18px 40px rgba(0,0,0,0.30)', zIndex: 1000, overflow: 'hidden',
            }}>
              {suggestions.map((m) => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                  borderBottom: `1px solid ${t.divider}`,
                }}>
                  <img src={POSTER(m.poster_path, 'w92')} alt="" style={{
                    width: 40, height: 60, borderRadius: 5, objectFit: 'cover', background: t.raised,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: SERIF, fontSize: 15, fontWeight: 600, color: t.text,
                      letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{m.title}</div>
                    <div style={{ fontSize: 12, color: t.text3, marginTop: 2, fontWeight: 600 }}>{m.release_date?.slice(0,4)}</div>
                  </div>
                </div>
              ))}
              <div style={{
                padding: '11px 12px', textAlign: 'center',
                fontSize: 12, fontWeight: 900, color: t.goldOnSurface,
                letterSpacing: 0.6, textTransform: 'uppercase',
              }}>See all {suggestionsTotal} results</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // "Intermission" ad slot — restyled from the old dashed grey box.
  function AdSlot({ t }) {
    return (
      <div style={{
        margin: '0 18px 14px', height: 58, borderRadius: 12,
        border: `1px dashed ${t.border}`, background: t.chipBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 10, color: t.text3, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase' }}>
          Advertisement
        </span>
      </div>
    );
  }

  // Level selector + sort chips — the old purple toggle (with the "Journey ·
  // Soon" pill, now removed) becomes a clean gold-accented control row.
  function ControlRow({ t, level, sort, dropdownOpen, levelOptions }) {
    const sorts = [
      { key: 'rating', label: 'Rating' },
      { key: 'popularity', label: 'Popularity' },
      { key: 'level', label: 'Level %' },
    ];
    return (
      <div style={{ position: 'relative', zIndex: 60 }}>
        {/* Level row */}
        <div style={{ padding: '0 18px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: t.text3, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            Showing at your level
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '7px 12px', borderRadius: 999,
            background: t.chipBgOn, color: t.chipTxtOn,
            fontSize: 12, fontWeight: 900, letterSpacing: 0.3,
          }}>
            <Icon name="star" size={12} color={t.chipTxtOn} />
            {level} · Your level
            <Icon name="chevron" size={13} color={t.chipTxtOn} sw={2.6} />
          </div>
        </div>

        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: 38, right: 18, zIndex: 200,
            background: t.paper, borderRadius: 12, minWidth: 200,
            border: `1px solid ${t.border}`, boxShadow: '0 18px 40px rgba(0,0,0,0.30)', overflow: 'hidden',
          }}>
            {levelOptions.map((opt, i, arr) => {
              const active = opt.value === level;
              return (
                <div key={opt.value} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 14px',
                  borderBottom: i < arr.length - 1 ? `1px solid ${t.divider}` : 'none',
                  background: active ? (t === TOKENS.dark ? 'rgba(255,209,102,0.10)' : 'rgba(197,139,27,0.10)') : 'transparent',
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: CEFR[opt.value] }} />
                  <span style={{ fontSize: 14, fontWeight: active ? 800 : 600, color: active ? t.goldOnSurface : t.text }}>{opt.label}</span>
                  {active && <span style={{ marginLeft: 'auto' }}><Icon name="check" size={15} color={t.goldOnSurface} sw={2.6} /></span>}
                </div>
              );
            })}
          </div>
        )}

        {/* Sort chips */}
        <div style={{ padding: '0 18px 12px', display: 'flex', gap: 7 }}>
          {sorts.map((s) => {
            const on = s.key === sort;
            return (
              <div key={s.key} style={{
                padding: '7px 13px', borderRadius: 999, whiteSpace: 'nowrap',
                background: on ? t.chipBgOn : t.chipBg, color: on ? t.chipTxtOn : t.text2,
                fontSize: 12, fontWeight: 800, letterSpacing: 0.2,
                border: on ? 'none' : `1px solid ${t.border}`,
              }}>{s.label}{on ? ' ↓' : ''}</div>
            );
          })}
        </div>
      </div>
    );
  }

  // Today's Word — cinema paper card. Stroked bookmark icon, no ★/☆ glyphs.
  function TodaysWord({ t, word, saved }) {
    if (!word) return null;
    return (
      <div style={{
        margin: '4px 18px 0', padding: 18, borderRadius: 14,
        background: t.paper, border: `1px solid ${t.border}`, boxShadow: t.shadowCard,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: t.goldOnSurface, letterSpacing: 1.8, textTransform: 'uppercase' }}>Today's word</span>
          <span style={{ fontSize: 11, color: t.text3, fontWeight: 600 }}>from {word.movie_title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
          <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, color: t.text, letterSpacing: -0.6, lineHeight: 1 }}>{word.word}</div>
          <div style={{ fontSize: 12, fontStyle: 'italic', color: t.text3, fontWeight: 600 }}>{word.pos}</div>
        </div>
        <div style={{ fontSize: 14, color: t.text2, lineHeight: 1.45, marginBottom: 8 }}>{word.definition}</div>
        <div style={{ fontSize: 13, color: t.text3, fontStyle: 'italic', lineHeight: 1.4, marginBottom: 14 }}>"{word.example_sentence}"</div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '11px 16px', borderRadius: 10,
          border: `1px solid ${saved ? t.success : t.gold}`,
          background: saved ? (t === TOKENS.dark ? 'rgba(76,175,154,0.12)' : 'rgba(63,139,123,0.10)') : 'transparent',
          color: saved ? t.success : t.goldOnSurface,
        }}>
          <Icon name={saved ? 'check' : 'bookmark'} size={16} color={saved ? t.success : t.goldOnSurface} sw={2.2} fill={saved ? 'none' : 'none'} />
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.2 }}>{saved ? 'Saved to your words' : 'Save this word'}</span>
        </div>
      </div>
    );
  }

  // Floating "Continue watching" pill above the nav.
  function ContinuePill({ t, movie }) {
    if (!movie) return null;
    return (
      <div style={{
        position: 'absolute', left: 16, right: 16, bottom: 90,
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'rgba(14,12,18,0.86)', borderRadius: 16, padding: '8px 14px 8px 8px',
        border: '1px solid rgba(255,209,102,0.30)', backdropFilter: 'blur(10px)',
        boxShadow: '0 12px 28px rgba(0,0,0,0.40)',
      }}>
        <img src={POSTER(movie.poster_path, 'w92')} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 900, color: '#FFD166', letterSpacing: 1.4 }}>CONTINUE · {movie.progress}%</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{movie.title}</div>
        </div>
        <div style={{
          width: 34, height: 34, borderRadius: 17, background: '#FFD166', color: '#3a2400',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}><Icon name="play" size={16} color="#3a2400" /></div>
      </div>
    );
  }

  function BottomNav({ t, active='home' }) {
    const items = [
      { id:'home', label:'Home', icon:'home' },
      { id:'movies', label:'My Movies', icon:'film' },
      { id:'practice', label:'Practice', icon:'spark' },
      { id:'profile', label:'Profile', icon:'user' },
    ];
    return (
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 78, paddingBottom: 18, paddingTop: 8,
        background: t.tabBg, borderTop: `1px solid ${t.tabBorder}`,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around',
      }}>
        {items.map((it) => {
          const on = it.id === active;
          return (
            <div key={it.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <Icon name={it.icon} size={22} color={on ? t.gold : t.text3} sw={1.9} fill={it.icon === 'spark' && on ? t.gold : 'none'} />
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: on ? t.text : t.text3 }}>{it.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Screen ──────────────────────────────────────────────────────
  function HomeScreen({ mode='dark', scenario='default' }) {
    const t = TOKENS[mode];
    const D = window.WW_HOME_DATA;
    const searchActive = scenario === 'search';

    return (
      <div style={{
        width: '100%', height: '100%', background: t.bg, color: t.text,
        fontFamily: SANS, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative',
      }}>
        {/* warm top glow */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 240, background: t.heroGlow, pointerEvents: 'none' }} />

        {/* status-bar inset */}
        <div style={{ height: 62, flexShrink: 0, position: 'relative', zIndex: 2 }} />

        {/* Header */}
        <div style={{
          padding: '4px 18px 12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          position: 'relative', zIndex: 2,
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2, color: t.goldOnSurface, textTransform: 'uppercase', marginBottom: 4 }}>
              Your feed · {D.userLevel} level
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, letterSpacing: -0.8, color: t.text, lineHeight: 1 }}>
              Now Showing
            </div>
          </div>
          <div style={{
            width: 38, height: 38, borderRadius: 19, position: 'relative',
            background: t.chipBg, border: `1px solid ${t.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.text2,
          }}>
            <Icon name="bell" size={16} color={t.text2} />
            <div style={{ position: 'absolute', top: 7, right: 9, width: 7, height: 7, borderRadius: 4, background: t.gold, border: `1.5px solid ${t.bg}` }} />
          </div>
        </div>

        {/* Scroll body */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 150, position: 'relative', zIndex: 1 }}>
          <SearchBar t={t} query={searchActive ? 'the dark' : ''} focused={searchActive}
            suggestions={searchActive ? D.searchSuggestions : []} suggestionsTotal={D.searchSuggestionsTotal} />

          {!searchActive && <AdSlot t={t} />}

          <ControlRow t={t} level={D.userLevel} sort="rating" dropdownOpen={false} levelOptions={D.levelOptions} />

          {/* Ranked feed — the cards are unchanged */}
          <div style={{ padding: '0 18px' }}>
            {D.movies.map((m, i) => (
              <MovieCard key={m.id} movie={m} added={i === 1} />
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <TodaysWord t={t} word={D.todaysWord} saved={false} />
          </div>
          <div style={{ height: 24 }} />
        </div>

        {!searchActive && <ContinuePill t={t} movie={D.lastOpenedMovie} />}
        <BottomNav t={t} active="home" />
      </div>
    );
  }

  window.WW_HOME = { HomeScreen };
})();
