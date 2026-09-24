"""Tiny forward-only migration runner using PRAGMA user_version."""
from __future__ import annotations

import sqlite3
from importlib import resources


def apply_migrations(conn: sqlite3.Connection, subdir: str) -> int:
    """Apply `NNN_name.sql` files from `firebot/db/<subdir>` newer than user_version."""
    base = resources.files("firebot.db").joinpath(subdir)
    files = sorted((p for p in base.iterdir() if p.name.endswith(".sql")), key=lambda p: p.name)
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for p in files:
        version = int(p.name.split("_")[0])
        if version <= current:
            continue
        try:
            conn.executescript(
                f"BEGIN;\n{p.read_text()}\nPRAGMA user_version = {version};\nCOMMIT;"
            )
        except sqlite3.Error:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        current = version
    return current
