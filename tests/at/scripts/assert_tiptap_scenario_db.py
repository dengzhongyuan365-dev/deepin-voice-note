#!/usr/bin/env python3
# _*_ coding:utf-8 _*_
"""Assert deepin-voice-note Tiptap scenario DB result against expected YAML.

This script intentionally compares only stable business fields instead of the
whole sqlite database, because timestamps, sqlite_sequence and JSON key order are
runtime-dependent.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except Exception as exc:  # pragma: no cover - environment guard
    print(f"ERROR: PyYAML is required to read expected template: {exc}", file=sys.stderr)
    sys.exit(2)


def default_db_path() -> Path:
    return (
        Path.home()
        / ".local/share/deepin/deepin-voice-note/deepin-voice-note1.0.db"
    )


def load_expected(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise ValueError(f"expected template must be a mapping: {path}")
    return data


def note_text_from_tiptap_node(node: Any) -> str:
    """Flatten text fields from a Tiptap/ProseMirror JSON node."""
    if isinstance(node, dict):
        parts: list[str] = []
        text = node.get("text")
        if isinstance(text, str):
            parts.append(text)
        content = node.get("content")
        if isinstance(content, list):
            parts.extend(note_text_from_tiptap_node(child) for child in content)
        return "".join(parts)
    if isinstance(node, list):
        return "".join(note_text_from_tiptap_node(child) for child in node)
    return ""


def iter_tiptap_nodes(node: Any, node_type: str | None = None):
    """Yield ProseMirror/Tiptap nodes, optionally filtered by node type."""
    if isinstance(node, dict):
        if node_type is None or node.get("type") == node_type:
            yield node
        content = node.get("content")
        if isinstance(content, list):
            for child in content:
                yield from iter_tiptap_nodes(child, node_type)
    elif isinstance(node, list):
        for child in node:
            yield from iter_tiptap_nodes(child, node_type)


def count_tiptap_nodes(node: Any, node_type: str) -> int:
    """Count nodes by ProseMirror/Tiptap type."""
    return sum(1 for _ in iter_tiptap_nodes(node, node_type))


def tiptap_image_relpaths(meta: dict[str, Any]) -> list[str]:
    """Return saved relative paths for image nodes in a Tiptap document."""
    relpaths: list[str] = []
    for node in iter_tiptap_nodes(meta.get("content"), "image"):
        attrs = node.get("attrs")
        if not isinstance(attrs, dict):
            continue
        rel_path = attrs.get("relPath") or attrs.get("data-rel-path")
        if rel_path is None:
            # Some intermediate documents only keep src.  Keep it visible in
            # diagnostics while making prefix/existence checks fail explicitly.
            rel_path = attrs.get("src")
        if rel_path is not None:
            relpaths.append(str(rel_path))
    return relpaths


def parse_metadata(raw: str | None) -> tuple[dict[str, Any], str]:
    if not raw:
        return {}, ""
    try:
        meta = json.loads(raw)
    except json.JSONDecodeError:
        return {}, raw
    return meta, note_text_from_tiptap_node(meta.get("content"))


def fetch_folder(conn: sqlite3.Connection, title: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT folder_id, folder_name
          FROM vnote_folder_tbl
         WHERE folder_state = 0 AND folder_name = ?
         ORDER BY folder_id DESC
         LIMIT 1
        """,
        (title,),
    ).fetchone()


def fetch_notes(conn: sqlite3.Connection, folder_id: int) -> dict[str, list[sqlite3.Row]]:
    rows = conn.execute(
        """
        SELECT note_id, folder_id, note_title, meta_data
          FROM vnote_items_tbl
         WHERE note_state = 0 AND folder_id = ?
         ORDER BY note_id
        """,
        (folder_id,),
    ).fetchall()
    result: dict[str, list[sqlite3.Row]] = {}
    for row in rows:
        result.setdefault(row["note_title"], []).append(row)
    return result


def fail(errors: list[str], message: str) -> None:
    errors.append(message)
    print(f"[FAIL] {message}")


