/**
 * SettingsPage — account & preferences, styled to match the redesigned
 * cinema-lobby shell (theme/tokens: warm cream surfaces, gold accents,
 * serif headers, dark sidebar). Renders inside <AppShell />.
 *
 * Logic is unchanged from the original MUI version — same AuthContext
 * (updateUser / refreshUser), form state, and validation. Only the
 * presentation was rebuilt on the shared token system so it lines up with
 * My Movies, Home, etc. and respects the light/dark toggle.
 */

import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { SERIF, useThemeColors, type ThemeTokens } from '../theme/tokens';
import { PageHeader } from '../components/shell/PageHeader';
import { SUPPORTED_LANGUAGES, PROFICIENCY_LEVELS } from '@wordwise/types';

export default function SettingsPage() {
  const t = useThemeColors();
  const navigate = useNavigate();
  const { user, isAuthenticated, updateUser, refreshUser, deleteAccount } = useAuth();

  const [formData, setFormData] = useState({
    username: '',
    nativeLanguage: '',
    learningLanguage: '',
    proficiencyLevel: '',
    defaultTab: 'movies' as 'movies' | 'books',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Permanently delete your account and all of your data (saved words, progress, streaks)? This cannot be undone.'
    );
    if (!confirmed) return;
    setDeleteError('');
    setDeleting(true);
    try {
      await deleteAccount(); // signs out + redirects on success
    } catch {
      setDeleting(false);
      setDeleteError(
        'Deletion failed — your account was not deleted. Try again, or email privacy@getwordwise.us.'
      );
    }
  };

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Load user data
  useEffect(() => {
    const loadUserData = async () => {
      if (user) {
        // Refresh user data from backend to get latest values
        await refreshUser();
      }
      setInitialLoading(false);
    };
    loadUserData();
  }, []);

  // Update form when user data changes
  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username || '',
        nativeLanguage: user.native_language || '',
        learningLanguage: user.learning_language || 'en',
        proficiencyLevel: user.proficiency_level || 'A1',
        defaultTab: user.default_tab || 'movies',
      });
    }
  }, [user]);

  const setField = (name: keyof typeof formData, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.username) {
      setError('Username is required');
      return;
    }

    setLoading(true);

    try {
      await updateUser({
        username: formData.username,
        native_language: formData.nativeLanguage,
        learning_language: formData.learningLanguage,
        proficiency_level: formData.proficiencyLevel,
        default_tab: formData.defaultTab,
      });
      setSuccess('Settings updated successfully!');
    } catch (err: any) {
      const errorMessage =
        err.response?.data?.detail || err.message || 'Failed to update settings';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spinner size={32} color={t.primary} />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const initial = user.username?.charAt(0).toUpperCase() ?? '?';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <PageHeader
        eyebrow="Your account"
        title="Settings"
        subtitle="Manage your profile, the languages you're learning, and how WordWise opens."
      />

      <div style={{ maxWidth: 760, padding: '0 32px 56px', width: '100%' }}>
        {/* Identity card */}
        <Card t={t} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {user.profile_picture_url ? (
              <img
                src={user.profile_picture_url}
                alt=""
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: `2px solid ${t.gold}`,
                }}
              />
            ) : (
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: t.primary,
                  border: `2px solid ${t.gold}`,
                  color: '#fff',
                  fontFamily: SERIF,
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                {initial}
              </div>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: SERIF,
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: -0.4,
                color: t.text,
                lineHeight: 1.1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user.username || 'Account'}
            </div>
            <div
              style={{
                fontSize: 13.5,
                color: t.text2,
                marginTop: 4,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user.email}
            </div>
          </div>
        </Card>

        {/* Alerts */}
        {error ? <Banner t={t} kind="error">{error}</Banner> : null}
        {success ? <Banner t={t} kind="success">{success}</Banner> : null}

        <form onSubmit={handleSubmit}>
          {/* Profile */}
          <Card t={t}>
            <SectionLabel t={t} icon={<PersonIcon />}>
              Profile
            </SectionLabel>
            <TextField
              t={t}
              label="Username"
              value={formData.username}
              onChange={(v) => setField('username', v)}
              placeholder="Your display name"
            />
          </Card>

          {/* Language preferences */}
          <Card t={t}>
            <SectionLabel t={t} icon={<GlobeIcon />}>
              Language preferences
            </SectionLabel>
            <SelectField
              t={t}
              label="Native language"
              value={formData.nativeLanguage}
              onChange={(v) => setField('nativeLanguage', v)}
              options={SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
              placeholder="Select a language"
            />
            <SelectField
              t={t}
              label="Learning language"
              value={formData.learningLanguage}
              onChange={(v) => setField('learningLanguage', v)}
              options={SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
            />
            <SelectField
              t={t}
              label="Proficiency level"
              value={formData.proficiencyLevel}
              onChange={(v) => setField('proficiencyLevel', v)}
              options={PROFICIENCY_LEVELS.map((p) => ({ value: p.code, label: p.name }))}
              last
            />
          </Card>

          {/* Default home tab */}
          <Card t={t}>
            <SectionLabel t={t} icon={<HomeIcon />}>
              Default home tab
            </SectionLabel>
            <FieldLabel t={t}>What should open first?</FieldLabel>
            <SegmentedToggle
              t={t}
              value={formData.defaultTab}
              onChange={(v) => setField('defaultTab', v)}
              options={[
                { value: 'movies', label: 'Movies' },
                { value: 'books', label: 'Books' },
              ]}
            />
          </Card>

          {/* Save */}
          <button
            type="submit"
            disabled={loading}
            style={{
              ...buttonReset,
              marginTop: 8,
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '15px 18px',
              borderRadius: 12,
              background: t.gold,
              color: t.goldDeep,
              fontSize: 14,
              fontWeight: 900,
              letterSpacing: 0.4,
              boxShadow: '0 10px 22px rgba(255,209,102,0.30)',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.65 : 1,
              transition: 'opacity 0.15s ease, transform 0.15s ease',
            }}
          >
            {loading ? (
              <>
                <Spinner size={18} color={t.goldDeep} /> Saving…
              </>
            ) : (
              <>
                <SaveIcon /> Save changes
              </>
            )}
          </button>
        </form>

        {/* Danger zone — account deletion must be reachable in-product
            (App Store 5.1.1(v); Google Play data-deletion policy). */}
        <Card t={t} style={{ marginTop: 24 }}>
          <SectionLabel t={t} icon={<TrashIcon />}>Danger zone</SectionLabel>
          <p style={{ margin: '4px 0 14px', fontSize: 13, lineHeight: 1.5, color: t.text2 }}>
            Permanently delete your account and all of your data — saved words,
            progress, streaks. This cannot be undone.
          </p>
          {deleteError && (
            <p style={{ margin: '0 0 12px', fontSize: 13, color: t.error }}>{deleteError}</p>
          )}
          <button
            type="button"
            disabled={deleting}
            onClick={handleDeleteAccount}
            style={{
              ...buttonReset,
              padding: '12px 18px',
              borderRadius: 12,
              border: `1px solid ${t.errorBorder}`,
              background: 'transparent',
              color: t.error,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.3,
              cursor: deleting ? 'default' : 'pointer',
              opacity: deleting ? 0.65 : 1,
            }}
          >
            {deleting ? 'Deleting…' : 'Delete account'}
          </button>
        </Card>
      </div>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────

function Card({
  t,
  children,
  style,
}: {
  t: ThemeTokens;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: t.paper,
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        boxShadow: t.shadowCard,
        padding: 24,
        marginBottom: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({
  t,
  icon,
  children,
}: {
  t: ThemeTokens;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 18,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 9,
          background: t.primaryT,
          color: t.primary,
        }}
      >
        {icon}
      </span>
      <span
        style={{
          fontFamily: SERIF,
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: -0.2,
          color: t.text,
        }}
      >
        {children}
      </span>
    </div>
  );
}

function FieldLabel({ t, children }: { t: ThemeTokens; children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: t.text3,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function TextField({
  t,
  label,
  value,
  onChange,
  placeholder,
}: {
  t: ThemeTokens;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <FieldLabel t={t}>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '12px 14px',
          borderRadius: 10,
          background: t.bg,
          border: `1px solid ${focused ? t.primary : t.border}`,
          boxShadow: focused ? `0 0 0 3px ${t.primaryT}` : 'none',
          color: t.text,
          fontSize: 15,
          fontWeight: 500,
          outline: 'none',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        }}
      />
    </div>
  );
}

interface Option {
  value: string;
  label: string;
}

function SelectField({
  t,
  label,
  value,
  onChange,
  options,
  placeholder,
  last,
}: {
  t: ThemeTokens;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  last?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <div style={{ marginBottom: last ? 0 : 16 }}>
      <FieldLabel t={t}>{label}</FieldLabel>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            ...buttonReset,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 10,
            background: t.bg,
            border: `1px solid ${open ? t.primary : t.border}`,
            boxShadow: open ? `0 0 0 3px ${t.primaryT}` : 'none',
            color: current ? t.text : t.text3,
            fontSize: 15,
            fontWeight: 500,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {current ? current.label : placeholder ?? 'Select…'}
          </span>
          <Chevron color={t.text3} open={open} />
        </button>

        {open ? (
          <>
            {/* Transparent backdrop catches click-outside without dimming. */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 20 }}
              onClick={() => setOpen(false)}
            />
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: 6,
                maxHeight: 280,
                overflowY: 'auto',
                background: t.paper,
                border: `1px solid ${t.border}`,
                borderRadius: 12,
                boxShadow: t.shadowCard,
                padding: 6,
                zIndex: 21,
              }}
            >
              {options.map((opt) => {
                const selected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    style={{
                      ...buttonReset,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 8,
                      textAlign: 'left',
                      fontSize: 14,
                      fontWeight: selected ? 700 : 500,
                      color: selected ? t.primary : t.text2,
                      background: selected ? t.primaryT : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <span>{opt.label}</span>
                    {selected ? <CheckIcon color={t.primary} /> : null}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SegmentedToggle({
  t,
  value,
  onChange,
  options,
}: {
  t: ThemeTokens;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
}) {
  return (
    <div
      style={{
        display: 'flex',
        padding: 4,
        gap: 4,
        borderRadius: 12,
        background: t.bg,
        border: `1px solid ${t.border}`,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              ...buttonReset,
              flex: 1,
              padding: '11px 12px',
              borderRadius: 9,
              fontSize: 14,
              fontWeight: active ? 800 : 600,
              color: active ? '#fff' : t.text2,
              background: active ? t.primary : 'transparent',
              boxShadow: active ? '0 4px 12px rgba(124,92,191,0.30)' : 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Banner({
  t,
  kind,
  children,
}: {
  t: ThemeTokens;
  kind: 'error' | 'success';
  children: ReactNode;
}) {
  const isError = kind === 'error';
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        marginBottom: 18,
        borderRadius: 12,
        background: isError ? t.errorTint : t.successTint,
        border: `1px solid ${isError ? t.errorBorder : t.successBorder}`,
        color: isError ? t.error : t.success,
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      {isError ? <AlertIcon /> : <CheckIcon color={t.success} />}
      <span>{children}</span>
    </div>
  );
}

// ── Icons (inline SVG — no external deps, inherit currentColor) ──────────

function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  );
}

function Chevron({ color, open }: { color: string; open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.15s ease',
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Spinner({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" aria-label="Loading">
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="80 50"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 25 25"
          to="360 25 25"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

const buttonReset: CSSProperties = {
  border: 'none',
  font: 'inherit',
  background: 'none',
  appearance: 'none',
};
