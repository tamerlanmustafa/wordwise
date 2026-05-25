/* WordWise — Quiz Screens
   Two card types: synonym MCQ + translation typing.
   Multiple visual states per type so the Claude Code prompt has
   reference for prompt / correct / wrong / revealed.

   Mode: 'dark' | 'light'.
*/

(function () {
  const { useState } = React;

  // Same token shape as the other screens.
  const TOKENS = {
    dark: {
      bg:'#0e0d10', paper:'#1a1a24', surface:'#1F1F30', raised:'#23223a',
      border:'rgba(255,255,255,0.10)', divider:'rgba(255,255,255,0.06)',
      text:'#ffffff', text2:'rgba(255,255,255,0.72)', text3:'rgba(255,255,255,0.45)',
      primary:'#9B7ED9', primaryT:'rgba(124,92,191,0.20)',
      gold:'#FFD166', goldOnSurface:'#FFD166', goldDeep:'#3a2400',
      success:'#4CAF9A', successTint:'rgba(76,175,154,0.20)', successBorder:'rgba(76,175,154,0.55)',
      error:'#E57373',  errorTint:'rgba(229,115,115,0.18)',   errorBorder:'rgba(229,115,115,0.55)',
      chipBg:'rgba(255,255,255,0.06)', wordBox:'#0a090d',
      shadowCard:'0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 28px rgba(0,0,0,0.45)',
    },
    light: {
      bg:'#F4EFE3', paper:'#FFFFFF', surface:'#FFFFFF', raised:'#FFFFFF',
      border:'#E5DCC4', divider:'#EEE6D2',
      text:'#2D2418', text2:'#6E5F47', text3:'#9C8E72',
      primary:'#7C5CBF', primaryT:'rgba(124,92,191,0.10)',
      gold:'#C58B1B', goldOnSurface:'#8B5A00', goldDeep:'#3a2400',
      success:'#3F8B7B', successTint:'rgba(63,139,123,0.14)', successBorder:'rgba(63,139,123,0.55)',
      error:'#D66A6A',  errorTint:'rgba(214,106,106,0.16)',   errorBorder:'rgba(214,106,106,0.55)',
      chipBg:'#EEE6D2', wordBox:'#FAF7EE',
      shadowCard:'0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 14px rgba(60,40,10,0.10)',
    },
  };

  const CEFR = { A1:'#4CAF50', A2:'#8BC34A', B1:'#FFC107', B2:'#FF9800', C1:'#F44336', C2:'#9C27B0' };

  const SERIF = `'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif`;
  const SANS  = `-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', system-ui, sans-serif`;
  const MONO  = `'JetBrains Mono', 'SF Mono', Menlo, monospace`;

  // ── Shared header used by every quiz card ──────────────────────
  function QuizHeader({ t, movie, level, indexN, total }) {
    const pct = (indexN / total) * 100;
    const cefr = CEFR[level];
    return (
      <div>
        <div style={{ height: 62, flexShrink: 0 }} />
        {/* top row: back · chip · counter */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 18px 12px',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 18,
            background: t.chipBg, border: `1px solid ${t.border}`,
            color: t.text2, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6"/>
            </svg>
          </div>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', borderRadius: 999,
            background: t.paper, border: `1.5px solid ${t.gold}`,
            boxShadow: t.shadowCard,
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: 3, background: cefr,
              color: '#fff', fontSize: 8, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              letterSpacing: 0.3,
            }}>{level}</div>
            <span style={{ fontFamily: SERIF, fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: -0.2, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{movie}</span>
          </div>

          <div style={{
            minWidth: 36, height: 36, padding: '0 8px', borderRadius: 18,
            background: t.chipBg, border: `1px solid ${t.border}`,
            color: t.text2, fontSize: 11, fontWeight: 900, fontFamily: MONO,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{indexN}/{total}</div>
        </div>

        {/* progress bar */}
        <div style={{ padding: '0 18px 14px' }}>
          <div style={{
            height: 4, borderRadius: 999, background: t.divider, overflow: 'hidden',
          }}>
            <div style={{ width: `${pct}%`, height: '100%', background: t.gold, borderRadius: 999 }} />
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Synonym MCQ
  // ─────────────────────────────────────────────────────────────────
  function MCQChoice({ t, label, state }) {
    // state: idle | selected | correct | wrong | reveal-correct
    const isCorrect = state === 'correct' || state === 'reveal-correct';
    const isWrong = state === 'wrong';
    const border =
      isCorrect ? t.successBorder :
      isWrong   ? t.errorBorder :
      t.border;
    const bg =
      isCorrect ? t.successTint :
      isWrong   ? t.errorTint :
      t.paper;
    const fg =
      isCorrect ? t.success :
      isWrong   ? t.error :
      t.text;

    return (
      <div style={{
        padding: '18px 14px',
        borderRadius: 14,
        border: `2px solid ${border}`,
        background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: state === 'idle' ? t.shadowCard : 'none',
        position: 'relative',
      }}>
        <span style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600, color: fg, letterSpacing: -0.2 }}>{label}</span>
        {isCorrect ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={t.success} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l4 4 10-10" />
          </svg>
        ) : isWrong ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={t.error} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : null}
      </div>
    );
  }

  function SynonymMCQScreen({ mode = 'dark', state = 'idle' }) {
    // state: 'idle' | 'wrong' (user picked "yell", correct = "talk softly")
    const t = TOKENS[mode];
    const word = 'whisper';
    const movie = 'Past Lives';
    const level = 'B1';

    const choices = [
      { label: 'shout',          s: 'idle' },
      { label: 'talk softly',    s: state === 'wrong' ? 'reveal-correct' : 'idle' },
      { label: 'yell',           s: state === 'wrong' ? 'wrong' : 'idle' },
      { label: 'sing loudly',    s: 'idle' },
    ];

    return (
      <div style={{
        width: '100%', height: '100%', background: t.bg, color: t.text,
        fontFamily: SANS, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative',
      }}>
        <QuizHeader t={t} movie={movie} level={level} indexN={3} total={5} />

        <div style={{ flex: 1, padding: '4px 18px', overflowY: 'auto' }}>
          {/* Prompt label */}
          <div style={{
            fontSize: 11, fontWeight: 900, letterSpacing: 1.8, color: t.goldOnSurface,
            textTransform: 'uppercase', textAlign: 'center', marginTop: 6,
          }}>Pick the synonym</div>

          {/* Word card */}
          <div style={{
            margin: '16px 0 22px',
            padding: '28px 20px',
            borderRadius: 18,
            background: t.wordBox,
            border: `1px solid ${t.border}`,
            boxShadow: t.shadowCard,
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: SERIF, fontSize: 36, fontWeight: 600, color: t.text,
              letterSpacing: -0.6, lineHeight: 1.05,
            }}>{word}</div>
            <div style={{ fontSize: 12, color: t.text3, fontStyle: 'italic', marginTop: 8, fontWeight: 600 }}>
              verb · "She whispered her name in the dark."
            </div>
          </div>

          {/* 4 choices */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {choices.map((c, i) => <MCQChoice key={i} t={t} label={c.label} state={c.s} />)}
          </div>

          {/* Footer status / CTA */}
          {state === 'wrong' ? (
            <div style={{
              marginTop: 22, padding: '14px 16px', borderRadius: 12,
              background: t.errorTint, border: `1px solid ${t.errorBorder}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.4, color: t.error, textTransform: 'uppercase' }}>
                Not quite
              </div>
              <div style={{ fontSize: 13, color: t.text, marginTop: 4, fontWeight: 600 }}>
                <span style={{ color: t.success, fontWeight: 800 }}>talk softly</span> is the closest synonym.
              </div>
            </div>
          ) : null}
        </div>

        {/* Sticky bottom CTA */}
        <div style={{
          padding: '12px 18px 24px',
          background: t.bg, borderTop: `1px solid ${t.divider}`,
        }}>
          <div style={{
            background: state === 'wrong' ? t.error : t.gold,
            color: state === 'wrong' ? '#fff' : t.goldDeep,
            padding: '14px 16px', borderRadius: 14,
            textAlign: 'center', fontWeight: 900, fontSize: 14, letterSpacing: 0.6,
            textTransform: 'uppercase',
            boxShadow: '0 10px 24px rgba(0,0,0,0.25)',
          }}>{state === 'wrong' ? 'Got it · Continue →' : 'Check answer'}</div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Translation typing
  // ─────────────────────────────────────────────────────────────────
  function TranslationTypeScreen({ mode = 'dark', state = 'prompt' }) {
    // state: 'prompt' | 'correct'
    const t = TOKENS[mode];
    const word = 'phosphorescent';
    const translation = 'фосфоресцентный';
    const movie = 'Past Lives';
    const level = 'B2';

    const isCorrect = state === 'correct';

    // input border + colors
    const inputBorder = isCorrect ? t.successBorder : t.border;
    const inputBg     = isCorrect ? t.successTint   : t.paper;
    const inputFg     = isCorrect ? t.success       : t.text;

    return (
      <div style={{
        width: '100%', height: '100%', background: t.bg, color: t.text,
        fontFamily: SANS, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative',
      }}>
        <QuizHeader t={t} movie={movie} level={level} indexN={4} total={5} />

        <div style={{ flex: 1, padding: '4px 18px', overflowY: 'auto' }}>
          <div style={{
            fontSize: 11, fontWeight: 900, letterSpacing: 1.8, color: t.goldOnSurface,
            textTransform: 'uppercase', textAlign: 'center', marginTop: 6,
          }}>Type the translation</div>

          {/* Word card */}
          <div style={{
            margin: '16px 0 22px',
            padding: '28px 20px',
            borderRadius: 18,
            background: t.wordBox,
            border: `1px solid ${t.border}`,
            boxShadow: t.shadowCard,
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: SERIF, fontSize: 34, fontWeight: 600, color: t.text,
              letterSpacing: -0.6, lineHeight: 1.05,
            }}>{word}</div>
            <div style={{ fontSize: 12, color: t.text3, fontStyle: 'italic', marginTop: 8, fontWeight: 600 }}>
              adj · "The phosphorescent waves glowed beneath the boat."
            </div>
          </div>

          {/* Hint chips */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center',
            marginBottom: 14,
          }}>
            {['adj.', '4 syllables', 'starts with "ф"'].map((h, i) => (
              <div key={i} style={{
                padding: '5px 10px', borderRadius: 999,
                background: t.chipBg, border: `1px solid ${t.border}`,
                fontSize: 11, fontWeight: 700, color: t.text2,
              }}>{h}</div>
            ))}
          </div>

          {/* Input */}
          <div style={{
            padding: '16px 16px',
            borderRadius: 14,
            background: inputBg,
            border: `2px solid ${inputBorder}`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <input
              defaultValue={isCorrect ? translation : ''}
              placeholder="Type the translation…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: inputFg, fontSize: 18, fontWeight: 600, fontFamily: SANS,
              }}
            />
            {isCorrect ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={t.success} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l4 4 10-10" />
              </svg>
            ) : (
              <div style={{
                width: 2, height: 22, background: t.primary,
                animation: 'wwCaret 1s steps(1) infinite',
              }} />
            )}
          </div>

          {/* Don't know link */}
          {!isCorrect ? (
            <div style={{
              textAlign: 'center', marginTop: 14,
              color: t.text3, fontSize: 12, fontWeight: 800, letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}>I don't know · skip</div>
          ) : null}

          {/* Correct callout */}
          {isCorrect ? (
            <div style={{
              marginTop: 22, padding: '14px 16px', borderRadius: 12,
              background: t.successTint, border: `1px solid ${t.successBorder}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.4, color: t.success, textTransform: 'uppercase' }}>
                Correct!
              </div>
              <div style={{ fontSize: 13, color: t.text, marginTop: 4, fontWeight: 600 }}>
                Added to your known words. +5 XP
              </div>
            </div>
          ) : null}
        </div>

        {/* Sticky bottom CTA */}
        <div style={{
          padding: '12px 18px 24px',
          background: t.bg, borderTop: `1px solid ${t.divider}`,
        }}>
          <div style={{
            background: isCorrect ? t.success : (mode === 'dark' ? 'rgba(255,255,255,0.10)' : t.chipBg),
            color: isCorrect ? '#fff' : t.text3,
            padding: '14px 16px', borderRadius: 14,
            textAlign: 'center', fontWeight: 900, fontSize: 14, letterSpacing: 0.6,
            textTransform: 'uppercase',
            boxShadow: isCorrect ? '0 10px 24px rgba(0,0,0,0.25)' : 'none',
            border: isCorrect ? 'none' : `1px solid ${t.border}`,
          }}>{isCorrect ? 'Continue →' : 'Check'}</div>
        </div>
      </div>
    );
  }

  window.WW_QUIZ = { SynonymMCQScreen, TranslationTypeScreen };
})();
