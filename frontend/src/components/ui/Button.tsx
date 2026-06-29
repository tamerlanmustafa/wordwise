/**
 * Button — the web primary button with a documented state ladder (Motion §E5).
 *
 * The full interaction ladder, all driven by `variant` + `state` + `:active`:
 *
 *   idle      → resting fill (primary = gold, secondary = outline)
 *   pressed   → dips + darkens (CSS :active scale, instant feedback <100ms)
 *   working   → spinner + "working" label, pointer disabled (optimistic)
 *   done      → brief check + done label before the caller resets to idle
 *   secondary → quieter outline treatment for the lesser action
 *   inline    → compact inline-load spinner for in-row actions (size="inline")
 *
 * Keep this the single primary button so the ladder stays consistent. The
 * keyframes are injected once and disabled under prefers-reduced-motion.
 */

import type { CSSProperties, ReactNode } from 'react';
import { useThemeColors } from '../../theme/tokens';

export type ButtonState = 'idle' | 'working' | 'done';
export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'default' | 'inline';

let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent = `
@keyframes wwBtnSpin { to { transform: rotate(360deg); } }
.ww-btn { transition: transform .08s ease, opacity .15s ease, background .15s ease; }
.ww-btn:not(:disabled):active { transform: scale(0.97); }
.ww-btn-spin { animation: wwBtnSpin .7s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .ww-btn { transition: none; }
  .ww-btn:not(:disabled):active { transform: none; }
  .ww-btn-spin { animation: none; }
}`;
  document.head.appendChild(el);
}

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  state?: ButtonState;
  size?: ButtonSize;
  disabled?: boolean;
  /** Label shown while `state === 'working'`. */
  workingLabel?: string;
  /** Label shown while `state === 'done'`. */
  doneLabel?: string;
  fullWidth?: boolean;
  style?: CSSProperties;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  state = 'idle',
  size = 'default',
  disabled = false,
  workingLabel = 'Working…',
  doneLabel = 'Done',
  fullWidth = false,
  style,
}: ButtonProps) {
  const t = useThemeColors();
  ensureKeyframes();
  const busy = state === 'working';
  const isDisabled = disabled || busy;

  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: 'none',
    borderRadius: size === 'inline' ? 10 : 14,
    fontWeight: 800,
    letterSpacing: 0.3,
    cursor: isDisabled ? 'default' : 'pointer',
    opacity: isDisabled && !busy ? 0.5 : 1,
    width: fullWidth ? '100%' : undefined,
    padding: size === 'inline' ? '8px 14px' : '14px 22px',
    fontSize: size === 'inline' ? 13 : 15,
  };

  const variantStyle: CSSProperties =
    variant === 'primary'
      ? { background: t.gold, color: t.goldDeep }
      : { background: 'transparent', color: t.text, border: `1.5px solid ${t.border}` };

  const spinnerColor = variant === 'primary' ? t.goldDeep : t.text;

  return (
    <button
      className="ww-btn"
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      aria-busy={busy}
      style={{ ...base, ...variantStyle, ...style }}
    >
      {busy && <Spinner color={spinnerColor} />}
      {state === 'done' ? doneLabel : busy ? workingLabel : children}
      {state === 'done' && <span aria-hidden>✓</span>}
    </button>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <span
      className="ww-btn-spin"
      style={{
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: `2px solid ${color}`,
        borderTopColor: 'transparent',
        display: 'inline-block',
      }}
    />
  );
}
