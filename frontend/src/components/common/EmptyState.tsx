/**
 * EmptyState — shared centered empty/zero/error layout (States §D), web copy of
 * apps/mobile/src/components/common/EmptyState.tsx. Icon-in-ring + serif title +
 * body + optional primary CTA + sub-CTA. `tone` tints the ring.
 */

import { useThemeColors, SERIF } from '../../theme/tokens';

export type EmptyStateTone = 'neutral' | 'success' | 'error';

export interface EmptyStateProps {
  /** Emoji or short glyph shown in the ring. */
  icon: string;
  title: string;
  body?: string;
  tone?: EmptyStateTone;
  ctaLabel?: string;
  onCta?: () => void;
  subCtaLabel?: string;
  onSubCta?: () => void;
}

export function EmptyState({ icon, title, body, tone = 'neutral', ctaLabel, onCta, subCtaLabel, onSubCta }: EmptyStateProps) {
  const t = useThemeColors();
  const accent = tone === 'success' ? t.success : tone === 'error' ? t.error : t.gold;
  const ringBg = tone === 'success' ? t.successTint : tone === 'error' ? t.errorTint : t.primaryT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '48px 36px', color: t.text }}>
      <div style={{ width: 84, height: 84, borderRadius: 42, border: `2px solid ${accent}`, background: ringBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, marginBottom: 22 }}>{icon}</div>
      <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700, letterSpacing: -0.4 }}>{title}</div>
      {body && <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5, color: t.text2, maxWidth: 320 }}>{body}</div>}
      {ctaLabel && onCta && (
        <button onClick={onCta} style={{ marginTop: 24, background: t.gold, color: t.goldDeep, border: 'none', padding: '14px 28px', borderRadius: 14, fontWeight: 900, fontSize: 14, letterSpacing: 0.5, textTransform: 'uppercase', cursor: 'pointer' }}>{ctaLabel}</button>
      )}
      {subCtaLabel && onSubCta && (
        <button onClick={onSubCta} style={{ marginTop: 14, background: 'none', border: 'none', color: t.text2, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{subCtaLabel}</button>
      )}
    </div>
  );
}