def ok(message: str) -> None:
    print(f"[ OK ] {message}")


def as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def assert_note_content(title: str, note_expect: dict[str, Any], meta: dict[str, Any], text: str, errors: list[str], db_data_dir: Path) -> None:
    for expected_content in as_list(note_expect.get("content_contains")):
        if str(expected_content) not in text:
            fail(
                errors,
                f"{title}: content not found actual_text={text!r}, expected_contains={expected_content!r}",
            )
        else:
            ok(f"{title}: content contains {expected_content!r}")

    expected_equals = note_expect.get("content_equals")
    if expected_equals is not None:
        if text != str(expected_equals):
            fail(errors, f"{title}: content mismatch actual_text={text!r}, expected={expected_equals!r}")
        else:
            ok(f"{title}: content equals {expected_equals!r}")

    for not_expected in as_list(note_expect.get("content_not_contains")):
        if str(not_expected) in text:
            fail(errors, f"{title}: unexpected content found actual_text={text!r}, not_expected={not_expected!r}")
        else:
            ok(f"{title}: content does not contain {not_expected!r}")

    not_equals = note_expect.get("content_not_equals")
    if not_equals is not None:
        if text == str(not_equals):
            fail(errors, f"{title}: content unexpectedly equals {not_equals!r}")
        else:
            ok(f"{title}: content does not equal {not_equals!r}")

    min_paragraph_count = note_expect.get("min_paragraph_count")
    if min_paragraph_count is not None:
        paragraph_count = count_tiptap_nodes(meta.get("content"), "paragraph")
        expected_count = int(min_paragraph_count)
        if paragraph_count < expected_count:
            fail(
                errors,
                f"{title}: paragraph count < expected actual={paragraph_count}, expected>={expected_count}",
            )
        else:
            ok(f"{title}: paragraph count actual={paragraph_count}, expected>={expected_count}")

    image_count_expect = note_expect.get("image_count")
    image_relpaths = tiptap_image_relpaths(meta)
    image_count = count_tiptap_nodes(meta.get("content"), "image")
    if image_count_expect is not None:
        expected_count = int(image_count_expect)
        if image_count != expected_count:
            fail(errors, f"{title}: image count mismatch actual={image_count}, expected={expected_count}, relpaths={image_relpaths!r}")
        else:
            ok(f"{title}: image count={image_count}")

    min_image_count = note_expect.get("min_image_count")
    if min_image_count is not None:
        expected_count = int(min_image_count)
        if image_count < expected_count:
            fail(errors, f"{title}: image count < expected actual={image_count}, expected>={expected_count}, relpaths={image_relpaths!r}")
        else:
            ok(f"{title}: image count actual={image_count}, expected>={expected_count}")

    max_image_count = note_expect.get("max_image_count")
    if max_image_count is not None:
        expected_count = int(max_image_count)
        if image_count > expected_count:
            fail(errors, f"{title}: image count > expected actual={image_count}, expected<={expected_count}, relpaths={image_relpaths!r}")
        else:
            ok(f"{title}: image count actual={image_count}, expected<={expected_count}")

    relpath_prefix = note_expect.get("image_relPath_prefix")
    if relpath_prefix is not None:
        prefix = str(relpath_prefix)
        if not image_relpaths:
            fail(errors, f"{title}: no image relPath found, expected prefix={prefix!r}")
        else:
            bad_paths = [path for path in image_relpaths if not path.startswith(prefix)]
            if bad_paths:
                fail(errors, f"{title}: image relPath prefix mismatch bad_paths={bad_paths!r}, expected_prefix={prefix!r}")
            else:
                ok(f"{title}: image relPath prefix={prefix!r}")

    if note_expect.get("image_files_exist") is not None:
        should_exist = bool(note_expect.get("image_files_exist"))
        db_dir = Path(note_expect.get("db_data_dir") or db_data_dir)
        if not image_relpaths and should_exist:
            fail(errors, f"{title}: no image relPath found for file existence check")
        for relpath in image_relpaths:
            image_path = db_dir / relpath
            if image_path.exists() != should_exist:
                fail(errors, f"{title}: image file existence mismatch path={image_path}, expected_exists={should_exist}")
            else:
                ok(f"{title}: image file exists={should_exist}: {image_path}")


