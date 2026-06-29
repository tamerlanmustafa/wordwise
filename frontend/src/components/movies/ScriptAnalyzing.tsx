/**
 * ScriptAnalyzing — web parity for the add-a-film "analyzing" view (§B). A
 * spinning film-reel mark over the 4-step checklist; steps go pending → active
 * (gold spinner) → done (green check), driven by `activeStep`. Animations gate
 * on prefers-reduced-motion (the keyframes are paused by the media query in
 * the injected <style>).
 */

import { useThemeColors, SERIF } from '../../theme/tokens';
import { ANALYZE_STEPS } from './analyzeSteps';

const KEYFRAMES = `
@keyframes wwAnalyzeSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .ww-analyze-spin { animation: none !important; }
}
`;

export interface ScriptAnalyzingProps {
  activeStep: number;
  movieTitle?: string;
}

export function ScriptAnalyzing({ activeStep, movieTitle }: ScriptAnalyzingProps) {
  const t = useThemeColors();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px', minHeight: '60vh', color: t.text }}>
      <style>{KEYFRAMES}</style>
      <div className="ww-analyze-spin" style={{ width: 96, height: 96, position: 'relative', animation: 'wwAnalyzeSpin 3s linear infinite' }}>
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="45" fill="none" stroke={t.gold} strokeWidth="3" strokeOpacity="0.9" />
          {Array.from({ length: 5 }).map((_, i) => {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
            return <circle key={i} cx={48 + Math.cos(a) * 21} cy={48 + Math.sin(a) * 21} r="8" fill="none" stroke={t.gold} strokeWidth="2.4" strokeOpacity="0.7" />;
          })}
          <circle cx="48" cy="48" r="9" fill={t.gold} />
        </svg>
      </div>
      <div style={{ marginTop: 30, fontFamily: SERIF, fontSize: 23, fontWeight: 700, letterSpacing: -0.4, textAlign: 'center' }}>Analyzing the script…</div>
      {movieTitle && (
        <div style={{ marginTop: 8, fontSize: 13.5, color: t.text2, textAlign: 'center' }}>
          Building your word list for <i>{movieTitle}</i>
        </div>
      )}
      <div style={{ marginTop: 30, width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ANALYZE_STEPS.map((label, i) => {
          const done = i < activeStep;
          const cur = i === activeStep;
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: done || cur ? 1 : 0.4, transition: 'opacity .3s' }}>
              <span style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', background: done ? t.success : cur ? t.gold : t.chipBg, border: done || cur ? 'none' : `1px solid ${t.border}` }}>
                {done ? '✓' : cur ? <span className="ww-analyze-spin" style={{ width: 13, height: 13, border: `2px solid ${t.goldDeep}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'wwAnalyzeSpin 0.8s linear infinite' }} /> : ''}
              </span>
              <span style={{ fontSize: 14.5, fontWeight: cur ? 800 : 600, color: done || cur ? t.text : t.text3 }}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
