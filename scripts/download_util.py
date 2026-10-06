"""Resumable-safe download helper for the speaker-ID scripts (not run directly)."""
from __future__ import annotations

import os
import tarfile
import urllib.request
from pathlib import Path


def download_atomic(url: str, dest: Path) -> Path:
    """Download to dest.part and rename on success, so an interrupted run never leaves a
    half-written file that later looks complete. Also discards a corrupt existing tarball."""
    if dest.exists() and dest.suffixes[-2:] == [".tar", ".gz"] and not _tar_ok(dest):
        print(f"{dest} is incomplete or corrupt; downloading again")
        dest.unlink()
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    print(f"downloading {url} ...")
    try:
        urllib.request.urlretrieve(url, part)
        os.replace(part, dest)
    finally:
        if part.exists():
            part.unlink()
    return dest


def _tar_ok(path: Path) -> bool:
    try:
        with tarfile.open(path) as t:
            while t.next() is not None:  # walks every member header, so a truncated file fails
                pass
        return True
    except (EOFError, tarfile.TarError, OSError):
        return False
