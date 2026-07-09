/**
 * OnboardingPage — web parity for the first-run flow (Launch §A).
 *
 * Mirrors apps/mobile/src/components/onboarding/* : welcome → language →
 * placement → level → first film → daily goal. Token-styled (useThemeColors)
 * with the real Source Serif 4 / JetBrains Mono fonts the web app ships.
 *
 * Reuses: useLanguage() (the context behind LanguageSelector), reelStore.add
 * (same add path as Section B), and tmdbService for the film picker. The
 * placement scoring is the shared util in utils/placement.ts. On finish it
 * marks onboardingStore complete and navigates into the app.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeColors, SERIF, MONO, CEFR } from '../theme/tokens';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useReelStore } from '../stores/reelStore';
import { useOnboardingStore } from '../stores/onboardingStore';
import { CEFR_LEVELS, type CefrLevel } from '@wordwise/types';
import {
  derivePlacementLevel,
  PLACEMENT_WORDS,
  DAILY_GOAL_OPTIONS,
  type PlacementAnswer,
  type PlacementRating,
} from '../utils/placement';
import { searchTMDBMovies, fetchTopRatedMovies, getImageUrl, type TMDBMovie } from '../services/tmdbService';
import { ScriptAnalyzing } from '../components/movies/ScriptAnalyzing';
import { ANALYZE_STEPS } from '../components/movies/analyzeSteps';

type Step = 'welcome' | 'language' | 'placement' | 'level' | 'film' | 'goal' | 'analyzing' | 'ready';

const CEFR_LABELS: Record<CefrLevel, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper Int.',
  C1: 'Advanced',
  C2: 'Mastery',
};

const LEVEL_COPY: Record<CefrLevel, string> = {
  A1: "You're just starting out. We'll begin with the highest-frequency words and build from there.",
  A2: "You know everyday basics. We'll start your reels with A2–B1 vocabulary and adapt as you go.",
  B1: "You recognise common words but miss nuance. We'll start your reels with B1–B2 vocabulary and adapt as you go.",
  B2: "You follow most dialogue. We'll start your reels with B2–C1 vocabulary so you keep being challenged.",
  C1: "You're fluent in the everyday. We'll focus your reels on C1–C2 words — the rare, precise ones.",
  C2: "You're near-native. We'll surface the rarest C2 vocabulary and idioms films throw at you.",
};

interface FilmPick {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
}

function yearOf(date: string | undefined): number | null {
  if (!date) return null;
  const y = parseInt(date.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export default function OnboardingPage() {
  const t = useThemeColors();
  const navigate = useNavigate();
  const { targetLanguage, setTargetLanguage, availableLanguages } = useLanguage();
  const { updateUser } = useAuth();
  const addToReel = useReelStore((s) => s.add);
  const complete = useOnboardingStore((s) => s.complete);

  const [step, setStep] = useState<Step>('welcome');
  const [language, setLanguage] = useState<string>(targetLanguage || 'ES');
  const [answers, setAnswers] = useState<PlacementAnswer[]>([]);
  const [wordIdx, setWordIdx] = useState(0);
  const [level, setLevel] = useState<CefrLevel>('A1');
  const [film, setFilm] = useState<FilmPick | null>(null);
  const [goalMins, setGoalMins] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const addResolved = useRef(false);

  const recordRating = (rating: PlacementRating) => {
    const next = [...answers, { level: PLACEMENT_WORDS[wordIdx].level, rating }];
    setAnswers(next);
    if (wordIdx + 1 < PLACEMENT_WORDS.length) {
      setWordIdx(wordIdx + 1);
    } else {
      setLevel(derivePlacementLevel(next));
      setStep('level');
    }
  };

  // Finish: add the film, show the analyzing checklist, then reel-ready.
  const finish = () => {
    if (!language || !goalMins || !film || finishing) return;
    setFinishing(true);
    addResolved.current = false;
    setActiveStep(0);
    setStep('analyzing');
    setTargetLanguage(language);
    // Sync the placement-derived level to the user profile so HomePage's CEFR
    // filter (which reads user.proficiency_level) matches the quiz result
    // (issue #83 — same bug the mobile app had). Best-effort; updateUser
    // also refreshes the local user so the filter picks it up immediately.
    updateUser({ proficiency_level: level }).catch(() => {});
    addToReel({ tmdb_id: film.tmdb_id, title: film.title, poster_path: film.poster_path, year: film.year })
      .catch(() => { /* best-effort */ })
      .finally(() => { addResolved.current = true; });
  };

  // Pace the analyzing checklist; hold the last step until the real add lands.
  useEffect(() => {
    if (step !== 'analyzing') return;
    const tick = setInterval(() => {
      setActiveStep((s) => {
        if (s < ANALYZE_STEPS.length - 1) return s + 1;
        if (addResolved.current) {
          clearInterval(tick);
          setStep('ready');
          return ANALYZE_STEPS.length;
        }
        return s;
      });
    }, 700);
    return () => clearInterval(tick);
  }, [step]);

  const enterApp = () => {
    if (!language || !goalMins) return;
    complete({ targetLanguage: language, startingLevel: level, dailyGoalMinutes: goalMins });
    navigate('/', { replace: true });
  };

  const shell = (children: React.ReactNode, bg?: string): React.ReactElement => (
    <div style={{ minHeight: '100vh', background: bg ?? t.bg, color: t.text, fontFamily: SANS, display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', padding: '24px 0' }}>{children}</div>
    </div>
  );

  const StepHeader = ({ step: cur, eyebrow, title, onBack }: { step: number; eyebrow: string; title: string; onBack?: () => void }) => (
    <div style={{ padding: '0 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <button onClick={onBack} aria-label="Back" style={{ width: 34, height: 34, borderRadius: 17, background: t.chipBg, border: `1px solid ${t.border}`, color: t.text2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
        )}
        <div style={{ flex: 1, display: 'flex', gap: 5 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 999, background: i < cur ? t.gold : t.divider }} />
          ))}
        </div>
      </div>
      <div style={{ marginTop: 22, fontFamily: MONO, fontSize: 10.5, fontWeight: 800, letterSpacing: 2, color: t.goldOnSurface, textTransform: 'uppercase' }}>{eyebrow}</div>
      <div style={{ marginTop: 8, fontFamily: SERIF, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, lineHeight: 1.1 }}>{title}</div>
    </div>
  );

  const CTA = ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) => (
    <div style={{ padding: '14px 18px 8px' }}>
      <button
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        style={{ width: '100%', background: t.gold, color: t.goldDeep, padding: '15px 16px', borderRadius: 14, border: 'none', fontWeight: 900, fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, boxShadow: '0 10px 24px rgba(0,0,0,0.25)' }}
      >
        {label}
      </button>
    </div>
  );

  // ── Welcome ─────────────────────────────────────────────────────────
  if (step === 'welcome') {
    return shell(
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 32px', position: 'relative' }}>
          <div style={{ width: 88, height: 88, borderRadius: '50%', border: `3px solid ${t.gold}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 30, fontSize: 38 }}>🎞️</div>
          <div style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.12 }}>Understand every line.</div>
          <div style={{ marginTop: 14, fontSize: 15, color: t.text2, lineHeight: 1.5, maxWidth: 300 }}>WordWise turns any film's script into a vocabulary list — learn the key words before you watch, in the language you're studying.</div>
        </div>
        <CTA label="Get started" onClick={() => setStep('language')} />
      </div>,
      t.bg,
    );
  }

  // ── Language ────────────────────────────────────────────────────────
  if (step === 'language') {
    return shell(
      <>
        <StepHeader step={1} eyebrow="Step 1 of 5" title="What are you learning?" onBack={() => setStep('welcome')} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {availableLanguages.map((l) => {
            const on = l.code === language;
            return (
              <button key={l.code} onClick={() => setLanguage(l.code)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', borderRadius: 14, background: on ? t.primaryT : t.paper, border: `2px solid ${on ? t.primary : t.border}`, color: t.text, cursor: 'pointer' }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: t.wordBox, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 15, fontWeight: 800, color: t.gold }}>{l.code}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{l.name}</div>
                  {l.nativeName && <div style={{ fontSize: 12.5, color: t.text2, marginTop: 1 }}>{l.nativeName}</div>}
                </div>
                {on && <span style={{ width: 24, height: 24, borderRadius: 12, background: t.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>}
              </button>
            );
          })}
        </div>
        <CTA label="Continue →" onClick={() => { setWordIdx(0); setAnswers([]); setStep('placement'); }} disabled={!language} />
      </>,
    );
  }

  // ── Placement ───────────────────────────────────────────────────────
  if (step === 'placement') {
    const word = PLACEMENT_WORDS[wordIdx];
    const options: Array<{ label: string; sub: string; dot: string; rating: PlacementRating }> = [
      { label: "I've never seen it", sub: 'New to me', dot: t.text3, rating: 'unknown' },
      { label: 'Looks familiar', sub: "Can't define it", dot: t.gold, rating: 'familiar' },
      { label: 'I know it well', sub: 'Could use it in a sentence', dot: t.success, rating: 'know' },
    ];
    const back = () => {
      if (wordIdx === 0) { setStep('language'); return; }
      setWordIdx(wordIdx - 1);
      setAnswers(answers.slice(0, -1));
    };
    return shell(
      <>
        <StepHeader step={2} eyebrow={`Quick placement · word ${wordIdx + 1} of ${PLACEMENT_WORDS.length}`} title="How well do you know…" onBack={back} />
        <div style={{ flex: 1, padding: '24px 18px 0' }}>
          <div style={{ padding: '36px 20px', borderRadius: 18, background: t.wordBox, border: `1px solid ${t.border}`, textAlign: 'center' }}>
            <div style={{ fontFamily: SERIF, fontSize: 38, fontWeight: 600, letterSpacing: -0.6 }}>{word.word}</div>
            <div style={{ fontSize: 12, color: t.text3, fontStyle: 'italic', marginTop: 8, fontWeight: 600 }}>{word.pos}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
            {options.map((o) => (
              <button key={o.rating} onClick={() => recordRating(o.rating)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 13, padding: '15px 16px', borderRadius: 14, background: t.paper, border: `2px solid ${t.border}`, color: t.text, cursor: 'pointer' }}>
                <span style={{ width: 11, height: 11, borderRadius: 6, background: o.dot }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700 }}>{o.label}</div>
                  <div style={{ fontSize: 12, color: t.text2, marginTop: 1 }}>{o.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => { setAnswers([]); setLevel('A1'); setStep('level'); }} style={{ background: 'none', border: 'none', textAlign: 'center', padding: '14px 18px 10px', fontSize: 13, fontWeight: 700, color: t.text3, cursor: 'pointer' }}>Skip — I'm a beginner</button>
      </>,
    );
  }

  // ── Level result ────────────────────────────────────────────────────
  if (step === 'level') {
    const color = CEFR[level] ?? t.gold;
    return shell(
      <>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 28px' }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 800, letterSpacing: 2, color: t.goldOnSurface, textTransform: 'uppercase' }}>Your starting level</div>
          <div style={{ width: 110, height: 110, borderRadius: '50%', margin: '22px 0 8px', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 12px 30px ${color}55` }}>
            <span style={{ fontFamily: SERIF, fontSize: 44, fontWeight: 700, color: '#fff' }}>{level}</span>
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginTop: 12 }}>{CEFR_LABELS[level]}</div>
          <div style={{ fontSize: 14, color: t.text2, marginTop: 8, lineHeight: 1.5, maxWidth: 290 }}>{LEVEL_COPY[level]}</div>
          <div style={{ display: 'flex', gap: 5, marginTop: 30, width: '100%' }}>
            {CEFR_LEVELS.map((lv) => {
              const on = lv === level;
              return (
                <div key={lv} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: 8, borderRadius: 999, background: on ? CEFR[lv] : t.divider }} />
                  <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 10, fontWeight: on ? 900 : 700, color: on ? t.text : t.text3 }}>{lv}</div>
                </div>
              );
            })}
          </div>
        </div>
        <CTA label="Sounds right →" onClick={() => setStep('film')} />
      </>,
    );
  }

  // ── Pick first film ─────────────────────────────────────────────────
  if (step === 'film') {
    return (
      <FilmStep
        t={t}
        selected={film}
        onSelect={setFilm}
        onBack={() => setStep('level')}
        onContinue={() => setStep('goal')}
        StepHeader={StepHeader}
        CTA={CTA}
        shell={shell}
      />
    );
  }

  // ── Analyzing ───────────────────────────────────────────────────────
  if (step === 'analyzing') {
    return shell(<ScriptAnalyzing activeStep={activeStep} movieTitle={film?.title} />);
  }

  // ── Reel ready ──────────────────────────────────────────────────────
  if (step === 'ready' && film) {
    const poster = getImageUrl(film.poster_path, 'w500');
    return shell(
      <>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 30px' }}>
          <div style={{ position: 'relative' }}>
            {poster ? (
              <img src={poster} alt={film.title} style={{ width: 120, height: 176, borderRadius: 12, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ width: 120, height: 176, borderRadius: 12, background: t.wordBox, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>🎬</div>
            )}
            <span style={{ position: 'absolute', bottom: -10, right: -10, width: 44, height: 44, borderRadius: 22, background: t.success, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${t.bg}`, fontSize: 22, fontWeight: 900 }}>✓</span>
          </div>
          <div style={{ marginTop: 26, fontFamily: MONO, fontSize: 10.5, fontWeight: 800, letterSpacing: 2, color: t.goldOnSurface, textTransform: 'uppercase' }}>Reel ready</div>
          <div style={{ marginTop: 8, fontFamily: SERIF, fontSize: 27, fontWeight: 700, letterSpacing: -0.5 }}>{film.title} is on your reel</div>
          <div style={{ marginTop: 10, fontSize: 14, color: t.text2, lineHeight: 1.5, maxWidth: 280 }}>We've built your word list. Learn it before you watch and you'll follow every line.</div>
        </div>
        <CTA label="Start learning →" onClick={enterApp} />
        <button onClick={enterApp} style={{ background: 'none', border: 'none', textAlign: 'center', padding: '12px 18px 24px', fontSize: 13, fontWeight: 700, color: t.text2, cursor: 'pointer' }}>Go to my reel</button>
      </>,
    );
  }

  // ── Daily goal ──────────────────────────────────────────────────────
  return shell(
    <>
      <StepHeader step={5} eyebrow="Step 5 of 5" title="Set your daily goal" onBack={() => setStep('film')} />
      <div style={{ padding: '6px 18px 0', fontSize: 13.5, color: t.text2 }}>You can change this any time. Consistency beats intensity.</div>
      <div style={{ flex: 1, padding: '20px 18px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {DAILY_GOAL_OPTIONS.map((g) => {
          const on = g.mins === goalMins;
          return (
            <button key={g.mins} onClick={() => setGoalMins(g.mins)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, padding: '15px 16px', borderRadius: 14, background: on ? t.primaryT : t.paper, border: `2px solid ${on ? t.primary : t.border}`, color: t.text, cursor: 'pointer' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{g.label}</div>
                <div style={{ fontSize: 12.5, color: t.text2, marginTop: 2 }}>{g.sub}</div>
              </div>
              <span style={{ width: 22, height: 22, borderRadius: 11, border: `2px solid ${on ? t.primary : t.border}`, background: on ? t.primary : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{on ? '✓' : ''}</span>
            </button>
          );
        })}
      </div>
      <CTA label={finishing ? 'Setting up…' : 'Enter WordWise →'} onClick={finish} disabled={!goalMins || finishing} />
    </>,
  );
}

const SANS = `-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', system-ui, sans-serif`;

// ── Film step (own component so it can fetch suggestions/search) ───────
function FilmStep({
  t,
  selected,
  onSelect,
  onBack,
  onContinue,
  StepHeader,
  CTA,
  shell,
}: {
  t: ReturnType<typeof useThemeColors>;
  selected: FilmPick | null;
  onSelect: (f: FilmPick) => void;
  onBack: () => void;
  onContinue: () => void;
  StepHeader: (p: { step: number; eyebrow: string; title: string; onBack?: () => void }) => React.ReactElement;
  CTA: (p: { label: string; onClick: () => void; disabled?: boolean }) => React.ReactElement;
  shell: (children: React.ReactNode, bg?: string) => React.ReactElement;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<TMDBMovie[]>([]);
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    let active = true;
    fetchTopRatedMovies()
      .then((r) => { if (active) setSuggestions(r.results.slice(0, 6)); })
      .catch(() => { if (active) setSuggestions([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    const id = ++seq.current;
    const h = setTimeout(() => {
      searchTMDBMovies(q)
        .then((r) => { if (id === seq.current) setResults(r.results.slice(0, 8)); })
        .catch(() => { if (id === seq.current) setResults([]); });
    }, 300);
    return () => clearTimeout(h);
  }, [query]);

  const grid = query.trim().length >= 2 ? results : suggestions;

  const pick = (m: TMDBMovie) => onSelect({ tmdb_id: m.id, title: m.title, poster_path: m.poster_path, year: yearOf(m.release_date) });

  return shell(
    <>
      <StepHeader step={4} eyebrow="Step 4 of 5" title="Pick your first film" onBack={onBack} />
      <div style={{ padding: '6px 18px 0', fontSize: 13.5, color: t.text2 }}>We'll build a word list from its script — start with one you'd love to understand.</div>
      <div style={{ padding: '14px 18px 0' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for another film"
          style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 12, background: t.paper, border: `1px solid ${t.border}`, color: t.text, fontSize: 15, boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {grid.map((m) => {
            const on = selected?.tmdb_id === m.id;
            const poster = getImageUrl(m.poster_path, 'w200');
            return (
              <button key={m.id} onClick={() => pick(m)} style={{ textAlign: 'left', padding: 0, borderRadius: 16, overflow: 'hidden', background: t.paper, border: `2px solid ${on ? t.gold : t.border}`, cursor: 'pointer', position: 'relative' }}>
                {poster ? (
                  <img src={poster} alt={m.title} style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: t.wordBox }}>🎬</div>
                )}
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 700, letterSpacing: -0.2, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</div>
                  {yearOf(m.release_date) && <div style={{ fontSize: 12, color: t.text2, marginTop: 2 }}>{yearOf(m.release_date)}</div>}
                </div>
                {on && <span style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, background: t.gold, color: t.goldDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>
      <CTA label="Start learning →" onClick={onContinue} disabled={!selected} />
    </>,
  );
}
