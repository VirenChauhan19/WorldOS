"""Download two public licensed benchmark photos, without making AI inference calls."""
import hashlib
from pathlib import Path
from urllib.request import urlopen

PHOTOS = [
    ("zesan-desk.jpg", "https://images.unsplash.com/photo-1635348800731-f836c390b33d?auto=format&fit=max&w=1600&q=90"),
    ("jakub-desk.jpg", "https://images.unsplash.com/photo-1717390996865-57d607483101?auto=format&fit=max&w=1600&q=90"),
]

if __name__ == "__main__":
    folder = Path(__file__).resolve().parents[1] / "artifacts" / "real-desk"
    folder.mkdir(parents=True, exist_ok=True)
    for name, url in PHOTOS:
        path = folder / name
        if not path.exists():
            with urlopen(url, timeout=30) as response:
                data = response.read(12 * 1024 * 1024 + 1)
            if len(data) > 12 * 1024 * 1024:
                raise ValueError("Photograph exceeded the upload limit.")
            path.write_bytes(data)
        print(f"{name}: sha256={hashlib.sha256(path.read_bytes()).hexdigest()}")
