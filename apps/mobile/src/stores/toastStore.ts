/**
 * toastStore — transient confirmation toasts (Motion §E5). A small queue that
 * masks background work: "added to reel", "streak frozen", "you're offline".
 * Each toast auto-dismisses after ~3.6s; callers can dismiss early.
 *
 * Not persisted — toasts are ephemeral. One toast shows at a time (the head of
 * the queue); enqueuing more lines them up.
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
