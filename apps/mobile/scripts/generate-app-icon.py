#!/usr/bin/env python3
"""Render the WordWise "WW" wordmark into the app's icon assets.

Same mark as the MovieDetailScreen loading splash: a gold "WW" in SF Pro
Black with stacked offset copies behind it faking a 3D extrusion. Colours
come from src/theme/tokens.ts (dark palette) so the icon, the splash and
the in-app loading mark stay one identity.

This is a bare project — ios/ and android/ are committed, so EAS never runs
`expo prebuild` and the `icon`/`adaptiveIcon` keys in app.json do NOT reach a
build. The launcher icons that actually ship are the native ones written
below; the assets/ copies exist for app.json and for a future prebuild.

Run (needs Pillow, which is not an app dependency — use a throwaway venv):

    python3 -m venv /tmp/iconvenv && /tmp/iconvenv/bin/pip install Pillow
    /tmp/iconvenv/bin/python apps/mobile/scripts/generate-app-icon.py
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
SS = 4  # supersample factor; everything is drawn at size*SS then downsampled

# Ratios lifted from splashStyles.mark: fontSize 76, letterSpacing -2, and
# extrusion depths running 1..7px behind the face.
TRACKING_RATIO = -2 / 76
EXTRUDE_RATIO = 7 / 76
EXTRUDE_STEPS = 96  # smooth walls (the on-screen mark uses 7 whole pixels)

# How wide the face sits inside each canvas. A full square shows the mark at
# its largest; anything a launcher may mask to a circle has to pull in far
# enough that the mark's corners survive the crop.
SQUARE_WIDTH_RATIO = 0.62
CIRCLE_WIDTH_RATIO = 0.52  # Android adaptive foreground + round legacy icon
SPLASH_WIDTH_RATIO = 0.60

FONT_PATH = "/System/Library/Fonts/SFNS.ttf"
FONT_VARIATION = "Black"  # what RN's fontWeight: '900' picks on iOS
TEXT = "WW"

MOBILE = Path(__file__).resolve().parent.parent
ASSETS = MOBILE / "assets"
IOS_APPICON = MOBILE / "ios/WordWise/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"
ANDROID_RES = MOBILE / "android/app/src/main/res"

# px per density for (legacy ic_launcher, adaptive ic_launcher_foreground).
# Matches the sizes Expo's template shipped, so nothing else has to change.
DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}


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


def render(
    width_ratio: float,
    background: str | None,
    size: int = SIZE,
    circle: bool = False,
) -> Image.Image:
    """One square icon. `circle` clips the field to a disc (Android round icon)."""
    big = size * SS
    canvas = Image.new("RGBA", (big, big), background or (0, 0, 0, 0))

    if circle and background is not None:
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
        canvas.putalpha(mask)

    # Solve the font size that makes the face exactly `width_ratio` wide.
    probe_px = 100
    probe_font = _font(probe_px)
    _, probe_advance = _glyph_positions(probe_font, probe_px * TRACKING_RATIO)
    font_px = probe_px * (big * width_ratio) / probe_advance

    _draw_mark(canvas, font_px, (big / 2, big / 2))
    return canvas.resize((size, size), Image.LANCZOS)


def save(image: Image.Image, path: Path, opaque: bool = False) -> None:
    # iOS rejects app icons carrying an alpha channel.
    if opaque:
        image = image.convert("RGB")
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, lossless=True) if path.suffix == ".webp" else image.save(path)
    print(f"wrote {path.relative_to(MOBILE)}")


def main() -> None:
    # 1. Bundled assets — app.json's icon/splash keys, and what a prebuild uses.
    save(render(SQUARE_WIDTH_RATIO, INK), ASSETS / "icon.png", opaque=True)
    save(render(CIRCLE_WIDTH_RATIO, None), ASSETS / "adaptive-icon.png")
    save(render(SPLASH_WIDTH_RATIO, None), ASSETS / "splash-icon.png")

    # 2. iOS — the icon that actually ships, straight into the asset catalog.
    save(render(SQUARE_WIDTH_RATIO, INK), IOS_APPICON, opaque=True)

    # 3. Android — legacy square + round icons and the adaptive foreground.
    #    The adaptive background is @color/iconBackground in values/colors.xml.
    for density, (legacy_px, foreground_px) in DENSITIES.items():
        out = ANDROID_RES / f"mipmap-{density}"
        save(render(SQUARE_WIDTH_RATIO, INK, legacy_px), out / "ic_launcher.webp")
        save(
            render(CIRCLE_WIDTH_RATIO, INK, legacy_px, circle=True),
            out / "ic_launcher_round.webp",
        )
        save(
            render(CIRCLE_WIDTH_RATIO, None, foreground_px),
            out / "ic_launcher_foreground.webp",
        )


if __name__ == "__main__":
    main()
