/**
 * quizGuardStore — "is the user mid-quiz, and do they mean to leave?"
 *
 * The Practice tab is a loop now: finishing a tile starts the next one rather
 * than dropping you back to the path. That is only a good trade if leaving is
 * still easy *and* hard to do by accident — a loop you can fall out of by
 * brushing the back gesture is worse than no loop at all.
 *
 * So every exit from a live deck goes through {@link guardQuizExit}: the
 * header chevron, Android hardware back, the edge swipe, and a tab tap. They
 * were already unified behind `resolveBack` (see core/quizReturn) — this adds
 * one question in front of the same door rather than a second door.
 *
 * The flag lives in a store rather than in ReviewScreen's state because the
 * things that need to ask are all *outside* that component: App.tsx owns the
 * back resolver and the tab bar. A screen cannot veto navigation it does not
 * render.
 *
 * Deliberately not a count of answered cards. "Have you answered three?" is a
 * rule nobody can predict from the outside, and the cost of asking on a deck
 * you have not started is one extra tap — while the cost of *not* asking on a
 * deck you are eight cards into is the whole session.
 */

import { create } from 'zustand';
import { showConfirm } from './confirmStore';

interface QuizGuardState {
  /** True while a deck is on screen and answerable. */
  inProgress: boolean;
  setInProgress: (value: boolean) => void;
}

export const useQuizGuardStore = create<QuizGuardState>((set) => ({
  inProgress: false,
  setInProgress: (value) => set({ inProgress: value }),
}));

/** Copy lives here so the four call sites cannot word the question differently. */
export interface QuizExitCopy {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * Run `leave`, asking first if a deck is in progress.
 *
 * Clears the flag on confirm, so the navigation that follows — which may
 * unmount ReviewScreen a frame later, or may not — cannot re-prompt. Leaving
 * it set is how a "quit" turns into two dialogs.
 */
export function guardQuizExit(copy: QuizExitCopy, leave: () => void): void {
  if (!useQuizGuardStore.getState().inProgress) {
    leave();
    return;
  }
  showConfirm({
    title: copy.title,
    message: copy.message,
    confirmLabel: copy.confirmLabel,
    cancelLabel: copy.cancelLabel,
    tone: 'destructive',
    onConfirm: () => {
      useQuizGuardStore.getState().setInProgress(false);
      leave();
    },
  });
}
