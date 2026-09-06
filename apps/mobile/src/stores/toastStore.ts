/**
 * toastStore — transient confirmation toasts (Motion §E5). A small queue that
 * masks background work: "added to reel", "streak frozen", "you're offline".
 * Each toast auto-dismisses after ~3.6s; callers can dismiss early.
 *
 * Not persisted — toasts are ephemeral.
 *
 * ## Why several show at once
 *
 * This used to render only the head of the queue and hold everything behind it
 * until that one's timer ran out. The actions that produce toasts are the ones
 * people fire in bursts — "seen it", "not interested", + on a card, three cards
 * in a row — so the second tap's confirmation arrived 3.6 seconds after the
 * tap, by which time it is confirming something you have stopped thinking
 * about. Worse, each of those toasts carries an Undo: a queued undo is an undo
 * you cannot reach while it is still the thing you want to undo.
 *
 * So the visible toasts are a *stack*, up to VISIBLE_TOAST_LIMIT, each running
 * its own timer from the moment it appears. Anything past the limit still
 * queues — the cap is what stops a fast burst from papering over the screen it
 * is reporting on.
 */

import { create } from 'zustand';

export type ToastTone = 'default' | 'success' | 'error';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  /** ms before auto-dismiss. */
  duration: number;
  /** Optional inline action (e.g. "Undo"). Tapping it runs onAction then
   *  dismisses the toast. */
  actionLabel?: string;
  onAction?: () => void;
}

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastState {
  queue: Toast[];
  /** Enqueue a toast; returns its id. */
  show: (input: ToastInput) => string;
  /** Remove a toast by id (early dismiss or after its timer). */
  dismiss: (id: string) => void;
  clear: () => void;
}

export const DEFAULT_TOAST_DURATION = 3600;

/** How many toasts can be on screen together. Three: enough that a burst of
 *  card actions all get answered, few enough that the stack cannot grow past
 *  the top third of the screen and start hiding the feed it is describing. */
export const VISIBLE_TOAST_LIMIT = 3;

/**
 * The toasts the host should render, oldest first.
 *
 * Oldest at the top of the stack is deliberate. Newest-on-top is what a
 * notification centre does, but it moves every toast already on screen down by
 * a row the instant a new one lands — including the one your thumb is on its
 * way to swipe or whose Undo you are reaching for. Appending below means an
 * arriving toast never displaces one you are already aiming at.
 */
export function visibleToasts(queue: Toast[]): Toast[] {
  return queue.slice(0, VISIBLE_TOAST_LIMIT);
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast_${counter}_${Date.now()}`;
}

export const useToastStore = create<ToastState>((set) => ({
  queue: [],

  show: ({ message, tone = 'default', duration = DEFAULT_TOAST_DURATION, actionLabel, onAction }) => {
    const id = nextId();
    set((s) => ({ queue: [...s.queue, { id, message, tone, duration, actionLabel, onAction }] }));
    return id;
  },

  dismiss: (id) => set((s) => ({ queue: s.queue.filter((t) => t.id !== id) })),

  clear: () => set({ queue: [] }),
}));

/** Convenience: enqueue a toast without subscribing to the store. */
export function showToast(input: ToastInput): string {
  return useToastStore.getState().show(input);
}
