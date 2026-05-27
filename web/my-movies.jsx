/* WordWise Web — My Movies tab.
   Desktop layout: sidebar nav (always dark) + main content. Movies render
   as a 4-column poster grid (hover scales + reveals progress overlay),
   with a left filter rail and a top tool row (sort + view-toggle).
*/

(function () {
  const { useState } = React;
  const { WW_TOKENS, CEFR, SERIF, SANS, MONO, TMDB, Sidebar, TopBar, PageHeader } = window.WW_WEB_SHELL;

  // Sample movies (same shape as mobile data, padded for grid density)
  const MOVIES = [
    { id:496243, title:'Parasite',                          year:2019, dir:'Bong Joon-ho',    rt:'2h 12m', level:'B2', poster:'/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', progress:72,  added:2,   words:142, known:102 },
    { id:1018494,title:'Past Lives',                        year:2023, dir:'Celine Song',     rt:'1h 45m', level:'B1', poster:'/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg', progress:100, added:5,   words:78,  known:78 },
    { id:680,    title:'Pulp Fiction',                      year:1994, dir:'Q. Tarantino',    rt:'2h 34m', level:'C1', poster:'/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg', progress:18,  added:8,   words:210, known:38 },
    { id:155,    title:'The Dark Knight',                   year:2008, dir:'C. Nolan',        rt:'2h 32m', level:'B2', poster:'/qJ2tW6WMUDux911r6m7haRef0WH.jpg', progress:44,  added:14,  words:168, known:74 },
    { id:545611, title:'Everything Everywhere All At Once', year:2022, dir:'Daniels',         rt:'2h 19m', level:'B2', poster:'/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg', progress:31,  added:21,  words:186, known:58 },
    { id:129,    title:'Spirited Away',                     year:2001, dir:'H. Miyazaki',     rt:'2h 5m',  level:'A2', poster:'/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', progress:88,  added:30,  words:92,  known:81 },
    { id:278,    title:'The Shawshank Redemption',          year:1994, dir:'F. Darabont',     rt:'2h 22m', level:'B1', poster:'/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg', progress:6,   added:1,   words:154, known:9 },
    { id:238,    title:'The Godfather',                     year:1972, dir:'F.F. Coppola',    rt:'2h 55m', level:'C1', poster:'/3bhkrj58Vtu7enYsRolD1fZdja1.jpg', progress:0,   added:0,   words:228, known:0 },
    { id:637,    title:'Life Is Beautiful',                 year:1997, dir:'R. Benigni',      rt:'1h 56m', level:'B1', poster:'/74hLDKjD5aGYOotO6esUVaeISa2.jpg', progress:100, added:90,  words:132, known:132 },
    { id:1359977,title:'Conclave',                          year:2024, dir:'E. Berger',       rt:'2h 0m',  level:'C1', poster:'/gv8PD1vGnHfZGbKCWHGOT6IXtxL.jpg', progress:12,  added:4,   words:164, known:19 },
    { id:603,    title:'The Matrix',                        year:1999, dir:'Wachowskis',      rt:'2h 16m', level:'B2', poster:'/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', progress:55,  added:11,  words:158, known:87 },
    { id:13,     title:'Forrest Gump',                      year:1994, dir:'R. Zemeckis',     rt:'2h 22m', level:'B1', poster:'/h5J4W4veyxMXDMjeNxZI46TsHOb.jpg', progress:0,   added:0,   words:194, known:0 },
  ];

  function MovieCard({ m, t }) {
    const cefr = CEFR[m.level];
    const ratio = `${m.known}/${m.words}`;
    return (
      <div style={{
        background: t.paper, border: `1px solid ${t.border}`,
        borderRadius: 12, overflow: 'hidden',
        boxShadow: t.shadowCard,
        display: 'flex', flexDirection: 'column',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}>
        {/* Poster */}
        <div style={{
          position: 'relative', aspectRatio: '2/3',
          background: t.raised,
        }}>
          <img src={TMDB(m.poster)} alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />

          {/* CEFR badge top-left */}
          <div style={{
            position: 'absolute', top: 10, left: 10,
            background: cefr, color: '#fff',
            fontSize: 10, fontWeight: 900, padding: '2px 7px', borderRadius: 4,
            letterSpacing: 0.4,
            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
          }}>{m.level}</div>

          {/* Mastered ribbon */}
          {m.progress === 100 ? (
            <div style={{
              position: 'absolute', top: 10, right: 10,
              background: '#FFD166', color: '#3a2400',
              fontSize: 9, fontWeight: 900, padding: '2px 6px', borderRadius: 3,
              letterSpacing: 0.4, border: '1px solid #3a2400',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            }}>FINAL CUT</div>
          ) : null}

          {/* Bottom gradient with progress */}
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            padding: '24px 12px 10px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0) 100%)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <div style={{
                flex: 1, height: 3, borderRadius: 999,
                background: 'rgba(255,255,255,0.15)', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${m.progress}%`, height: '100%',
                  background: m.progress === 100 ? '#FFD166' : cefr,
                  borderRadius: 999,
                }} />
              </div>
              <div style={{ fontSize: 10, fontFamily: MONO, fontWeight: 900, color: '#fff', minWidth: 28, textAlign: 'right' }}>
                {m.progress}%
              </div>
            </div>
            <div style={{ fontSize: 9, fontFamily: MONO, fontWeight: 800, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.4 }}>
              {ratio} WORDS · {m.rt}
            </div>
          </div>
        </div>

        {/* Meta */}
        <div style={{ padding: '12px 14px 14px' }}>
          <div style={{
            fontFamily: SERIF, fontSize: 16, fontWeight: 600, color: t.text,
            letterSpacing: -0.3, lineHeight: 1.15,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{m.title}</div>
          <div style={{ fontSize: 11.5, color: t.text3, fontWeight: 700, marginTop: 4, letterSpacing: 0.2 }}>
            {m.year} · {m.dir}
          </div>
        </div>
      </div>
    );
  }

  function FilterRail({ t, activeChip, setActiveChip }) {
    const Section = ({ title, items, multi }) => (
      <div style={{ marginBottom: 22 }}>
        <div style={{
          fontSize: 10.5, fontWeight: 900, letterSpacing: 1.8,
          color: t.text3, textTransform: 'uppercase', marginBottom: 10,
        }}>{title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map((it) => {
            const on = it.value === activeChip;
            return (
              <div key={it.value} onClick={() => setActiveChip(it.value)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px', borderRadius: 6,
                background: on ? t.primaryT : 'transparent',
                color: on ? t.text : t.text2, fontSize: 13, fontWeight: 700,
                cursor: 'pointer',
              }}>
                {it.swatch ? (
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: it.swatch }} />
                ) : null}
                <span style={{ flex: 1 }}>{it.label}</span>
                <span style={{ fontSize: 11, color: t.text3, fontFamily: MONO, fontWeight: 700 }}>{it.count}</span>
              </div>
            );
          })}
        </div>
      </div>
    );

    return (
      <aside style={{
        width: 220, flexShrink: 0,
        padding: '8px 0 24px 0',
      }}>
        <Section
          title="Status"
          items={[
            { value: 'All',          label: 'All films',   count: '10' },
            { value: 'In progress',  label: 'In progress', count: '6' },
            { value: 'Mastered',     label: 'Mastered',    count: '2' },
            { value: 'Not started',  label: 'Not started', count: '2' },
          ]}
        />
        <Section
          title="Level"
          items={[
            { value: 'A2', label: 'A2 Elementary',    count: '1', swatch: CEFR.A2 },
            { value: 'B1', label: 'B1 Intermediate',  count: '4', swatch: CEFR.B1 },
            { value: 'B2', label: 'B2 Upper Int.',    count: '3', swatch: CEFR.B2 },
            { value: 'C1', label: 'C1 Advanced',      count: '2', swatch: CEFR.C1 },
          ]}
        />
        <Section
          title="Added"
          items={[
            { value: 'today', label: 'Today',         count: '1' },
            { value: 'week',  label: 'This week',     count: '4' },
            { value: 'month', label: 'This month',    count: '7' },
            { value: 'older', label: 'Older',         count: '3' },
          ]}
        />
      </aside>
    );
  }

  function MyMoviesWeb({ mode = 'dark', onToggleMode }) {
    const t = WW_TOKENS[mode];
    const [activeChip, setActiveChip] = useState('All');
    const [sort, setSort] = useState('Recently added');

    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: t.bg, color: t.text, fontFamily: SANS, overflow: 'hidden' }}>
        <Sidebar active="movies" t={t} mode={mode} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <TopBar t={t} mode={mode} onToggleMode={onToggleMode} />

          <PageHeader
            eyebrow="Your library"
            title="My Movies"
            subtitle="Films you're learning from. Click any poster to study its words or start a quick quiz."
            t={t}
            right={
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                padding: '10px 18px', borderRadius: 10,
                background: t.gold, color: t.goldDeep,
                fontSize: 13, fontWeight: 900, letterSpacing: 0.4,
                boxShadow: '0 8px 18px rgba(255,209,102,0.30)',
                cursor: 'pointer',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                ADD A FILM
              </div>
            }
          />

          {/* Stat row */}
          <div style={{
            margin: '0 32px 24px', padding: '16px 22px',
            borderRadius: 12, background: t.paper, border: `1px solid ${t.border}`,
            boxShadow: t.shadowCard,
            display: 'flex', gap: 32, alignItems: 'center',
          }}>
            {[
              { n: '10',  l: 'Films in library' },
              { n: '124', l: 'Words known' },
              { n: '38%', l: 'Avg comprehension', accent: true },
              { n: '12',  l: 'Words due today', accent2: true },
            ].map((s, i, arr) => (
              <React.Fragment key={i}>
                <div>
                  <div style={{
                    fontFamily: SERIF, fontSize: 26, fontWeight: 700, lineHeight: 1,
                    color: s.accent ? t.goldOnSurface : s.accent2 ? t.primary : t.text,
                  }}>{s.n}</div>
                  <div style={{ fontSize: 11, color: t.text3, marginTop: 4, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 800 }}>{s.l}</div>
                </div>
                {i < arr.length - 1 ? <div style={{ width: 1, height: 32, background: t.divider }} /> : null}
              </React.Fragment>
            ))}
            <div style={{ flex: 1 }} />
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', borderRadius: 999,
              background: t.primaryT, color: t.primary, fontSize: 12, fontWeight: 900,
              letterSpacing: 0.4, textTransform: 'uppercase', cursor: 'pointer',
              border: `1px solid ${t.primary}`,
            }}>
              <span>📚</span> Practice 12 words →
            </div>
          </div>

          {/* Body: filter rail + grid */}
          <div style={{ flex: 1, padding: '0 32px 32px', display: 'flex', gap: 24, overflowY: 'auto' }}>
            <FilterRail t={t} activeChip={activeChip} setActiveChip={setActiveChip} />

            <div style={{ flex: 1 }}>
              {/* Toolbar */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingBottom: 12,
                borderBottom: `1px solid ${t.divider}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4, color: t.text3, textTransform: 'uppercase' }}>
                  Showing 10 of 10 films
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: t.text3, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>Sort</span>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 8,
                    background: t.chipBg, border: `1px solid ${t.border}`,
                    fontSize: 12, fontWeight: 800, color: t.text,
                  }}>{sort} <span style={{ fontSize: 9, color: t.text3 }}>▼</span></div>
                </div>
                {/* view toggle */}
                <div style={{ display: 'flex', gap: 0, border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  {['grid','list'].map((v, i) => (
                    <div key={v} style={{
                      padding: '7px 10px', background: v === 'grid' ? t.chipBg : 'transparent',
                      color: v === 'grid' ? t.text : t.text3, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRight: i === 0 ? `1px solid ${t.border}` : 'none',
                    }}>
                      {v === 'grid' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Grid */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18,
              }}>
                {MOVIES.map((m) => <MovieCard key={m.id} m={m} t={t} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.WW_WEB_MY_MOVIES = { MyMoviesWeb };
})();
