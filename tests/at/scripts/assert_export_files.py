#!/usr/bin/env python3
"""Assert that a real export produced a non-empty file in a directory."""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--extension", required=True)
    parser.add_argument("--contains", default=None)
    args = parser.parse_args()

    directory = Path(args.directory)
    if not directory.is_dir():
        raise SystemExit(f"export directory does not exist: {directory}")
    files = sorted(p for p in directory.iterdir() if p.is_file() and p.suffix.lower() == args.extension.lower() and p.stat().st_size > 0)
    if not files:
        raise SystemExit(f"no non-empty {args.extension} export in {directory}")
    if args.contains is not None:
        matching = [p for p in files if args.contains in p.read_text(encoding="utf-8", errors="ignore")]
        if not matching:
            raise SystemExit(f"{args.extension} exports do not contain expected text: {args.contains}")
    print("validated export:", ", ".join(str(p) for p in files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
