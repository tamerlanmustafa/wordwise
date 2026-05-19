/**
 * Theme tokens — the SINGLE source of truth for app colours.
 *
 * Import { useThemeColors } in components — it returns the right palette
 * for the current theme (light, dark, or system-driven). Components that
 * still read static `colors` from ../theme/palette only see the light
 * snapshot and won't flip when the user toggles the theme; migrate them
 * to this hook.
 *
 * Adding a new colour: add it to BOTH `light` and `dark` below and to the
 * `ThemeColors` interface. Then read it via `tc.<name>` in components.
 *
 * Pattern for screens:
 *
 *   export function MyScreen() {
 *     const tc = useThemeColors();
 *     const s = useMemo(() => makeStyles(tc), [tc]);
 *     return <View style={s.root}>...</View>;
 *   }
 *
 *   const makeStyles = (tc: ThemeColors) => StyleSheet.create({
 *     root: { flex: 1, backgroundColor: tc.background },
 *   });
 *
 * Never call useThemeColors() at module scope — it's a hook. Build
 * styles per-render with useMemo.
 */

import { useThemeStore } from '../stores/themeStore';

export interface ThemeColors {
  // Core app surfaces
  background:         string;  // app-wide root surface
  paper:              string;  // raised card surfaces
  surface:            string;  // alias of paper, kept for legacy callers
  border:             string;
  divider:            string;  // hairlines, less prominent than border

  // Text
  text:               string;
  textSecondary:      string;
  textFaint:          string;  // ~40% opacity equivalent
  textMuted:          string;  // alias of textFaint, kept for legacy callers
  textInverse:        string;  // text on primary-coloured fills

  // Primary brand
  primary:            string;
  primaryLight:       string;
  primaryTint:        string;  // 8–18% alpha tint for purple-tinted surfaces
  primaryOnSurface:   string;  // primary readable on `paper`

  // Secondary accent (kept for legacy callers)
  secondary:          string;

  // Gold accent — preserved across both modes; never invert.
  gold:               string;  // #FFD166 in both modes
  goldDeep:           string;  // dark text-on-gold (#3a2400 in both)
  goldOnSurface:      string;  // gold readable on `paper` — light mode darkens

  // States
  success:            string;
  warning:            string;
  error:              string;
  errorTint:          string;

  // Misc
  scrim:              string;  // modal/sheet backdrop

  // Bottom-bar specific
  bottomBarBg:        string;
  bottomBarBorder:    string;

  // Reel-only: the film stock substrate + sprocket palette
  reelStock:          string;  // film body colour
  reelStockDeep:      string;  // shadow/vignette inner colour
  reelStockLight:     string;  // gradient highlight colour
  reelSprocket:       string;  // perforation fill
  reelSprocketShadow: string;  // inset shadow rgba on sprocket
  reelEdgeCode:       string;  // small monospace markings colour (rgba)
  reelDust:           string;  // small dust speck fill
  reelLeakWarm:       string;  // warm light leak rgba
  reelLeakCool:       string;  // cool light leak rgba
  reelScratch:        string;  // emulsion scratch rgba
  reelGrainBlendMode: 'overlay' | 'multiply';
}

// ── Light theme ───────────────────────────────────────────────────────────
const light: ThemeColors = {
  background:         '#EDE8F5',
  paper:              '#FFFFFF',
  surface:            '#FFFFFF',
  border:             '#E0D4F7',
  divider:            '#EFE9F8',

  text:               '#2D3142',
  textSecondary:      '#5C6378',
  textFaint:          '#9AA0AE',
  textMuted:          '#9AA0AE',
  textInverse:        '#FFFFFF',

  primary:            '#7C5CBF',
  primaryLight:       '#9B7ED9',
  primaryTint:        '#F2EEFA',
  primaryOnSurface:   '#7C5CBF',

  secondary:          '#E07A5F',

  gold:               '#FFD166',
  goldDeep:           '#3a2400',
  goldOnSurface:      '#8B5A00',

  success:            '#4CAF9A',
  warning:            '#F4A261',
  error:              '#D66A6A',
  errorTint:          'rgba(214,106,106,0.18)',

  scrim:              'rgba(0,0,0,0.4)',

  bottomBarBg:        '#FFFFFF',
  bottomBarBorder:    '#E0D4F7',

  reelStock:          '#F4EFE3',
  reelStockDeep:      '#E5DCBE',
  reelStockLight:     '#FAF6E8',
  reelSprocket:       '#5B4422',
  reelSprocketShadow: 'rgba(0,0,0,0.35)',
  reelEdgeCode:       'rgba(80,55,15,0.45)',
  reelDust:           '#3a2a14',
  reelLeakWarm:       'rgba(196,170,235,0.55)',
  reelLeakCool:       'rgba(255,200,90,0.18)',
  reelScratch:        'rgba(80,55,15,0.10)',
  reelGrainBlendMode: 'multiply',
};

// ── Dark theme ────────────────────────────────────────────────────────────
const dark: ThemeColors = {
  background:         '#0e0d10',
  paper:              '#1a1a24',
  surface:            '#1F1F30',
  border:             'rgba(255,255,255,0.10)',
  divider:            'rgba(255,255,255,0.06)',

  text:               '#FFFFFF',
  textSecondary:      'rgba(255,255,255,0.65)',
  textFaint:          'rgba(255,255,255,0.40)',
  textMuted:          'rgba(255,255,255,0.40)',
  textInverse:        '#0e0d10',

  primary:            '#9B7ED9',
  primaryLight:       '#C5B1F0',
  primaryTint:        'rgba(124,92,191,0.18)',
  primaryOnSurface:   '#C5B1F0',

  secondary:          '#E07A5F',

  gold:               '#FFD166',
  goldDeep:           '#3a2400',
  goldOnSurface:      '#FFD166',

  success:            '#4CAF9A',
  warning:            '#F4A261',
  error:              '#E57373',
  errorTint:          'rgba(229,115,115,0.18)',

  scrim:              'rgba(0,0,0,0.6)',

  bottomBarBg:        'rgba(0,0,0,0.6)',
  bottomBarBorder:    'rgba(255,255,255,0.06)',

  reelStock:          '#1a1109',
  reelStockDeep:      '#0e0805',
  reelStockLight:     '#2a1c11',
  reelSprocket:       '#050300',
  reelSprocketShadow: 'rgba(0,0,0,0.9)',
  reelEdgeCode:       'rgba(255,180,80,0.55)',
  reelDust:           '#FFFFFF',
  reelLeakWarm:       'rgba(255,120,40,0.55)',
  reelLeakCool:       'rgba(255,200,90,0.28)',
  reelScratch:        'rgba(0,0,0,0.18)',
  reelGrainBlendMode: 'overlay',
};

export const themes: Record<'light' | 'dark', ThemeColors> = { light, dark };

/** Hook — returns the correct colour set for the current theme. */
export function useThemeColors(): ThemeColors {
  const resolved = useThemeStore((s) => s.resolved);
  return themes[resolved];
}

/** Resolved scheme directly — for StatusBar bar style, BlurView tint, etc. */
export function useColorScheme(): 'light' | 'dark' {
  return useThemeStore((s) => s.resolved);
}
