/**
 * OnboardingFlow — the first-run host (Launch §A). Owns the step state and
 * the choices the steps collect (language, placement answers → level, first
 * film, daily goal), then on finish:
 *   • persists the language the same way the header picker does,
 *   • adds the chosen film to the reel (reelStore — same path as Section B),
 *   • marks onboarding complete (onboardingStore) so the app root swaps in
 *     the real app.
 *
 * Rendered by core/App.tsx after authentication while
 * `onboardingStore.completed` is false.
 */

import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReelStore } from '../../stores/reelStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useAuthStore } from '../../stores/authStore';
import type { CefrLevel } from '../../types';
import { derivePlacementLevel, isPlacementDecided, PLACEMENT_WORDS, type PlacementAnswer, type PlacementRating } from './placement';
import { ScriptAnalyzing } from '../movies/ScriptAnalyzing';
import { ReelReady } from '../movies/ReelReady';
import { ANALYZE_STEPS } from '../movies/analyzeSteps';
import { WelcomeScreen } from './WelcomeScreen';
import { UsernameStep } from './UsernameStep';
import { LanguageStep } from './LanguageStep';
import { PlacementStep } from './PlacementStep';
import { LevelResultStep } from './LevelResultStep';
import { PickFirstFilmStep, type FirstFilm } from './PickFirstFilmStep';
import { GoalStep } from './GoalStep';

type Step = 'welcome' | 'username' | 'language' | 'placement' | 'level' | 'film' | 'goal' | 'analyzing' | 'ready';

export interface OnboardingFlowProps {
  /** Current target language, used to pre-select the language step. */
  initialLanguage?: string;
  /** Persist the chosen language the same way the app header does. */
  onLanguageChange?: (code: string) => void;
}

export function OnboardingFlow({ initialLanguage, onLanguageChange }: OnboardingFlowProps) {
  const complete = useOnboardingStore((s) => s.complete);
  const addToReel = useReelStore((s) => s.add);

  const [step, setStep] = useState<Step>('welcome');
  const [language, setLanguage] = useState<string | null>(initialLanguage ?? null);
  const [answers, setAnswers] = useState<PlacementAnswer[]>([]);
  const [wordIdx, setWordIdx] = useState(0);
  const [level, setLevel] = useState<CefrLevel>('A1');
  const [film, setFilm] = useState<FirstFilm | null>(null);
  const [goalMins, setGoalMins] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  // Flips true once the real reel mutation resolves. The analyzing checklist
  // holds on its last step until this is set (brief §B: "hold on the last
  // active step until the response lands").
  const addResolved = useRef(false);

  // ── Placement helpers ──────────────────────────────────────────────
  const recordRating = (rating: PlacementRating) => {
    const next = [...answers, { level: PLACEMENT_WORDS[wordIdx].level, rating }];
    setAnswers(next);
    // End as soon as the outcome is settled (issue #81) — a beginner
    // shouldn't have to rate the C-band words once no answer can change
    // the level — or when the list runs out.
    if (isPlacementDecided(next)) {
      setLevel(derivePlacementLevel(next));
      setStep('level');
    } else {
      setWordIdx(wordIdx + 1);
    }
  };

  const skipPlacement = () => {
    setAnswers([]);
    setLevel('A1');
    setStep('level');
  };

  const backFromPlacement = () => {
    if (wordIdx === 0) {
      setStep('language');
      return;
    }
    setWordIdx(wordIdx - 1);
    setAnswers(answers.slice(0, -1));
  };

  // ── Finish: add the film, show the analyzing checklist, then reel-ready ─
  const finish = () => {
    if (!language || !goalMins || !film || finishing) return;
    setFinishing(true);
    addResolved.current = false;
    setActiveStep(0);
    setStep('analyzing');
    // Kick off the real reel mutation (same path as Section B). Language is
    // persisted the same way the header picker does it.
    onLanguageChange?.(language);
    AsyncStorage.setItem('targetLanguage', language).catch(() => {});
    // Reconcile the placement-derived level with the server profile the rest
    // of the app reads (feed, Settings) so the two levels never disagree (F-003).
    // Home seeds its CEFR filter from authStore.user.proficiency_level, so this
    // sets the level locally first (holds even offline) then PATCHes the server
    // (issue #83: quiz said C2, Home filtered a stale B2).
    void useAuthStore.getState().syncProficiencyLevel(level);
    addToReel({ tmdb_id: film.tmdb_id, title: film.title, poster_path: film.poster_path, year: film.year })
      .catch(() => {
        /* optimistic + best-effort — never block finishing on a network error */
      })
      .finally(() => {
        addResolved.current = true;
      });
  };

  // Advance the analyzing checklist. The middle steps pace for perceived
  // progress; the final step holds until the real add resolves, then we move
  // to the reel-ready state.
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
        return s; // hold on the last step until the response lands
      });
    }, 700);
    return () => clearInterval(tick);
  }, [step]);

  const enterApp = () => {
    if (!language || !goalMins) return;
    // Flipping completed unmounts this flow (gate in App.tsx) and reveals the app.
    void complete({ targetLanguage: language, startingLevel: level, dailyGoalMinutes: goalMins });
  };

  switch (step) {
    case 'welcome':
      return <WelcomeScreen onGetStarted={() => setStep('username')} />;
    case 'username':
      return (
        <UsernameStep
          onBack={() => setStep('welcome')}
          onContinue={() => setStep('language')}
        />
      );
    case 'language':
      return (
        <LanguageStep
          selected={language}
          onSelect={setLanguage}
          onBack={() => setStep('username')}
          onContinue={() => {
            setWordIdx(0);
            setAnswers([]);
            setStep('placement');
          }}
        />
      );
    case 'placement':
      return (
        <PlacementStep
          word={PLACEMENT_WORDS[wordIdx]}
          index={wordIdx}
          total={PLACEMENT_WORDS.length}
          onRate={recordRating}
          onSkip={skipPlacement}
          onBack={backFromPlacement}
        />
      );
    case 'level':
      return <LevelResultStep level={level} onContinue={() => setStep('film')} onBack={() => setStep('placement')} />;
    case 'film':
      return (
        <PickFirstFilmStep
          startingLevel={level}
          selected={film}
          onSelect={setFilm}
          onBack={() => setStep('level')}
          onContinue={() => setStep('goal')}
        />
      );
    case 'goal':
      return (
        <GoalStep
          selected={goalMins}
          onSelect={setGoalMins}
          onBack={() => setStep('film')}
          onFinish={finish}
          finishing={finishing}
        />
      );
    case 'analyzing':
      return <ScriptAnalyzing activeStep={activeStep} movieTitle={film?.title} />;
    case 'ready':
      return film ? (
        <ReelReady
          tmdbId={film.tmdb_id}
          title={film.title}
          primaryLabel="Start learning →"
          onPrimary={enterApp}
          secondaryLabel="Go to my reel"
          onSecondary={enterApp}
        />
      ) : null;
  }
}
