/**
 * useJourneyLayout — pure layout math for the winding upward path.
 *
 * The contract forbids:
 *   - uniform spacing grids
 *   - linear staircase zig-zag
 *
 * So we place each node on a sine-modulated X axis with sine-modulated
 * vertical spacing, and we hand back a quadratic-Bezier SVG path string
 * that reads as a smoothly curving road rather than a series of 90°
 * corners. Pure function → unit-testable → identical on web and mobile.
 */

export interface LayoutNodeInput {
  id: string;
  level: string;
  state: 'locked' | 'active' | 'inactive' | 'completed';
}

export interface LayoutNodeOutput extends LayoutNodeInput {
  x: number;       // center X of the node, canvas-relative
  y: number;       // center Y of the node, canvas-relative (0 = top)
  index: number;   // position in the bottom-up sequence (0 = user's current level)
}

export interface JourneyLayout {
  nodes: LayoutNodeOutput[];
  totalHeight: number;   // canvas height
  pathD: string;         // SVG <Path d="..."> connecting all nodes
  activeY: number | null;// Y of the active node (for auto-scroll)
}

const BASE_SPACING = 150;   // px between node centers (midline)
const Y_JITTER = 0.10;      // ±10% variance in spacing, sine-driven
const X_AMPLITUDE = 0.22;   // fraction of canvas width the sine swings across
const X_PHASE = 0.9;        // sine frequency along the index axis
const MARGIN_TOP = 80;
const MARGIN_BOTTOM = 80;

/**
 * Compute node coordinates + an SVG path connecting them.
 *
 * @param nodes  ordered bottom-up: index 0 is the node drawn LOWEST on
 *               screen (the user's current level / active), the last
 *               element is the highest level reachable (e.g. C2).
 * @param width  canvas width in px.
 */
export function computeJourneyLayout(
  nodes: LayoutNodeInput[],
  width: number,
): JourneyLayout {
  const centerX = width / 2;
  const deviation = width * X_AMPLITUDE;

  // We lay out bottom-up in "journey space" (index 0 at bottom), but the
  // SVG canvas is y=0 at the top, so we compute cumulative offsets and
  // then flip.
  const placed: Array<LayoutNodeOutput & { offsetFromBottom: number }> = [];
  let cumulative = MARGIN_BOTTOM;
  for (let i = 0; i < nodes.length; i++) {
    // X: sine wave around the centerline — smooth, organic, never a
    // staircase.
    const x = centerX + Math.sin(i * X_PHASE) * deviation;
    // Spacing: each gap is ±Y_JITTER% of base, driven by a second,
    // faster sine. Zero-out the first node's gap so it sits at
    // MARGIN_BOTTOM exactly.
    const jitter = i === 0 ? 0 : Math.sin(i * 1.3) * Y_JITTER;
    const spacing = i === 0 ? 0 : BASE_SPACING * (1 + jitter);
    cumulative += spacing;
    placed.push({ ...nodes[i], x, y: 0, index: i, offsetFromBottom: cumulative });
  }

  const totalHeight = cumulative + MARGIN_TOP;

  // Flip to screen coords (top = 0).
  const out: LayoutNodeOutput[] = placed.map((p) => ({
    id: p.id,
    level: p.level,
    state: p.state,
    index: p.index,
    x: p.x,
    y: totalHeight - p.offsetFromBottom,
  }));

  // Build the SVG path as quadratic Beziers. Each segment's control point
  // is offset away from the midline to exaggerate the curve so it reads
  // as a road, not a polyline. Nodes are ordered bottom-up, so we walk
  // them in reverse to draw top-down (matching normal SVG flow) — keeps
  // dasharray / stroke animations predictable.
  const topToBottom = [...out].sort((a, b) => a.y - b.y);
  let d = '';
  topToBottom.forEach((n, i) => {
    if (i === 0) {
      d += `M ${n.x.toFixed(1)} ${n.y.toFixed(1)}`;
      return;
    }
    const prev = topToBottom[i - 1];
    const midY = (prev.y + n.y) / 2;
    // Control point biased AWAY from the centerline, exaggerating the
    // curve of each segment.
    const curveBias = ((prev.x + n.x) / 2 - centerX) * 1.8 + centerX;
    d += ` Q ${curveBias.toFixed(1)} ${midY.toFixed(1)}, ${n.x.toFixed(1)} ${n.y.toFixed(1)}`;
  });

  const active = out.find((n) => n.state === 'active');
  return {
    nodes: out,
    totalHeight,
    pathD: d,
    activeY: active ? active.y : null,
  };
}
