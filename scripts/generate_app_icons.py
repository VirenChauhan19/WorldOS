"""Deterministic WorldOS icons. No generated photographs or external artwork."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def icon(size, transparent=False):
    image = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0) if transparent else "#101b11")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((236, 236, 788, 788), radius=120, outline="#89aa61", width=18)
    draw.line([(320, 380), (395, 644), (512, 456), (629, 644), (704, 380)], fill="#d5edab", width=48, joint="curve")
    draw.ellipse((720, 208, 800, 288), fill="#d5edab")
    return image.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    folder = ROOT / "public" / "icons"
    folder.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("maskable-512.png", 512), ("apple-touch-icon.png", 180)):
        icon(size).convert("RGB").save(folder / name)
    android = ROOT / "android" / "app" / "src" / "main" / "res"
    if android.exists():
        for density, size in (("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)):
            target = android / f"mipmap-{density}"
            target.mkdir(parents=True, exist_ok=True)
            for name in ("ic_launcher.png", "ic_launcher_round.png"):
                icon(size).convert("RGB").save(target / name)
            icon(round(size*108/48), transparent=True).save(target / "ic_launcher_foreground.png")
    ios = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"
    if ios.exists():
        icon(1024).convert("RGB").save(ios / "AppIcon-512@2x.png")
    print("WorldOS PWA icons and any existing native icons generated.")
