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

  // Skeleton loaders (motion §E3) — base block tint + the moving sheen.
  skeleton:           string;  // resting skeleton block fill
  skeletonSheen:      string;  // brighter band that sweeps across it

  // Bottom-bar (legacy — kept for any non-migrated callers).
  bottomBarBg:        string;
  bottomBarBorder:    string;

  // v0.7 two-tab redesign — Tab bar + chips (Source: tabs/CLAUDE_PROMPT.md §3)
  tabBg:              string;  // bottom nav fill (more opaque than legacy bottomBarBg)
  tabBorder:          string;  // bottom nav top hairline
  chipBg:             string;  // inactive filter chips, circular icon buttons

  // v0.7 Practice screen — lesson nodes + warm hero glow
  heroGlowStart:      string;  // top vertex of the practice-screen warm vignette
  lessonRing:         string;  // dashed ring around the active lesson node
  nodeLocked:         string;  // locked lesson node fill
  nodeLockedBorder:   string;  // locked lesson node border
  nodeGoldEdge:       string;  // 3D bottom edge under the gold (active) tile
  nodeDone:           string;  // completed practice tile face — green, not gold
  nodeDoneEdge:       string;  // 3D bottom edge under a completed tile
  nodeLockedEdge:     string;  // 3D bottom edge under locked tiles
  nodeRepairEdge:     string;  // 3D bottom edge under the repair (rescue-streak) tile

  // v0.7 §7 Quiz screens (translation MCQ)
  wordBoxBg:          string;  // inner word card on quiz screens (off-paper by 1 step)
  successTint:        string;  // correct-flash bg on choices + input
  successBorder:      string;  // correct-flash border
  errorBorder:        string;  // wrong-choice border (errorTint already exists)

  // Quiz surfaces (v0.9 redesign). The quiz is the one screen built out of
  // *depth* rather than flat cards: the word sits in a recessed panel that
  // reads as a lit screen, and the answers are raised tiles with a solid
  // bottom edge you can watch compress when you press them. Two gradient
  // stops each, because a single fill on a 60pt tile reads as a rectangle
  // while a 4-point vertical shift reads as a surface catching light.
  //
  // `success` / `error` are reused for the answered states — they already
  // carry the exact values the design asks for — but the *edges* are new:
  // an edge is a darker relative of the fill, not a tint of it, so it cannot
  // be derived with withAlpha() without going muddy on a coloured ground.
  quizRecessedTop:    string;  // recessed panel, top stop
  quizRecessedBottom: string;  // recessed panel, bottom stop
  quizRaisedTop:      string;  // raised tile, top stop
  quizRaisedBottom:   string;  // raised tile, bottom stop
  quizRaisedEdge:     string;  // the 4px lip under an idle tile
  quizCorrectEdge:    string;  // lip under a correct tile / CTA
  quizWrongEdge:      string;  // lip under a wrong tile / CTA
  /** Ink on a solid CEFR chip. The ramp runs through yellows and greens that
   *  are far too light for white text, so every chip takes one dark ink. */
  cefrChipInk:        string;
  /** Two festive one-offs for the celebration burst, so it is not a
   *  monochrome gold shower. Same in both themes: confetti falls over a
   *  tinted vignette, not over the page. */
  confettiViolet:     string;
  confettiCoral:      string;
  confettiCream:      string;
  warningTint:        string;  // "showed you" reveal callout bg (yellow per §7.2)
  warningBorder:      string;  // "showed you" reveal callout border

  // Explore word feed — the surface is deliberately its own flat colour so
  // the screen, the toast strip and the tab bar read as one plane from the
  // status bar down. It matches the opaque value behind `tabBg`, which is
  // why the bar disappears into it.
  feedBg:             string;
  goldLine:           string;  // gold hairline borders (CEFR badge, dashed CTAs)
  goldWash:           string;  // highlight behind the target word in a sentence
  panelShadowColor:   string;  // slide-in panel lift; warm glow in dark, brown in light
  toastBg:            string;
  toastText:          string;

  // Lists tab. The index rows sit on `feedBg` (same surface as the Explore
  // feed), so they need a lighter drop than `panelShadowColor` — that one is
  // tuned for a panel lifting over the page, not a row resting on it.
  cardShadowColor:    string;  // list-row lift
  segmentThumb:       string;  // selected segment fill on a `chipBg` track

  // Home-feed movie card. `cardStock` is deliberately neither `paper` nor
  // `background` — it sits one step above the page so the card separates
  // without going white, and it is the SAME on every card (per-card tinting
  // from artwork was built and rejected). The scrim and the level-ring hole
  // must use this exact RGB or seams show where they meet the card.
  cardStock:          string;
  cardInk:            string;  // title + the percent inside the ring
  cardMeta:           string;  // year, rating, CEFR band, ring arc
  cardRingTrack:      string;  // unfilled part of the level ring

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

  // v0.8 Movie-detail hero — the poster under a warm wash.
  // `metaMono` is deliberately absent: the hero's gold mono line is exactly
  // `goldOnSurface` in both modes, and a second name for the same colour is
  // a second thing to keep in step. `printPaper`/`printEdge` are gone with the
  // paper frame that used to surround the poster.
  washTint:           string;  // gold multiply over the backdrop haze
  metaMonoFaint:      string;  // quieter of the two mono meta lines
  labelFaint:         string;  // EXAMPLE SENTENCE eyebrow on the card
}

