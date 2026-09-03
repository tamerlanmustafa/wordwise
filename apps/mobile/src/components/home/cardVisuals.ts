/**
 * Pure visual maths for the home-feed movie card (RankedMovieList).
 *
 * Everything here is deterministic and free of React/native imports so it can
 * be unit-tested directly, and so the gradient stop arrays can be built once
 * per theme at module scope rather than per card per render — with eight cards
 * on screen and FlashList recycling, that allocation is the one real perf risk
 * in the card redesign.
 *
 * The card's surface is a single stock colour, identical on every row. The
 * backdrop sits behind it at reduced opacity and readability comes from a
 * horizontal gradient *in that same stock colour* — so the card background,
 * the scrim and the level-ring hole must all share one RGB or seams appear.
 */

export type Rgb = [number, number, number];

/** Gradient stops in the shape expo-linear-gradient's tuple types want. */
export interface GradientStops {
  colors: readonly [string, string, ...string[]];
  locations: readonly [number, number, ...number[]];
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function rgba([r, g, b]: Rgb, a: number): string {
  return `rgba(${r},${g},${b},${round4(a)})`;
}

/** Alphas/locations carry long tails off the easing curve; 4dp is plenty. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ── Backdrop ───────────────────────────────────────────────────────────────
// TMDB backdrops are always 16:9 (w780 = 780×439), so at the card's 116pt
// height the full frame is exactly 206pt wide. Right-anchoring a `contain`
// image at that width shows the *whole* still — the previous `cover` threw
// away roughly half the image's height.

/** Card height (116) × 16/9 — the full 16:9 frame at card height. */
export const BACKDROP_W = 206;
export const BACKDROP_OPACITY = 0.6;

// ── Scrim ──────────────────────────────────────────────────────────────────

/** Where the falloff begins. This is the readability dial — never a black layer. */
export const SCRIM_REACH = 0.62;

/**
 * The load-bearing part: a horizontal gradient in the card's own stock colour,
 * near-opaque behind the type and eased to nothing by the right edge where the
 * still reads at full strength. 13 stops on an ease-out curve, so no step reads
 * as an edge.
 */
export function buildScrim(stock: Rgb, reach: number = SCRIM_REACH): GradientStops {
  const head = reach * 42;
  const colors: string[] = [rgba(stock, 0.97)];
  const locations: number[] = [0];

  for (let k = 0; k <= 12; k++) {
    const p = k / 12;
    locations.push(round4((head + (100 - head) * p) / 100));
    colors.push(rgba(stock, 0.95 * Math.pow(1 - p, 2.1)));
  }

  return {
    colors: colors as unknown as GradientStops['colors'],
    locations: locations as unknown as GradientStops['locations'],
  };
}

// ── Left edge fade ─────────────────────────────────────────────────────────
// The image's left edge lands around 45% across the card, where the scrim is
// only ~50% opaque — enough that a hard vertical edge shows. The mockup masks
// the image's left half to transparent; masked-view isn't a dependency and
// isn't worth adding for this, so an equivalent stock-coloured gradient is
// laid over the image's left half instead.
//
// Stops below are `[position across the image's own width, mask alpha]`. The
// overlay inverts the alpha (1 - mask) and rescales the positions from the
// image's 0–50% span onto the overlay's own 0–100% width, which is what makes
// it visually equivalent rather than twice as steep.

const EDGE_MASK_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0],
  [0.09, 0.06],
  [0.16, 0.2],
  [0.24, 0.45],
  [0.32, 0.72],
  [0.4, 0.9],
  [0.5, 1],
];

/** Half the backdrop — the span the fade covers. */
export const EDGE_FADE_W = BACKDROP_W / 2;

export function buildEdgeFade(stock: Rgb): GradientStops {
  return {
    colors: EDGE_MASK_STOPS.map(([, a]) => rgba(stock, 1 - a)) as unknown as GradientStops['colors'],
    locations: EDGE_MASK_STOPS.map(([p]) => round4(p / 0.5)) as unknown as GradientStops['locations'],
  };
}

// ── Plus ink (dynamic contrast) ────────────────────────────────────────────
// The add-to-list glyph sits over the top-right of the backdrop — exactly
// where the image is least covered by the scrim — so a fixed gold vanishes on
// roughly a third of real backdrops. Pick the ink by WCAG contrast against
// what's actually behind it.

export const PLUS_INK_DARK: Rgb = [16, 14, 18];
export const PLUS_INK_LIGHT: Rgb = [255, 250, 240];

