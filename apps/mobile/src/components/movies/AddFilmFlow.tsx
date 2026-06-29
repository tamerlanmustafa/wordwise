/**
 * AddFilmFlow — global overlay that turns any `addFilmStore.request(film)` into
 * the branded add-a-film journey (Add-a-film §B): the spinning-reel analyzing
 * checklist → reel-ready. Mount once near the app root (App.tsx), above the
 * bottom bar.
 *
 * Drives the checklist off the real reel mutation: the middle steps pace for
 * perceived progress, but the last step holds until `reelStore.add` actually
 * resolves (brief §B). Decoupled from navigation — the reel-ready CTA simply
 * dismisses the overlay; the film is already on the reel by then.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeColors } from '../../theme/tokens';
import { useAddFilmStore, type AddFilmInput } from '../../stores/addFilmStore';
import { useReelStore } from '../../stores/reelStore';
import { ScriptAnalyzing } from './ScriptAnalyzing';
import { ReelReady } from './ReelReady';
import { ANALYZE_STEPS } from './analyzeSteps';

export function AddFilmFlow() {
  const tc = useThemeColors();
  const pending = useAddFilmStore((s) => s.pending);
  const clearPending = useAddFilmStore((s) => s.clear);
  const addToReel = useReelStore((s) => s.add);

  const [film, setFilm] = useState<AddFilmInput | null>(null);
  const [phase, setPhase] = useState<'analyzing' | 'ready' | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const addResolved = useRef(false);

  // Take ownership of a new request: copy it, clear the bus, kick off the add.
  useEffect(() => {
    if (!pending || film) return;
    const next = pending;
    clearPending();
    setFilm(next);
    setPhase('analyzing');
    setActiveStep(0);
    addResolved.current = false;
    addToReel({ tmdb_id: next.tmdb_id, title: next.title, poster_path: next.poster_path, year: next.year })
      .catch(() => {
        /* optimistic + best-effort; the reel store surfaces its own error toast */
      })
      .finally(() => {
        addResolved.current = true;
      });
  }, [pending, film, clearPending, addToReel]);

  // Pace the checklist; hold the last step until the real add resolves.
  useEffect(() => {
    if (phase !== 'analyzing') return;
    const tick = setInterval(() => {
      setActiveStep((s) => {
        if (s < ANALYZE_STEPS.length - 1) return s + 1;
        if (addResolved.current) {
          clearInterval(tick);
          setPhase('ready');
          return ANALYZE_STEPS.length;
        }
        return s;
      });
    }, 700);
    return () => clearInterval(tick);
  }, [phase]);

  const dismiss = () => {
    setFilm(null);
    setPhase(null);
    setActiveStep(0);
  };

  if (!film || !phase) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: tc.background }]}>
      {phase === 'analyzing' ? (
        <ScriptAnalyzing activeStep={activeStep} movieTitle={film.title} />
      ) : (
        <ReelReady
          tmdbId={film.tmdb_id}
          title={film.title}
          primaryLabel="Start learning →"
          onPrimary={dismiss}
          secondaryLabel="Back to my reel"
          onSecondary={dismiss}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 9997 },
});
