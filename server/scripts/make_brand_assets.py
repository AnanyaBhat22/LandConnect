"""Generate the app icon and splash images from the LandConnect logo design.

Run from server/:  .venv\\Scripts\\python -m scripts.make_brand_assets

Writes into ../app/assets/. The mark mirrors src/components/Brand.tsx: an
emerald tile with a white and a pale-mint "paper" shape meeting at an amber
dot. Drawing it in code (instead of hand-made PNGs) keeps the icon, splash
and in-app logo consistent and reproducible.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parents[2] / "app" / "assets"
DARK = "#12251E"
EMERALD = "#167A5B"
WHITE = "#FFFFFF"
PALE_MINT = "#A9D3C3"
AMBER = "#F2A12E"
SS = 4  # supersampling factor for smooth edges


def draw_mark(draw: ImageDraw.ImageDraw, ox: float, oy: float, size: float, mono: bool = False) -> None:
    """Draw the two shapes + dot inside a size×size box at (ox, oy). Design units are 0..72."""
    u = size / 72
    p = lambda x, y: (ox + x * u, oy + y * u)  # noqa: E731
    draw.polygon([p(14, 17), p(41, 13), p(39, 37), p(15, 40)], fill=WHITE)  # white "paper", tilted left
    draw.polygon([p(33, 33), p(58, 31), p(57, 58), p(31, 59)], fill=WHITE if mono else PALE_MINT)  # pale mint, tilted right
    r = 5.2 * u
    cx, cy = p(36, 35.5)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE if mono else AMBER)


def canvas(size: int, color=(0, 0, 0, 0)) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (size * SS, size * SS), color)
    return img, ImageDraw.Draw(img)


def save(img: Image.Image, name: str, size: int) -> None:
    img.resize((size, size), Image.LANCZOS).save(ASSETS / name)
    print("wrote", ASSETS / name)


def main() -> None:
    S = 1024
    big = S * SS

    # Legacy/iOS icon: full emerald square with the mark (the OS rounds the corners).
    img, d = canvas(S, EMERALD)
    draw_mark(d, big * 0.14, big * 0.14, big * 0.72)
    save(img, "icon.png", S)

    # Android adaptive icon: solid background + mark in the central safe zone (~66%).
    img, d = canvas(S, EMERALD)
    save(img, "android-icon-background.png", S)
    img, d = canvas(S)
    draw_mark(d, big * 0.22, big * 0.22, big * 0.56)
    save(img, "android-icon-foreground.png", S)
    img, d = canvas(S)
    draw_mark(d, big * 0.22, big * 0.22, big * 0.56, mono=True)
    save(img, "android-icon-monochrome.png", S)

    # Splash: rounded emerald tile with the mark, on the dark brand background (set in app.json).
    img, d = canvas(S)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.25, fill=EMERALD)
    draw_mark(d, 0, 0, big)
    save(img, "splash-icon.png", S)

    # Web favicon (small).
    img, d = canvas(64, EMERALD)
    draw_mark(d, 0, 0, 64 * SS)
    save(img, "favicon.png", 64)


if __name__ == "__main__":
    main()