export function relativeLuminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** What the eye actually sees: `fg` painted at `opacity` over `bg`. */
export function compositeOver(fg: Rgb, bg: Rgb, opacity: number): Rgb {
  return [0, 1, 2].map((i) => bg[i] * (1 - opacity) + fg[i] * opacity) as Rgb;
}

/**
 * `corner` is the average RGB of the backdrop's top-right patch (stored on the
 * movie — never sampled on device: TMDB serves without permissive CORS,
 * decoding per row costs frames, and the value never changes). `ground` is the
 * card stock the backdrop is composited onto.
 */
export function pickPlusInk(corner: Rgb, ground: Rgb, opacity: number = BACKDROP_OPACITY): string {
  const eff = compositeOver(corner, ground, opacity);
  return contrastRatio(PLUS_INK_DARK, eff) >= contrastRatio(PLUS_INK_LIGHT, eff)
    ? 'rgb(16,14,18)'
    : 'rgb(255,250,240)';
}

/** Reads back an `rgb(r,g,b)` or `#rrggbb` string. Null if it's neither. */
export function parseInk(ink: string): Rgb | null {
  if (ink.startsWith('#')) return hexToRgb(ink);
  const m = ink.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * A tight counter-coloured halo, so the glyph survives a bright or dark detail
 * that the corner average hid.
 *
 * Chosen off the ink's own luminance rather than by matching the two inks
 * `pickPlusInk` returns: when the corner average is missing the caller falls
 * back to `cardMeta`, and gold is light enough that a light halo would smear
 * it into a bright backdrop instead of separating it. Both designed inks land
 * on the same halo they always did.
 */
export function plusHalo(ink: string) {
  const rgb = parseInk(ink);
  const isLightInk = rgb ? relativeLuminance(rgb) > 0.5 : false;
  return {
    textShadowColor: isLightInk ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  };
}

/** Reads the ingest-supplied corner average off a movie row, if it has one. */
export function parseCornerRgb(value: unknown): Rgb | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const rgb = value.slice(0, 3).map(Number);
  if (rgb.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) return null;
  return rgb as Rgb;
}

/**
 * The corner average to colour the glyph from — or null to keep the gold +
 * halo fallback.
 *
 * Ingest samples the still's top-**right** patch (#115). The card places both
 * the backdrop and the glyph with `end:`, so under RTL they mirror to the left
 * while the image's own pixels do not: the glyph then sits over a corner
 * nothing measured. Colouring from the opposite corner is worse than not
 * colouring at all — it is confidently wrong, where the fallback is merely
 * unoptimised and is what every card renders today.
 */
export function cornerForGlyph(value: unknown, isRtl: boolean): Rgb | null {
  return isRtl ? null : parseCornerRgb(value);
}

// ── Card geometry ──────────────────────────────────────────────────────────
// Shared with `FeedSkeleton`, which draws the placeholder shown while the feed
// loads. The skeleton used to carry its own numbers — a 64x96 portrait poster
// with two text lines beside it — which was the row layout from *before* the
// card redesign. Nothing failed when the card became a 116pt full-width
// backdrop tile; the skeleton simply went on describing a screen that no
// longer existed, and the feed jumped shape the moment the data landed.
//
// Placeholders are only worth having if they are the size of the thing they
// stand in for, so the numbers live here and both sides read them.

/** Height of one card. */
export const CARD_H = 116;
/** Vertical space between two cards. */
export const CARD_GAP = 8;
/** Row pitch — what a list has to reserve per item. */
export const ITEM_H = CARD_H + CARD_GAP;
/** Card corner radius. */
export const CARD_RADIUS = 14;
/** Inset from the card's leading edge to the ring. */
export const CARD_PAD_START = 14;
/** Gap between the ring and the title block. */
export const CARD_ROW_GAP = 13;

// ── Vocabulary ring ────────────────────────────────────────────────────────
// One 44pt ring: the count of distinct words the film speaks, over the word
// WORDS, with the arc drawn against a typical film on the same shelf (see
// ./filmVocabulary). r=20 with a 4pt stroke spans 18–22, so the hole is
// exactly 36pt across and the stock-filled disc that covers it is too.
//
// The geometry has now outlived four different metrics in the hole — that is
// the point of keeping it here, decoupled from whatever the ring means today.

export const RING_SIZE = 44;
export const RING_STROKE = 4;
export const RING_R = 20;
export const RING_HOLE = 2 * (RING_R - RING_STROKE / 2);
export const RING_C = 2 * Math.PI * RING_R;

/** Dash offset for the progress arc. A null percentage leaves the track bare. */
export function ringDashOffset(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return RING_C;
  const clamped = Math.max(0, Math.min(100, pct));
  return RING_C * (1 - clamped / 100);
}
