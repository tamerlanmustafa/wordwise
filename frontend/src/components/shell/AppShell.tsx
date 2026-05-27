/**
 * AppShell — layout route for the redesigned web frontend.
 *
 * Wraps a content `<Outlet />` with the cinema-lobby Sidebar (always
 * dark, fixed 240px) on the left, an AppTopBar on top, and a fluid
 * content column. Pages render whatever they want inside.
 *
 * Active sidebar item is derived from the URL path; clicks navigate
 * via react-router so back/forward and direct links work.
 *
 * Notes
 *   • Auth-only pages (LoginPage, SignUpPage) sit outside this layout —
 *     they're full-bleed and don't show the sidebar.
 *   • The streak/user info is read from AuthContext. If the user isn't
 *     loaded yet the sidebar still renders with neutral placeholders.
 *   • Practice / Discover / Stats routes are placeholders for now — the
 *     sidebar links navigate them but the destinations don't exist
 *     until later phases.
 */

import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useThemeColors } from '../../theme/tokens';
import { Sidebar, type SidebarItemId } from './Sidebar';
import { AppTopBar } from './TopBar';
import { useAuth } from '../../contexts/AuthContext';

const ROUTE_FOR: Record<SidebarItemId, string> = {
  home: '/',
  movies: '/my-movies',
  practice: '/practice',
  discover: '/search',
  stats: '/stats',
};

function activeForPath(pathname: string): SidebarItemId | null {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/my-movies')) return 'movies';
  if (pathname.startsWith('/practice')) return 'practice';
  if (pathname.startsWith('/search') || pathname.startsWith('/analyze'))
    return 'discover';
  if (pathname.startsWith('/stats')) return 'stats';
  return null;
}

function initialsFor(user: { username?: string; email?: string } | null): string {
  if (!user) return '?';
  const name = user.username ?? user.email ?? '';
  const parts = name.replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function AppShell() {
  const t = useThemeColors();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleNav = (id: SidebarItemId) => {
    navigate(ROUTE_FOR[id]);
  };

  const initials = initialsFor(user);
  const userName = user?.username ?? '';
  const userMeta =
    user?.proficiency_level && user?.learning_language
      ? `${user.proficiency_level} · ${formatLang(user.learning_language)}`
      : user?.learning_language
        ? formatLang(user.learning_language)
        : '';

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        display: 'flex',
        background: t.bg,
        color: t.text,
      }}
    >
      <Sidebar
        active={activeForPath(location.pathname)}
        onNavigate={handleNav}
        userInitials={initials}
        userName={userName}
        userMeta={userMeta}
      />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <AppTopBar />
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function formatLang(code: string): string {
  // 'es' → 'ES', 'ru' → 'RU'. Names would be nicer but we don't have a
  // lookup table on the web yet.
  return code.toUpperCase();
}