// ── Light theme ───────────────────────────────────────────────────────────
// v0.7: shifted from purple-tinted ("Studio") to warm sun-bleached
// contact-sheet ("Reading room"). The cinema metaphor reads in daylight
// because text + borders + dividers all warm-shift together.
const light: ThemeColors = {
  background:         '#F4EFE3',  // warm cream paper (was #EDE8F5 purple)
  paper:              '#FFFFFF',
  surface:            '#FFFFFF',
  border:             '#E5DCC4',  // warm border (was #E0D4F7 lilac)
  divider:            '#EEE6D2',  // warm divider (was #EFE9F8 lilac)

  text:               '#2D2418',  // deep brown (was #2D3142 blue-grey)
  textSecondary:      '#6E5F47',  // warm mid (was #5C6378 cool grey)
  textFaint:          '#9C8E72',  // warm faint (was #9AA0AE cool)
  textMuted:          '#9C8E72',
  textInverse:        '#FFFFFF',

  primary:            '#7C5CBF',
  primaryLight:       '#9B7ED9',
  primaryTint:        '#F2EEFA',
  primaryOnSurface:   '#7C5CBF',

  secondary:          '#E07A5F',

  // Gold in light mode pivots to ochre per CLAUDE_PROMPT.md §5 — bright
  // #FFD166 against cream looks blown-out, ochre reads as aged paper.
  // Components that need the *bright* gold (e.g. tile FINAL CUT stamp)
  // can pick `goldDeep` for text contrast as before.
  gold:               '#C58B1B',
  goldDeep:           '#3a2400',
  goldOnSurface:      '#8B5A00',

  success:            '#3F8B7B',  // warmer in light (was #4CAF9A)
  warning:            '#F4A261',
  error:              '#D66A6A',
  errorTint:          'rgba(214,106,106,0.16)',

  scrim:              'rgba(0,0,0,0.4)',

  skeleton:           'rgba(45,36,24,0.07)',
  skeletonSheen:      'rgba(255,255,255,0.65)',

  bottomBarBg:        '#FFFFFF',
  bottomBarBorder:    '#E5DCC4',

  // v0.7 tab bar
  tabBg:              'rgba(255,253,247,0.96)',
  tabBorder:          '#E5DCC4',
  chipBg:             '#EEE6D2',

  // v0.7 Practice
  heroGlowStart:      'rgba(197,139,27,0.14)',
  lessonRing:         'rgba(197,139,27,0.55)',
  nodeLocked:         '#E5DCC4',
  nodeLockedBorder:   '#D7CCB0',
  nodeGoldEdge:       '#96660A',
  // The completed tile's own green, deep enough that `shade` still has room
  // to light its top and darken its bottom — a face already near white or
  // black loses the gradient that makes the coin read as a solid object.
  nodeDone:           '#3F8B7B',
  nodeDoneEdge:       '#2A5F54',
  nodeLockedEdge:     '#CDC0A0',
  nodeRepairEdge:     '#A94B4B',

  // v0.7 §7 Quiz
  wordBoxBg:          '#FAF7EE',
  successTint:        'rgba(63,139,123,0.14)',
  successBorder:      'rgba(63,139,123,0.55)',
  errorBorder:        'rgba(214,106,106,0.55)',
  quizRecessedTop:    '#FFFDF7',
  quizRecessedBottom: '#FAF6EB',
  quizRaisedTop:      '#FFFFFF',
  quizRaisedBottom:   '#FBF8F0',
  quizRaisedEdge:     '#E3D9C0',
  quizCorrectEdge:    '#BEDCD5',
  quizWrongEdge:      '#E5C4C4',
  cefrChipInk:        '#1A1206',
  confettiViolet:     '#9B7ED9',
  confettiCoral:      '#E07A5F',
  confettiCream:      '#FFF6E0',
  warningTint:        'rgba(244,162,97,0.16)',
  warningBorder:      'rgba(244,162,97,0.55)',

  // Explore feed
  feedBg:             '#FFFDF7',
  goldLine:           'rgba(197,139,27,0.42)',
  goldWash:           'rgba(197,139,27,0.16)',
  panelShadowColor:   'rgba(60,40,10,0.18)',
  toastBg:            '#2D2418',
  toastText:          '#FFF6E0',

  // Lists tab
  cardShadowColor:    'rgba(60,40,10,0.10)',
  segmentThumb:       '#FFFDF7',

  cardStock:          '#FBF7EE',
  cardInk:            '#2D2418',
  cardMeta:           '#8B5A00',
  cardRingTrack:      'rgba(45,36,24,0.12)',

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

  // v0.8 Movie-detail hero
  washTint:           'rgba(197,139,27,0.20)',
  metaMonoFaint:      '#A2947A',
  labelFaint:         '#C2B492',
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

  skeleton:           'rgba(255,255,255,0.06)',
  skeletonSheen:      'rgba(255,255,255,0.13)',

  bottomBarBg:        'rgba(0,0,0,0.6)',
  bottomBarBorder:    'rgba(255,255,255,0.06)',

  // v0.7 tab bar
  tabBg:              'rgba(20,18,28,0.92)',
  tabBorder:          'rgba(255,255,255,0.08)',
  chipBg:             'rgba(255,255,255,0.06)',

  // v0.7 Practice
  heroGlowStart:      'rgba(255,209,102,0.18)',
  lessonRing:         'rgba(255,209,102,0.45)',
  nodeLocked:         '#2a2935',
  nodeLockedBorder:   'rgba(255,255,255,0.06)',
  nodeGoldEdge:       '#C08F21',
  nodeDone:           '#4CAF9A',
  nodeDoneEdge:       '#2F7466',
  nodeLockedEdge:     '#1c1b25',
  nodeRepairEdge:     '#B25050',

  // v0.7 §7 Quiz
  wordBoxBg:          '#0a090d',
  successTint:        'rgba(76,175,154,0.20)',
  successBorder:      'rgba(76,175,154,0.55)',
  errorBorder:        'rgba(229,115,115,0.55)',
  quizRecessedTop:    '#0B0A0E',
  quizRecessedBottom: '#131220',
  quizRaisedTop:      '#23222F',
  quizRaisedBottom:   '#1A1A24',
  quizRaisedEdge:     '#100F16',
  quizCorrectEdge:    '#1A4A42',
  quizWrongEdge:      '#5C2222',
  cefrChipInk:        '#1A1206',
  confettiViolet:     '#9B7ED9',
  confettiCoral:      '#E07A5F',
  confettiCream:      '#FFF6E0',
  warningTint:        'rgba(244,162,97,0.20)',
  warningBorder:      'rgba(244,162,97,0.55)',

  // Explore feed. A black shadow is invisible on this surface, so the panel
  // lift is carried by a warm gold glow instead.
  feedBg:             '#14121C',
  goldLine:           'rgba(255,209,102,0.45)',
  goldWash:           'rgba(255,209,102,0.16)',
  panelShadowColor:   'rgba(255,209,102,0.30)',
  toastBg:            '#FFD166',
  toastText:          '#3a2400',

  // Lists tab. Unlike the panel glow above, a row's lift on this surface
  // reads better as a plain black drop.
  cardShadowColor:    'rgba(0,0,0,0.45)',
  segmentThumb:       'rgba(255,255,255,0.13)',

  cardStock:          '#0F1013',
  cardInk:            '#F3EEE4',
  cardMeta:           '#FFD166',
  cardRingTrack:      'rgba(255,255,255,0.10)',

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

  // v0.8 Movie-detail hero — the wash is the same image at lower opacity, so
  // its gold tint eases off with it.
  washTint:           'rgba(197,139,27,0.16)',
  metaMonoFaint:      'rgba(255,255,255,0.40)',
  labelFaint:         'rgba(255,255,255,0.40)',
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

/**
 * One palette colour at a given opacity, for the places that need a *ramp* of
 * one token rather than a new token per step (the Explore mix bar's six
 * difficulty bands, for instance). Deriving them keeps the ramp tied to
 * whatever `gold` currently is in each theme instead of freezing six hexes
 * that then drift when the accent moves.
 *
 * Handles the two shapes the palette actually uses — `#RRGGBB` and
 * `rgb()`/`rgba()`. Anything else is returned untouched rather than mangled,
 * so a future token shape degrades to "solid colour", never to garbage.
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.min(Math.max(alpha, 0), 1);
  const rgb = parseRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

/**
 * One palette colour moved a fraction of the way toward white (`amount > 0`)
 * or black (`amount < 0`). The practice tiles need three tones of the *same*
 * token to read as a lit 3D surface — a bright top, the token itself, a
 * shaded bottom — and there are four tile states, so freezing twelve hexes in
 * the palette would mean twelve places to miss the next time the accent moves.
 *
 * Same contract as {@link withAlpha}: handles `#RGB`, `#RRGGBB` and
 * `rgb()`/`rgba()`, and hands anything else back untouched so an unrecognised
 * token degrades to a flat colour rather than to an invisible view.
 */
export function shade(color: string, amount: number): string {
  const rgb = parseRgb(color);
  if (!rgb) return color;
  const t = Math.min(Math.max(amount, -1), 1);
  const target = t >= 0 ? 255 : 0;
  const mixed = rgb.map((c) => Math.round(c + (target - c) * Math.abs(t)));
  return `rgb(${mixed[0]},${mixed[1]},${mixed[2]})`;
}

/**
 * A blend of two palette colours, `t` of the way from `from` to `to`.
 *
 * {@link shade} is this against white or black; this is the general case, for
 * ramps that run between two *tokens* — so the ramp moves when either end
 * moves, and neither end has to be frozen as a hex somewhere else.
 *
 * Same contract as its neighbours: an unrecognised colour at either end
 * degrades to `from` rather than to garbage, so a future token shape costs a
 * flat colour and not an invisible view.
 *
 * Returns `#RRGGBB`, unlike {@link shade}, which returns `rgb()`. Not a
 * stylistic difference: band colours from this function get an alpha suffix
 * appended by half a dozen call sites (`` `${levelColor}22` `` for a chip
 * fill, `66` for a rule), which is only valid on an 8-digit hex. Handing those
 * an `rgb()` string produces `rgb(255,209,102)22` — not a parse error, just a
 * colour that silently does not render.
 */
export function mix(from: string, to: string, t: number): string {
  const a = parseRgb(from);
  const b = parseRgb(to);
  if (!a || !b) return from;
  const k = Math.min(Math.max(t, 0), 1);
  const blended = a.map((c, i) => Math.round(c + (b[i] - c) * k));
  return `#${blended.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** The two colour shapes the palette actually stores → channels, or null. */
function parseRgb(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((c) => c + c)
            .join('')
        : hex[1];
    const channel = (start: number) => parseInt(digits.slice(start, start + 2), 16);
    return [channel(0), channel(2), channel(4)];
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((p) => Number(p.trim()));
    if ([r, g, b].every((c) => Number.isFinite(c))) return [r, g, b];
  }

  return null;
}
