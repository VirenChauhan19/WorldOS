"""Generate the WorldOS forest-and-lime mark used by the application shell.

Use --web-only to update PWA assets without touching native platform projects.
The mark fits within the central maskable safe circle at every output size.
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def icon(size, transparent=False):
    image = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0) if transparent else "#213d35")
    draw = ImageDraw.Draw(image)
    # Same 32-unit path as DeviceChrome.tsx and public/icons/icon.svg.
    paths = [[(5, 10), (11, 24), (16, 14), (21, 24), (27, 10)],
             [(11, 8), (16, 14), (21, 8)]]
    stroke = 60
    for path in paths:
        points = [(128 + x * 24, 128 + y * 24) for x, y in path]
        draw.line(points, fill="#d5ef85", width=stroke, joint="curve")
        for x, y in points:
            draw.ellipse((x-stroke/2, y-stroke/2, x+stroke/2, y+stroke/2), fill="#d5ef85")
    return image.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web-only", action="store_true", help="Generate public PWA icons only.")
    args = parser.parse_args()
    folder = ROOT / "public" / "icons"
    folder.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("maskable-512.png", 512), ("apple-touch-icon.png", 180)):
        icon(size).convert("RGB").save(folder / name)
    android = ROOT / "android" / "app" / "src" / "main" / "res"
    if not args.web_only and android.exists():
        for density, size in (("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)):
            target = android / f"mipmap-{density}"
            target.mkdir(parents=True, exist_ok=True)
            for name in ("ic_launcher.png", "ic_launcher_round.png"):
                icon(size).convert("RGB").save(target / name)
            icon(round(size*108/48), transparent=True).save(target / "ic_launcher_foreground.png")
    ios = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"
    if not args.web_only and ios.exists():
        icon(1024).convert("RGB").save(ios / "AppIcon-512@2x.png")
    print("WorldOS PWA icons generated." if args.web_only else "WorldOS PWA icons and any existing native icons generated.")
