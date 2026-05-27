/**
 * AppTopBar — top strip of the redesigned web shell.
 *
 * Sits inside the content column (right of Sidebar). Contains:
 *   • ⌘K search field (placeholder; live search is a later phase)
 *   • Theme toggle
 *   • Notifications bell
 *
 * Named `AppTopBar` (not `TopBar`) to avoid colliding with the legacy
 * MUI `TopBar` component still in use elsewhere. Once the shell wraps
 * all routes (Phase 2+), the legacy one is retired.
 */

import type { ReactNode } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { MONO, useThemeColors } from '../../theme/tokens';

export interface AppTopBarProps {
  /** Placeholder text for the search field. */
  searchPlaceholder?: string;
  /** Optional click on the search bar — opens a command palette later. */
  onSearchClick?: () => void;
  /** Notification badge visibility. */
  hasNotification?: boolean;
  /** Optional notif bell click. */
  onNotificationClick?: () => void;
}

export function AppTopBar({
  searchPlaceholder = 'Search films, words, or actors…',
  onSearchClick,
  hasNotification = false,
  onNotificationClick,
}: AppTopBarProps) {
  const t = useThemeColors();
  const { mode, toggleTheme } = useTheme();

  return (
    <div
      style={{
        height: 64,
        padding: '0 32px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        borderBottom: `1px solid ${t.divider}`,
        background: t.bgRaised,
      }}
    >
      {/* Search */}
      <button
        type="button"
        onClick={onSearchClick}
        style={{
          flex: 1,
          maxWidth: 520,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderRadius: 10,
          background: t.paper,
          border: `1px solid ${t.border}`,
          color: t.text2,
          cursor: onSearchClick ? 'pointer' : 'text',
          textAlign: 'left',
          font: 'inherit',
          appearance: 'none',
        }}
      >
        <SearchIcon />
        <span style={{ fontSize: 13, color: t.text3, fontWeight: 500 }}>
          {searchPlaceholder}
        </span>
        <div
          style={{
            marginLeft: 'auto',
            padding: '2px 6px',
            borderRadius: 4,
            background: t.chipBg,
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 800,
            color: t.text3,
          }}
        >
          ⌘K
        </div>
      </button>

      <div style={{ flex: 1 }} />

      {/* Theme toggle */}
      <IconButton onClick={toggleTheme} aria-label="Toggle theme">
        {mode === 'dark' ? <SunIcon /> : <MoonIcon />}
      </IconButton>

      {/* Notifications */}
      <IconButton
        onClick={onNotificationClick}
        aria-label="Notifications"
        showBadge={hasNotification}
      >
        <BellIcon />
      </IconButton>
    </div>
  );
}

function IconButton({
  onClick,
  children,
  showBadge,
  ...rest
}: {
  onClick?: () => void;
  children: ReactNode;
  showBadge?: boolean;
  'aria-label'?: string;
}) {
  const t = useThemeColors();
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        background: t.chipBg,
        border: `1px solid ${t.border}`,
        color: t.text2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        position: 'relative',
        appearance: 'none',
        font: 'inherit',
      }}
    >
      {children}
      {showBadge ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 6,
            right: 8,
            width: 8,
            height: 8,
            borderRadius: 4,
            background: t.gold,
            border: `2px solid ${t.bgRaised}`,
          }}
        />
      ) : null}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" />
    </svg>
  );
}
