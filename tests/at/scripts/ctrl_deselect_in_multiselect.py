#!/usr/bin/env python3
"""Enter multi-select with 3 notes, then Ctrl+click one selected row to deselect.

Standalone AT-SPI helper: no YouQu/Dogtail import. Suites invoke via `action: command`.
After deselecting one of three, MultipleChoicesView should remain visible.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
import warnings
from collections.abc import Iterable

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

warnings.filterwarnings("ignore", category=DeprecationWarning)


def _children(node) -> Iterable:
    try:
        count = node.get_child_count()
    except Exception:
        return []
    out = []
    for i in range(count):
        try:
            child = node.get_child_at_index(i)
        except Exception:
            continue
        if child is not None:
            out.append(child)
    return out


def _walk(node, depth: int = 0):
    yield node
    if depth >= 6:
        return
    for child in _children(node):
        yield from _walk(child, depth + 1)


def _name(node) -> str:
    try:
        return node.get_name() or ""
    except Exception:
        return ""


def _role(node) -> str:
    try:
        return node.get_role_name() or ""
    except Exception:
        return ""


def _extents(node):
    try:
        ext = node.get_extents(Atspi.CoordType.SCREEN)
    except Exception:
        return None
    if ext.width <= 0 or ext.height <= 0:
        return None
    return ext


def _find_app(app_name: str):
    desktop = Atspi.get_desktop(0)
    for app in _children(desktop):
        if _name(app) == app_name:
            return app
    raise RuntimeError(f"application not found: {app_name}")


def _find_named(app, name: str, visible: bool = True):
    for node in _walk(app):
        if _name(node) != name:
            continue
        if visible and _extents(node) is None:
            continue
        return node
    raise RuntimeError(f"node not found: {name}")


def _wait_named(app, name: str, timeout: float, visible: bool = True):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            return _find_named(app, name, visible)
        except Exception as exc:
            last = exc
            time.sleep(0.1)
    raise RuntimeError(str(last) if last else f"timeout waiting {name}")


def _press(node) -> None:
    try:
        n_actions = node.get_n_actions()
    except Exception as exc:
        raise RuntimeError(f"node has no actions: {_name(node)}") from exc
    if n_actions <= 0:
        raise RuntimeError(f"node action count is 0: {_name(node)}")
    for i in range(n_actions):
        try:
            if (node.get_action_name(i) or "").lower() == "press":
                node.do_action(i)
                return
        except Exception:
            continue
    node.do_action(0)


def _visible_note_items(app):
    list_view = _find_named(app, "NoteItemListView", visible=True)
    list_ext = _extents(list_view)
    rows = []
    for node in _walk(list_view):
        if node is list_view or _role(node) != "list item":
            continue
        ext = _extents(node)
        if ext is None or not _name(node):
            continue
        if list_ext:
            if not (
                list_ext.x <= ext.x < list_ext.x + list_ext.width
                and list_ext.y <= ext.y < list_ext.y + list_ext.height
            ):
                continue
        if ext.width >= 40 and ext.height >= 20:
            rows.append((ext.y, ext.x, node))
    rows.sort(key=lambda item: (item[0], item[1]))
    result = []
    seen = set()
    for y, _x, node in rows:
        bucket = int(y / 8)
        if bucket in seen:
            continue
        seen.add(bucket)
        result.append(node)
    return result


def _click_extents(ext, modifiers=()) -> None:
    x = int(ext.x + ext.width / 2)
    y = int(ext.y + ext.height / 2)
    for key in modifiers:
        subprocess.run(["xdotool", "keydown", key], check=True)
    try:
        subprocess.run(["xdotool", "mousemove", str(x), str(y), "click", "1"], check=True)
    finally:
        for key in reversed(tuple(modifiers)):
            subprocess.run(["xdotool", "keyup", key], check=True)
    time.sleep(0.4)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", default="deepin-voice-note")
    parser.add_argument("--timeout", type=float, default=12.0)
    args = parser.parse_args()

    try:
        Atspi.init()
    except Exception:
        pass

    app = _find_app(args.app)
    for _ in range(3):
        new_btn = _wait_named(app, "NewNoteButton", args.timeout, visible=True)
        _press(new_btn)
        time.sleep(0.45)
        app = _find_app(args.app)

    deadline = time.time() + args.timeout
    items = []
    while time.time() < deadline:
        app = _find_app(args.app)
        items = _visible_note_items(app)
        if len(items) >= 3:
            break
        time.sleep(0.2)
    if len(items) < 3:
        raise RuntimeError(f"need at least three visible note items, got {len(items)}")

    first = _extents(items[0])
    third = _extents(items[2])
    second = _extents(items[1])
    if first is None or second is None or third is None:
        raise RuntimeError("selected note rows are not visible")

    _click_extents(first)
    _click_extents(third, modifiers=("Shift_L",))
    _wait_named(_find_app(args.app), "MultipleChoicesView", args.timeout, visible=True)

    # Ctrl+click a selected middle row to cancel that selection; multi-select remains.
    _click_extents(second, modifiers=("Control_L",))
    _wait_named(_find_app(args.app), "MultipleChoicesView", args.timeout, visible=True)
    print("ctrl-deselected one note; MultipleChoicesView still visible", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ctrl_deselect_in_multiselect.py: {exc}", file=sys.stderr)
        raise SystemExit(1)
