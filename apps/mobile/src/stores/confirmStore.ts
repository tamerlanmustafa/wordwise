/**
 * confirmStore — themed confirmation dialogs (the in-app alternative to
 * native Alert.alert). Mirrors the toastStore + ToastHost split: this store
 * holds the active dialog, and ConfirmDialog (mounted once at the app root)
 * renders it with the current theme's colors so confirms honor the in-app
 * light/dark preference instead of only the OS appearance.
 *
 * One dialog shows at a time; confirms are rare and modal, so a second
 * `show()` simply replaces any current dialog (last wins).
 */
import { create } from 'zustand';

export type ConfirmTone = 'default' | 'destructive';

export interface ConfirmInput {
  title: string;
  message?: string;
  /** Confirm button label. Defaults to 'Confirm'. */
  confirmLabel?: string;
  /** Cancel button label. Defaults to 'Cancel'. */
  cancelLabel?: string;
  /** 'destructive' paints the confirm button in the error color. */
  tone?: ConfirmTone;
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ConfirmDialogData extends ConfirmInput {
  id: string;
}

interface ConfirmState {
  current: ConfirmDialogData | null;
  /** Open a confirmation dialog. */
  show: (input: ConfirmInput) => void;
  /** Run the confirm action and close. */
  handleConfirm: () => void;
  /** Run the (optional) cancel action and close. */
  handleCancel: () => void;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `confirm_${counter}_${Date.now()}`;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,

  show: (input) => set({ current: { ...input, id: nextId() } }),

  handleConfirm: () => {
    const { current } = get();
    if (!current) return;
    set({ current: null });
    current.onConfirm();
  },

  handleCancel: () => {
    const { current } = get();
    if (!current) return;
    set({ current: null });
    current.onCancel?.();
  },
}));

/** Convenience: open a confirm dialog without subscribing to the store. */
export function showConfirm(input: ConfirmInput): void {
  useConfirmStore.getState().show(input);
}
