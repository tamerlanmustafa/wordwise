/**
 * The quiz-exit guard.
 *
 * Practice is a loop now — finishing a tile opens the next one — so the only
 * thing standing between a user and an accidental exit is this. The failure
 * that matters is not "the dialog looked wrong"; it is the guard being asked
 * on a screen with no quiz, or *not* being asked on one with a live deck.
 */

import { useConfirmStore } from '../confirmStore';
import { guardQuizExit, useQuizGuardStore } from '../quizGuardStore';

const COPY = {
  title: 'Leave this lesson?',
  message: 'Your answers so far are saved.',
  confirmLabel: 'Leave',
  cancelLabel: 'Keep going',
};

beforeEach(() => {
  useQuizGuardStore.setState({ inProgress: false });
  useConfirmStore.setState({ current: null });
});

describe('guardQuizExit', () => {
  it('leaves immediately when no deck is in progress', () => {
    // Every back press in the app that is not a quiz must stay instant. A
    // dialog on an idle screen is worse than no guard at all.
    const leave = jest.fn();
    guardQuizExit(COPY, leave);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it('asks first when a deck is in progress, and does not leave yet', () => {
    const leave = jest.fn();
    useQuizGuardStore.setState({ inProgress: true });

    guardQuizExit(COPY, leave);

    expect(leave).not.toHaveBeenCalled();
    expect(useConfirmStore.getState().current).toMatchObject({
      title: COPY.title,
      confirmLabel: COPY.confirmLabel,
      // Destructive, because confirming discards the rest of the deck.
      tone: 'destructive',
    });
  });

  it('leaves once the user confirms', () => {
    const leave = jest.fn();
    useQuizGuardStore.setState({ inProgress: true });

    guardQuizExit(COPY, leave);
    useConfirmStore.getState().handleConfirm();

    expect(leave).toHaveBeenCalledTimes(1);
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it('clears the flag on confirm, so the exit cannot prompt twice', () => {
    // Navigation may unmount ReviewScreen a frame later, or not at all if the
    // target screen keeps it alive. A flag left raised turns one "quit" into
    // two dialogs.
    const leave = jest.fn();
    useQuizGuardStore.setState({ inProgress: true });

    guardQuizExit(COPY, leave);
    useConfirmStore.getState().handleConfirm();

    expect(useQuizGuardStore.getState().inProgress).toBe(false);
  });

  it('stays put when the user cancels, with the deck still guarded', () => {
    const leave = jest.fn();
    useQuizGuardStore.setState({ inProgress: true });

    guardQuizExit(COPY, leave);
    useConfirmStore.getState().handleCancel();

    expect(leave).not.toHaveBeenCalled();
    expect(useQuizGuardStore.getState().inProgress).toBe(true);
    expect(useConfirmStore.getState().current).toBeNull();
  });

  it('asks again on a second attempt after a cancel', () => {
    const leave = jest.fn();
    useQuizGuardStore.setState({ inProgress: true });

    guardQuizExit(COPY, leave);
    useConfirmStore.getState().handleCancel();
    guardQuizExit(COPY, leave);

    expect(useConfirmStore.getState().current).not.toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });

  it('runs the caller’s own leave action, not a hardcoded destination', () => {
    // The four exits go different places — Lists, Home, another tab — so the
    // guard must never own the destination.
    useQuizGuardStore.setState({ inProgress: true });
    const toLists = jest.fn();
    guardQuizExit(COPY, toLists);
    useConfirmStore.getState().handleConfirm();
    expect(toLists).toHaveBeenCalled();
  });
});

describe('the flag itself', () => {
  it('starts down, so a cold launch never guards', () => {
    expect(useQuizGuardStore.getState().inProgress).toBe(false);
  });

  it('is a plain boolean, not a count of answered cards', () => {
    // "Ask after three answers" is a rule nobody can predict from outside the
    // screen. Asking once on an untouched deck costs one tap; not asking on a
    // deck you are eight cards into costs the session.
    useQuizGuardStore.getState().setInProgress(true);
    expect(useQuizGuardStore.getState().inProgress).toBe(true);
    useQuizGuardStore.getState().setInProgress(false);
    expect(useQuizGuardStore.getState().inProgress).toBe(false);
  });
});
