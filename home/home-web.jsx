/* WordWise Web — Home (desktop).
   Desktop counterpart to the mobile ranked-feed home. Uses the shared web
   shell (always-dark "cinema lobby" sidebar + top bar + page header). The
   ranked movie cards keep the exact RankedMovieList treatment (backdrop +
   0.52 scrim, poster-left, rating · level · words, "+ Add to list" chip) —
   only widened for the desktop row. A right rail carries Today's Word +
   Continue. All glyphs are stroked SVG icons; no emoji.
*/

(function () {
  const { useState } = React;
  const { WW_TOKENS, CEFR, SERIF, SANS, MONO, TMDB, TMDB_BIG, Sidebar, TopBar, PageHeader } = window.WW_WEB_SHELL;

  const POSTER  = (p, w='w185') => p ? `https://image.tmdb.org/t/p/${w}${p}` : null;
  const BACKDROP= (p) => p ? `https://image.tmdb.org/t/p/w780${p}` : null;

  function scoreToCefr(score) {
    if (score == null) return null;
    if (score < 30) return 'A1';
    if (score < 45) return 'A2';
    if (score < 60) return 'B1';
    if (score < 75) return 'B2';
    if (score < 90) return 'C1';
    return 'C2';
  }

  function WIcon({ name, size=18, color='currentColor', sw=2, fill='none' }) {
    const p = { width:size, height:size, viewBox:'0 0 24 24', fill, stroke:color, strokeWidth:sw, strokeLinecap:'round', strokeLinejoin:'round' };
    switch (name) {
      case 'chevron': return <svg {...p}><path d="M6 9l6 6 6-6"/></svg>;
      case 'play':    return <svg {...p} fill={color} stroke="none"><path d="M8 5v14l11-7z"/></svg>;
      case 'bookmark':return <svg {...p}><path d="M6 4h12v16l-6-4-6 4z"/></svg>;
      case 'star':    return <svg {...p} fill={color} stroke="none"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.3L12 17.3 6.4 20.3l1.1-6.3L3 9.6l6.2-.9z"/></svg>;
      case 'plus':    return <svg {...p} sw={3}><path d="M12 5v14M5 12h14"/></svg>;
      default: return null;
    }
  }

  const MOVIES = (window.WW_HOME_DATA && window.WW_HOME_DATA.movies) || [];
  const TODAY  = (window.WW_HOME_DATA && window.WW_HOME_DATA.todaysWord) || null;
  const CONT   = (window.WW_HOME_DATA && window.WW_HOME_DATA.lastOpenedMovie) || null;

  // ── Ranked card (web row) — same treatment as RankedMovieList ────
  function MovieRow({ movie, rank, added, t }) {
    const rating = movie.vote_average > 0 ? `★ ${Number(movie.vote_average).toFixed(1)}` : null;
    const cefr   = scoreToCefr(movie.difficulty_score);
    const level  = cefr && movie.difficulty_score != null ? `${cefr} ${movie.difficulty_score}%` : null;
    const wordCount = movie.unique_words > 0 ? `${movie.unique_words} words` : null;
    return (
      <div style={{
        height: 132, borderRadius: 16, overflow: 'hidden', position: 'relative',
        boxShadow: t.shadowCard, cursor: 'pointer',
        backgroundImage: `url(${BACKDROP(movie.backdrop_path)})`,
        backgroundColor: '#000', backgroundSize: 'cover', backgroundPosition: 'center',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.5) 55%, rgba(0,0,0,0.42) 100%)' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '100%', padding: '0 18px', gap: 16 }}>
          {/* rank numeral */}
          <div style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 700, color: 'rgba(255,255,255,0.45)', width: 34, textAlign: 'center', flexShrink: 0 }}>{rank}</div>
          <img src={POSTER(movie.poster_path)} alt="" style={{ width: 74, height: 104, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#fff', lineHeight: 1.2, marginBottom: 6, letterSpacing: -0.2 }}>{movie.title}</div>
            {(rating || level) && (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', fontWeight: 600, marginBottom: 3 }}>{[rating, level].filter(Boolean).join('   •   ')}</div>
            )}
            {wordCount && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.66)', fontFamily: MONO, fontWeight: 700 }}>{wordCount}</div>}
          </div>
          {/* + Add chip */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 999, border: '1px solid', flexShrink: 0,
            background: added ? 'rgba(255,209,102,0.95)' : 'rgba(0,0,0,0.5)',
            borderColor: added ? 'rgba(255,209,102,1)' : 'rgba(255,255,255,0.28)',
            color: added ? '#3a2400' : '#fff',
            fontSize: 12, fontWeight: 800, letterSpacing: 0.3, whiteSpace: 'nowrap',
          }}>
            <WIcon name={added ? 'star' : 'plus'} size={13} color={added ? '#3a2400' : '#fff'} sw={3} />
            {added ? 'Added' : 'Add to list'}
          </div>
        </div>
      </div>
    );
  }

  function LevelPill({ t, level }) {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 16px', borderRadius: 999, background: t.gold, color: t.goldDeep,
        fontSize: 13, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer',
        boxShadow: '0 8px 18px rgba(255,209,102,0.28)',
      }}>
        <WIcon name="star" size={13} color={t.goldDeep} />
        {level} · Your level
        <WIcon name="chevron" size={14} color={t.goldDeep} sw={2.6} />
      </div>
    );
  }

  function TodayCard({ t, word }) {
    if (!word) return null;
    return (
      <div style={{ background: t.paper, border: `1px solid ${t.border}`, borderRadius: 14, padding: 20, boxShadow: t.shadowCard }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: t.goldOnSurface, letterSpacing: 1.8, textTransform: 'uppercase' }}>Today's word</span>
          <span style={{ fontSize: 11, color: t.text3, fontWeight: 600 }}>from {word.movie_title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <div style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 700, color: t.text, letterSpacing: -0.8, lineHeight: 1 }}>{word.word}</div>
          <div style={{ fontSize: 13, fontStyle: 'italic', color: t.text3, fontWeight: 600 }}>{word.pos}</div>
        </div>
        <div style={{ fontSize: 14, color: t.text2, lineHeight: 1.5, marginBottom: 10 }}>{word.definition}</div>
        <div style={{ fontSize: 13, color: t.text3, fontStyle: 'italic', lineHeight: 1.45, marginBottom: 16 }}>"{word.example_sentence}"</div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '11px 16px', borderRadius: 10, border: `1px solid ${t.gold}`, color: t.goldOnSurface, cursor: 'pointer',
        }}>
          <WIcon name="bookmark" size={16} color={t.goldOnSurface} sw={2.2} />
          <span style={{ fontSize: 14, fontWeight: 800 }}>Save this word</span>
        </div>
      </div>
    );
  }

  function ContinueCard({ t, movie }) {
    if (!movie) return null;
    return (
      <div style={{
        position: 'relative', borderRadius: 14, overflow: 'hidden', boxShadow: t.shadowCard,
        backgroundImage: `url(${POSTER(movie.poster_path, 'w500')})`, backgroundSize: 'cover', backgroundPosition: 'center top',
        minHeight: 120,
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.85))' }} />
        <div style={{ position: 'relative', padding: 16, display: 'flex', alignItems: 'flex-end', gap: 12, minHeight: 120 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: '#FFD166', letterSpacing: 1.4 }}>CONTINUE · {movie.progress}%</div>
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: -0.3, lineHeight: 1.1, marginTop: 4 }}>{movie.title}</div>
            <div style={{ marginTop: 8, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.2)', overflow: 'hidden', maxWidth: 180 }}>
              <div style={{ width: `${movie.progress}%`, height: '100%', background: '#FFD166', borderRadius: 999 }} />
            </div>
          </div>
          <div style={{ width: 42, height: 42, borderRadius: 21, background: '#FFD166', color: '#3a2400', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <WIcon name="play" size={18} color="#3a2400" />
          </div>
        </div>
      </div>
    );
  }

  function HomeWeb({ mode='dark', onToggleMode }) {
    const t = WW_TOKENS[mode];
    const sorts = ['Rating', 'Popularity', 'Level %'];
    const [sort] = useState('Rating');
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: t.bg, color: t.text, fontFamily: SANS, overflow: 'hidden' }}>
        <Sidebar active="home" t={t} mode={mode} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <TopBar t={t} mode={mode} onToggleMode={onToggleMode} />
          <PageHeader
            eyebrow={`Your feed · ${(window.WW_HOME_DATA||{}).userLevel || 'B1'} level`}
            title="Now Showing"
            subtitle="Top-rated films matched to your level. Add any to your list to start learning its words."
            t={t}
            right={<LevelPill t={t} level={(window.WW_HOME_DATA||{}).userLevel || 'B1'} />}
          />

          <div style={{ flex: 1, padding: '0 32px 32px', display: 'flex', gap: 28, overflowY: 'auto' }}>
            {/* Feed column */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${t.divider}` }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4, color: t.text3, textTransform: 'uppercase' }}>
                  {MOVIES.length} films at your level
                </div>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: t.text3, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>Sort</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {sorts.map((s) => {
                    const on = s === sort;
                    return (
                      <div key={s} style={{
                        padding: '6px 13px', borderRadius: 999, fontSize: 12, fontWeight: 800,
                        background: on ? t.chipBgOn : t.chipBg, color: on ? t.chipTxtOn : t.text2,
                        border: on ? 'none' : `1px solid ${t.border}`, cursor: 'pointer',
                      }}>{s}{on ? ' ↓' : ''}</div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {MOVIES.map((m, i) => (
                  <MovieRow key={m.id} movie={m} rank={i + 1} added={i === 1} t={t} />
                ))}
              </div>
            </div>

            {/* Right rail */}
            <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <ContinueCard t={t} movie={CONT} />
              <TodayCard t={t} word={TODAY} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.WW_WEB_HOME = { HomeWeb };
})();
