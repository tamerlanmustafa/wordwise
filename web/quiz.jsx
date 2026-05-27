/* WordWise Web — Quiz screens.
   Modal-style centered card on a dimmed canvas (the cinema "lobby" feel).
   Same two card types as mobile: synonym MCQ + translation typing.
   Bigger surface for desktop — keyboard hints visible.
*/

(function () {
  const { useState } = React;
  const { WW_TOKENS, CEFR, SERIF, SANS, MONO, Sidebar, TopBar } = window.WW_WEB_SHELL;

  function QuizFrame({ t, mode, onToggleMode, children, indexN, total, movie, level }) {
    const cefr = CEFR[level];
    const pct = (indexN / total) * 100;
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: t.bg, color: t.text, fontFamily: SANS, overflow: 'hidden' }}>
        <Sidebar active="practice" t={t} mode={mode} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <TopBar t={t} mode={mode} onToggleMode={onToggleMode} />

          {/* Lesson header strip */}
          <div style={{
            padding: '18px 32px', borderBottom: `1px solid ${t.divider}`,
            display: 'flex', alignItems: 'center', gap: 16, background: t.bgRaised,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: t.text2 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 6l-6 6 6 6"/></svg>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase' }}>Exit</span>
            </div>

            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '8px 14px', borderRadius: 999,
              background: t.paper, border: `1.5px solid ${t.gold}`,
              boxShadow: t.shadowCard,
            }}>
              <div style={{
                background: cefr, color: '#fff', fontSize: 9, fontWeight: 900,
                padding: '2px 6px', borderRadius: 3, letterSpacing: 0.3,
              }}>{level}</div>
              <span style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 600, color: t.text, letterSpacing: -0.2 }}>
                {movie}
              </span>
            </div>

            <div style={{ flex: 1, maxWidth: 400, height: 6, background: t.divider, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: t.gold, borderRadius: 999, transition: 'width 0.3s ease' }} />
            </div>

            <div style={{
              padding: '6px 12px', borderRadius: 999,
              background: t.chipBg, border: `1px solid ${t.border}`,
              fontFamily: MONO, fontSize: 12, fontWeight: 900, color: t.text,
            }}>{indexN}/{total}</div>

            <div style={{ fontSize: 11, fontWeight: 800, color: t.text3, letterSpacing: 1, textTransform: 'uppercase' }}>
              🔥 14 day streak
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, overflowY: 'auto', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 240, background: t.heroGlow, pointerEvents: 'none' }} />
            {children}
          </div>
        </div>
      </div>
    );
  }

  // ── Synonym MCQ ──────────────────────────────────────────────────
  function MCQChoice({ t, label, state, kbd }) {
    const correct = state === 'correct' || state === 'reveal-correct';
    const wrong = state === 'wrong';
    const border = correct ? t.successBorder : wrong ? t.errorBorder : t.border;
    const bg = correct ? t.successTint : wrong ? t.errorTint : t.paper;
    const fg = correct ? t.success : wrong ? t.error : t.text;
    return (
      <div style={{
        padding: '22px 22px', borderRadius: 14, border: `2px solid ${border}`, background: bg,
        display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
        boxShadow: state === 'idle' ? t.shadowCard : 'none',
        transition: 'all 0.15s ease',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: t.chipBg, border: `1px solid ${t.border}`,
          fontFamily: MONO, fontSize: 12, fontWeight: 900, color: t.text3,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{kbd}</div>
        <span style={{ flex: 1, fontFamily: SERIF, fontSize: 20, fontWeight: 600, color: fg, letterSpacing: -0.2 }}>{label}</span>
        {correct ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={t.success} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10"/></svg>
        ) : wrong ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={t.error} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        ) : null}
      </div>
    );
  }

  function SynonymMCQWeb({ mode = 'dark', state = 'idle', onToggleMode }) {
    const t = WW_TOKENS[mode];
    const word = 'whisper';
    const choices = [
      { label: 'shout',         s: 'idle',                                       kbd: '1' },
      { label: 'talk softly',   s: state === 'wrong' ? 'reveal-correct' : 'idle',kbd: '2' },
      { label: 'yell',          s: state === 'wrong' ? 'wrong' : 'idle',         kbd: '3' },
      { label: 'sing loudly',   s: 'idle',                                       kbd: '4' },
    ];

    return (
      <QuizFrame t={t} mode={mode} onToggleMode={onToggleMode} indexN={3} total={5} movie="Past Lives" level="B1">
        <div style={{ width: '100%', maxWidth: 760, position: 'relative', zIndex: 1 }}>

          <div style={{
            fontSize: 12, fontWeight: 900, letterSpacing: 2, color: t.goldOnSurface,
            textTransform: 'uppercase', textAlign: 'center', marginBottom: 18,
          }}>Pick the synonym</div>

          {/* Word card */}
          <div style={{
            padding: '40px 24px', borderRadius: 22,
            background: t.wordBox, border: `1px solid ${t.border}`,
            boxShadow: t.shadowCard, textAlign: 'center', marginBottom: 28,
          }}>
            <div style={{
              fontFamily: SERIF, fontSize: 56, fontWeight: 600, color: t.text,
              letterSpacing: -1, lineHeight: 1,
            }}>{word}</div>
            <div style={{ fontSize: 14, color: t.text3, fontStyle: 'italic', marginTop: 14, fontWeight: 600 }}>
              verb · "She whispered her name in the dark."
            </div>
          </div>

          {/* Choices in a 2-col grid (desktop) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
            {choices.map((c, i) => <MCQChoice key={i} t={t} {...c} />)}
          </div>

          {/* Wrong-state callout */}
          {state === 'wrong' ? (
            <div style={{
              padding: '16px 22px', borderRadius: 12, marginBottom: 28,
              background: t.errorTint, border: `1px solid ${t.errorBorder}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.6, color: t.error, textTransform: 'uppercase' }}>
                Not quite
              </div>
              <div style={{ fontSize: 14, color: t.text, marginTop: 6, fontWeight: 600 }}>
                <span style={{ color: t.success, fontWeight: 800 }}>talk softly</span> is the closest synonym. Both involve speaking quietly.
              </div>
            </div>
          ) : null}

          {/* Bottom CTA + keyboard hint */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, letterSpacing: 0.4 }}>
              Press <kbd style={kbdStyle(t)}>1</kbd>–<kbd style={kbdStyle(t)}>4</kbd> or click a choice. <kbd style={kbdStyle(t)}>Enter</kbd> to continue.
            </div>
            <div style={{ flex: 1 }} />
            <div style={{
              padding: '14px 28px', borderRadius: 12,
              background: state === 'wrong' ? t.error : t.gold,
              color: state === 'wrong' ? '#fff' : t.goldDeep,
              fontSize: 13, fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase',
              boxShadow: '0 10px 22px rgba(0,0,0,0.25)', cursor: 'pointer',
            }}>{state === 'wrong' ? 'Got it · continue →' : 'Check answer'}</div>
          </div>
        </div>
      </QuizFrame>
    );
  }

  // ── Typing ───────────────────────────────────────────────────────
  function TypingWeb({ mode = 'dark', state = 'prompt', onToggleMode }) {
    const t = WW_TOKENS[mode];
    const word = 'phosphorescent';
    const ans = 'фосфоресцентный';
    const correct = state === 'correct';

    const inputBorder = correct ? t.successBorder : t.border;
    const inputBg = correct ? t.successTint : t.paper;
    const inputFg = correct ? t.success : t.text;

    return (
      <QuizFrame t={t} mode={mode} onToggleMode={onToggleMode} indexN={4} total={5} movie="Past Lives" level="B2">
        <div style={{ width: '100%', maxWidth: 760, position: 'relative', zIndex: 1 }}>

          <div style={{
            fontSize: 12, fontWeight: 900, letterSpacing: 2, color: t.goldOnSurface,
            textTransform: 'uppercase', textAlign: 'center', marginBottom: 18,
          }}>Type the translation</div>

          <div style={{
            padding: '40px 24px', borderRadius: 22,
            background: t.wordBox, border: `1px solid ${t.border}`,
            boxShadow: t.shadowCard, textAlign: 'center', marginBottom: 22,
          }}>
            <div style={{ fontFamily: SERIF, fontSize: 52, fontWeight: 600, color: t.text, letterSpacing: -0.9, lineHeight: 1 }}>{word}</div>
            <div style={{ fontSize: 14, color: t.text3, fontStyle: 'italic', marginTop: 14, fontWeight: 600 }}>
              adj · "The phosphorescent waves glowed beneath the boat."
            </div>
          </div>

          {/* Hints */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
            {['adj.', '4 syllables', 'starts with "ф"', 'derived from “phosphor”'].map((h, i) => (
              <div key={i} style={{
                padding: '6px 12px', borderRadius: 999,
                background: t.chipBg, border: `1px solid ${t.border}`,
                fontSize: 12, fontWeight: 700, color: t.text2,
              }}>{h}</div>
            ))}
          </div>

          {/* Input */}
          <div style={{
            padding: '20px 22px', borderRadius: 14, border: `2px solid ${inputBorder}`, background: inputBg,
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18,
          }}>
            <input
              defaultValue={correct ? ans : ''}
              placeholder="Type the translation here…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: inputFg, fontSize: 22, fontWeight: 600, fontFamily: SANS,
              }}
            />
            {correct ? (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={t.success} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10"/></svg>
            ) : (
              <div style={{ width: 2.5, height: 26, background: t.primary, animation: 'wwCaret 1s steps(1) infinite' }} />
            )}
          </div>

          {/* Skip / correct callout row */}
          {correct ? (
            <div style={{
              padding: '14px 20px', borderRadius: 12, marginBottom: 20,
              background: t.successTint, border: `1px solid ${t.successBorder}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.6, color: t.success, textTransform: 'uppercase' }}>
                Correct! · +5 XP
              </div>
              <div style={{ fontSize: 14, color: t.text, marginTop: 6, fontWeight: 600 }}>
                Word added to your known set. Comprehension <strong>↑ 1pt</strong>.
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: t.text3, letterSpacing: 0.4, textTransform: 'uppercase', cursor: 'pointer' }}>
                I don't know · reveal answer
              </span>
            </div>
          )}

          {/* Bottom CTA + keyboard */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, letterSpacing: 0.4 }}>
              <kbd style={kbdStyle(t)}>Tab</kbd> to skip · <kbd style={kbdStyle(t)}>Enter</kbd> to check
            </div>
            <div style={{ flex: 1 }} />
            <div style={{
              padding: '14px 28px', borderRadius: 12,
              background: correct ? t.success : t.chipBg,
              color: correct ? '#fff' : t.text3,
              fontSize: 13, fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase',
              border: correct ? 'none' : `1px solid ${t.border}`,
              boxShadow: correct ? '0 10px 22px rgba(0,0,0,0.25)' : 'none',
              cursor: 'pointer',
            }}>{correct ? 'Continue →' : 'Check'}</div>
          </div>
        </div>
      </QuizFrame>
    );
  }

  function kbdStyle(t) {
    return {
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      background: t.chipBg, border: `1px solid ${t.border}`,
      fontFamily: MONO, fontSize: 11, fontWeight: 800, color: t.text2,
      verticalAlign: 'baseline',
    };
  }

  window.WW_WEB_QUIZ = { SynonymMCQWeb, TypingWeb };
})();
