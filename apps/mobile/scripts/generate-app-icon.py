#!/usr/bin/env python3
"""Render the WordWise "WW" wordmark into the app's icon assets.

Same mark as the MovieDetailScreen loading splash: a gold "WW" in SF Pro
Black with stacked offset copies behind it faking a 3D extrusion. Colours
come from src/theme/tokens.ts (dark palette) so the icon, the splash and
the in-app loading mark stay one identity.

Run (needs Pillow, which is not an app dependency — use a throwaway venv):

    python3 -m venv /tmp/iconvenv && /tmp/iconvenv/bin/pip install Pillow
    /tmp/iconvenv/bin/python apps/mobile/scripts/generate-app-icon.py

Writes assets/icon.png, assets/adaptive-icon.png and assets/splash-icon.png.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# --- palette (src/theme/tokens.ts, dark) -----------------------------------
GOLD = "#FFD166"       # tc.gold — the face of the mark
GOLD_DEEP = "#3a2400"  # tc.goldDeep — the extruded side walls
INK = "#0e0d10"        # tc.background (dark) — icon field

# --- geometry --------------------------------------------------------------
SIZE = 1024
SS = 4  # supersample factor; everything is drawn at SIZE*SS then downsampled

# Ratios lifted from splashStyles.mark: fontSize 76, letterSpacing -2, and
# extrusion depths running 1..7px behind the face.
TRACKING_RATIO = -2 / 76
EXTRUDE_RATIO = 7 / 76
EXTRUDE_STEPS = 96  # smooth walls (the on-screen mark uses 7 whole pixels)

# How wide the face sits inside each canvas. iOS shows the full square, so the
# mark can run wider; Android masks the adaptive foreground down to a circle,
# so its mark has to stay inside the ~66% safe zone.
ICON_WIDTH_RATIO = 0.62
ADAPTIVE_WIDTH_RATIO = 0.46
SPLASH_WIDTH_RATIO = 0.60

FONT_PATH = "/System/Library/Fonts/SFNS.ttf"
FONT_VARIATION = "Black"  # what RN's fontWeight: '900' picks on iOS
TEXT = "WW"

ASSETS = Path(__file__).resolve().parent.parent / "assets"


def _font(px: float) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(FONT_PATH, int(round(px)))
    font.set_variation_by_name(FONT_VARIATION)
    return font


def _glyph_positions(font: ImageFont.FreeTypeFont, tracking: float):
    """x offsets for each glyph plus the total advance, applying tracking."""
    xs, x = [], 0.0
    for ch in TEXT:
        xs.append(x)
        x += font.getlength(ch) + tracking
    return xs, x - tracking


def _draw_mark(canvas: Image.Image, font_px: float, center: tuple[float, float]) -> None:
    """Paint the extruded mark centred on `center` (canvas is already SS-scaled)."""
    font = _font(font_px)
    tracking = font_px * TRACKING_RATIO
    depth = font_px * EXTRUDE_RATIO
    xs, advance = _glyph_positions(font, tracking)

    # Ink extent of the face, so the mark is centred on its glyphs rather than
    # on the font's line box (SF Pro's box carries a lot of empty leading).
    probe = Image.new("L", (1, 1))
    box = ImageDraw.Draw(probe).textbbox((0, 0), TEXT, font=font)
    cx, cy = center
    # Centre the whole extruded mass (face + walls), not just the face.
    ox = cx - (advance + depth) / 2
    oy = cy - (box[1] + box[3] + depth) / 2

    draw = ImageDraw.Draw(canvas)

    def stamp(dx: float, dy: float, colour: str) -> None:
        for x_off, ch in zip(xs, TEXT):
            draw.text((ox + x_off + dx, oy + dy), ch, font=font, fill=colour)

    # Walls first, deepest to shallowest, then the face lands on top.
    for i in range(EXTRUDE_STEPS, 0, -1):
        d = depth * i / EXTRUDE_STEPS
        stamp(d, d, GOLD_DEEP)
    stamp(0, 0, GOLD)


def render(width_ratio: float, background: str | None) -> Image.Image:
    big = SIZE * SS
    canvas = Image.new("RGBA", (big, big), background or (0, 0, 0, 0))

    # Solve the font size that makes the face exactly `width_ratio` wide.
    probe_px = 100
    probe_font = _font(probe_px)
    _, probe_advance = _glyph_positions(probe_font, probe_px * TRACKING_RATIO)
    font_px = probe_px * (big * width_ratio) / probe_advance

    _draw_mark(canvas, font_px, (big / 2, big / 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    outputs = [
        ("icon.png", ICON_WIDTH_RATIO, INK),           # iOS/Android launcher icon
        ("adaptive-icon.png", ADAPTIVE_WIDTH_RATIO, None),  # Android foreground layer
        ("splash-icon.png", SPLASH_WIDTH_RATIO, None),      # launch screen mark
    ]
    for name, ratio, background in outputs:
        image = render(ratio, background)
        # iOS rejects icons with an alpha channel; the transparent layers keep theirs.
        if background is not None:
            image = image.convert("RGB")
        image.save(ASSETS / name)
        print(f"wrote {ASSETS / name}")


if __name__ == "__main__":
    main()
