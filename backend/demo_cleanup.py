"""Remove only expired visitor stores; owner and judge stores are never touched."""
import asyncio
import re
import shutil
import time


def cleanup_demo_spaces(directory, now=None):
    root = directory / 'public-demo'
    if not root.exists() or root.is_symlink():
        return
    root = root.resolve()
    cutoff = (time.time() if now is None else now) - 86400
    for entry in root.iterdir():
        if entry.is_symlink() or not entry.is_dir() or not re.fullmatch('[0-9a-f]{64}', entry.name):
            continue
        target = entry.resolve()
        # Verify the final recursive-delete target stays inside this app's demo root.
        if target.parent != root:
            continue
        database = target / 'worldos.sqlite3'
        if database.is_file() and not database.is_symlink() and database.stat().st_mtime < cutoff:
            shutil.rmtree(target)


async def demo_cleanup_loop(directory):
    while True:
        try:
            await asyncio.to_thread(cleanup_demo_spaces, directory)
        except OSError:
            # A busy/removed directory can be retried next hour.
            pass
        await asyncio.sleep(3600)
