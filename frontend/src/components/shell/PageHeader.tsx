/**
 * PageHeader — eyebrow + serif title + subtitle + optional right slot.
 *
 * Standard top-of-page block used across the redesign (My Movies,
 * Practice, etc.). The right slot is typically a primary CTA, but any
 * node works.
 */

import type { ReactNode } from 'react';
import { SERIF, useThemeColors } from '../../theme/tokens';

export interface PageHeaderProps {
  eyebrow: string;
  /** Serif page title. Optional — omit for a title-less header (e.g. Home). */
  title?: string;
  subtitle?: string;
  right?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, right }: PageHeaderProps) {
  const t = useThemeColors();
  return (
    <div
      style={{
        padding: '36px 32px 24px',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: 2.4,
            color: t.goldOnSurface,
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          {eyebrow}
        </div>
        {title ? (
          <h1
            style={{
              margin: 0,
              fontFamily: SERIF,
              fontSize: 44,
              fontWeight: 600,
              letterSpacing: -1.2,
              lineHeight: 1.05,
              color: t.text,
            }}
          >
            {title}
          </h1>
        ) : null}
        {subtitle ? (
          <div
            style={{
              fontSize: 15,
              color: t.text2,
              marginTop: 8,
              maxWidth: 640,
              lineHeight: 1.4,
              fontWeight: 500,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {right ? <div style={{ flexShrink: 0 }}>{right}</div> : null}
    </div>
  );
}