def assert_db(expected: dict[str, Any], db_path: Path) -> int:
    if not db_path.exists():
        print(f"ERROR: database not found: {db_path}", file=sys.stderr)
        return 2

    folder_expect = expected.get("expected_folder") or {}
    folder_title = folder_expect.get("title")
    if not folder_title:
        print("ERROR: expected_folder.title is required", file=sys.stderr)
        return 2

    errors: list[str] = []
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        folder = fetch_folder(conn, str(folder_title))
        if folder is None:
            fail(errors, f"folder not found: {folder_title}")
            return 1
        ok(f"folder exists: {folder['folder_name']} (id={folder['folder_id']})")

        notes_by_title = fetch_notes(conn, int(folder["folder_id"]))
        note_count = sum(len(rows) for rows in notes_by_title.values())
        min_note_count = int(folder_expect.get("min_note_count") or 0)
        if note_count < min_note_count:
            fail(
                errors,
                f"folder note count < expected: actual={note_count}, expected>={min_note_count}",
            )
        else:
            ok(f"folder note count: actual={note_count}, expected>={min_note_count}")

        assets_expect = expected.get("expected_assets") or {}
        min_image_file_count = assets_expect.get("min_image_file_count")
        if min_image_file_count is not None:
            image_dir = db_path.parent / "images"
            image_file_count = len([path for path in image_dir.glob("*") if path.is_file()]) if image_dir.exists() else 0
            expected_count = int(min_image_file_count)
            if image_file_count < expected_count:
                fail(errors, f"image file count < expected actual={image_file_count}, expected>={expected_count}, dir={image_dir}")
            else:
                ok(f"image file count actual={image_file_count}, expected>={expected_count}")

        for note_expect in expected.get("expected_notes") or []:
            title = str(note_expect.get("title") or "")
            if not title:
                fail(errors, "expected note title is empty")
                continue

            rows = notes_by_title.get(title) or []
            if not rows:
                fail(errors, f"note not found in folder {folder_title}: {title}")
                continue

            # Newer duplicate title wins for robustness, but normal scenario titles are unique.
            row = rows[-1]
            meta, text = parse_metadata(row["meta_data"])
            ok(f"note exists: {title} (id={row['note_id']})")

            expected_format = note_expect.get("format")
            if expected_format is not None:
                actual_format = meta.get("format")
                if actual_format != expected_format:
                    fail(
                        errors,
                        f"{title}: format mismatch actual={actual_format!r}, expected={expected_format!r}",
                    )
                else:
                    ok(f"{title}: format={actual_format}")

            expected_schema = note_expect.get("schemaVersion")
            if expected_schema is not None:
                actual_schema = meta.get("schemaVersion")
                if actual_schema != expected_schema:
                    fail(
                        errors,
                        f"{title}: schemaVersion mismatch actual={actual_schema!r}, expected={expected_schema!r}",
                    )
                else:
                    ok(f"{title}: schemaVersion={actual_schema}")

            assert_note_content(title, note_expect, meta, text, errors, db_path.parent)
    finally:
        conn.close()

    if errors:
        print(f"\nDB assertion failed: {len(errors)} error(s)")
        return 1

    print("\nDB assertion passed")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "expected",
        type=Path,
        help="expected YAML template path, e.g. tests/at/expected/tiptap_scenario_002_expected.yaml",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=default_db_path(),
        help="deepin-voice-note sqlite DB path",
    )
    args = parser.parse_args(argv)

    try:
        expected = load_expected(args.expected)
    except Exception as exc:
        print(f"ERROR: failed to load expected template: {exc}", file=sys.stderr)
        return 2
    return assert_db(expected, args.db)


if __name__ == "__main__":
    raise SystemExit(main())
