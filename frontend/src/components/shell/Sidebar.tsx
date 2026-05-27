/**
 * Sidebar — primary nav for the redesigned web shell.
 *
 * Always-dark "cinema-lobby" treatment regardless of theme mode. Mirrors
 * the design template in web/shell.jsx. Composes:
 *   • Logo
 *   • Nav items (Home / My Movies / Practice / Discover / Stats)
 *   • Streak card
 *   • User row
 *
 * Active item is driven by `active` so the parent (router) decides
 * highlighting — this component itself is presentation-only.
 */

import type { CSSProperties, ReactNode } from 'react';
import { MONO, SERIF, useThemeColors } from '../../theme/tokens';

export type SidebarItemId =
  | 'home'
  | 'movies'
  | 'practice'
  | 'discover'
  | 'stats';

type IconKind = 'home' | 'film' | 'spark' | 'compass' | 'chart';

interface SidebarItem {
  id: SidebarItemId;
  label: string;
  icon: IconKind;
}

const ITEMS: SidebarItem[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'movies', label: 'My Movies', icon: 'film' },
  { id: 'practice', label: 'Practice', icon: 'spark' },
  { id: 'discover', label: 'Discover', icon: 'compass' },
  { id: 'stats', label: 'Stats', icon: 'chart' },
];

// Sidebar palette is intentionally independent of theme mode — always the
// lobby treatment. We pull `sidebarBg` and `sidebarBorder` from tokens so
// light mode can still use a slightly different dark.
function useSidebarPalette() {
  const t = useThemeColors();
  return {
    bg: t.sidebarBg,
    border: t.sidebarBorder,
    text: '#ffffff',
    text2: 'rgba(255,255,255,0.55)',
    gold: '#FFD166',
    goldDeep: '#3a2400',
    hover: 'rgba(255,255,255,0.06)',
  };
}

export interface SidebarProps {
  /** Which nav item is currently active. `null` highlights nothing. */
  active: SidebarItemId | null;
  /** Click handler — parent decides routing. */
  onNavigate?: (id: SidebarItemId) => void;
  /** Daily streak count. Defaults to 0 so the card always renders. */
  streakDays?: number;
  /** Progress through today's daily minutes goal (0–1). */
  streakProgress?: number;
  /** Sub-label under the streak meter. */
  streakSubtitle?: string;
  /** User initials shown in the avatar circle. */
  userInitials?: string;
  /** User display name. */
  userName?: string;
  /** User secondary line (e.g. "B2 · Russian"). */
  userMeta?: string;
}

export function Sidebar({
  active,
  onNavigate,
  streakDays = 0,
  streakProgress = 0,
  streakSubtitle,
  userInitials = '?',
  userName = '',
  userMeta = '',
}: SidebarProps) {
  const sb = useSidebarPalette();
  const progressPct = Math.max(0, Math.min(1, streakProgress)) * 100;

  return (
    <aside
      style={{
        width: 240,
        flexShrink: 0,
        background: sb.bg,
        borderRight: `1px solid ${sb.border}`,
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 0',
        color: sb.text,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '0 22px 28px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: sb.gold,
            color: sb.goldDeep,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: SERIF,
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          W
        </div>
        <div>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: -0.3,
            }}
          >
            WordWise
          </div>
          <div
            style={{
              fontSize: 10,
              color: sb.text2,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginTop: -2,
            }}
          >
            Learn from films
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav
        style={{
          padding: '0 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {ITEMS.map((it) => {
          const on = it.id === active;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onNavigate?.(it.id)}
              style={{
                ...buttonReset,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 8,
                background: on ? sb.hover : 'transparent',
                color: on ? sb.gold : sb.text,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 0.1,
                position: 'relative',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              {on ? (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: -12,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    background: sb.gold,
                    borderRadius: '0 3px 3px 0',
                  }}
                />
              ) : null}
              <SidebarIcon kind={it.icon} color={on ? sb.gold : sb.text2} />
              <span>{it.label}</span>
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Streak card */}
      <div style={{ padding: '0 16px 20px' }}>
        <div
          style={{
            padding: '14px 14px',
            borderRadius: 12,
            background: 'rgba(255,209,102,0.10)',
            border: '1px solid rgba(255,209,102,0.25)',
            color: sb.text,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🔥</span>
            <div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 18,
                  fontWeight: 900,
                  color: sb.gold,
                  lineHeight: 1,
                }}
              >
                {streakDays}
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: sb.text2,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                  marginTop: 3,
                }}
              >
                day streak
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 10,
              height: 4,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.10)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                background: sb.gold,
                borderRadius: 999,
              }}
            />
          </div>
          {streakSubtitle ? (
            <div
              style={{
                fontSize: 10,
                color: sb.text2,
                fontWeight: 700,
                marginTop: 6,
                letterSpacing: 0.4,
              }}
            >
              {streakSubtitle}
            </div>
          ) : null}
        </div>
      </div>

      {/* User row */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: `1px solid ${sb.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            flexShrink: 0,
            background: 'linear-gradient(135deg, #FFD166, #C58B1B)',
            color: '#3a2400',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 900,
            fontSize: 13,
          }}
        >
          {userInitials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: sb.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {userName}
          </div>
          <div
            style={{
              fontSize: 10,
              color: sb.text2,
              fontWeight: 700,
              letterSpacing: 0.6,
            }}
          >
            {userMeta}
          </div>
        </div>
      </div>
    </aside>
  );
}

const buttonReset: CSSProperties = {
  border: 'none',
  font: 'inherit',
  background: 'none',
  appearance: 'none',
};

function SidebarIcon({
  kind,
  color,
}: {
  kind: IconKind;
  color: string;
}): ReactNode {
  const p = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'home')
    return (
      <svg {...p}>
        <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
      </svg>
    );
  if (kind === 'film')
    return (
      <svg {...p}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 8h18M3 12h18M3 16h18M8 4v16M16 4v16" />
      </svg>
    );
  if (kind === 'spark')
    return (
      <svg {...p}>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  if (kind === 'compass')
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M16 8l-2 6-6 2 2-6z" />
      </svg>
    );
  if (kind === 'chart')
    return (
      <svg {...p}>
        <path d="M4 19V5M4 19h16M8 15v-3M12 15V8M16 15v-5" />
      </svg>
    );
  return null;
}
