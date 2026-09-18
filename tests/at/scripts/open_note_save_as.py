#!/usr/bin/env python3
"""Open a note item's context menu and choose 保存笔记 -> 保存为TXT/保存为HTML.

The generic dtk_context_menu keyboard navigator is unstable for this QML
submenu. This helper keeps the real user path: right-click a visible note row,
hover the visible "保存笔记" menu item to open its submenu, then press the visible
submenu item. Coordinates are derived from the current AT-SPI extents, not fixed.
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
        return [node.get_child_at_index(i) for i in range(node.get_child_count()) if node.get_child_at_index(i) is not None]
    except Exception:
        return []


def _walk(node):
    yield node
    for child in _children(node):
        yield from _walk(child)


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


def _ext(node):
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


def _find_by_name(root, name: str, visible: bool = False):
    for node in _walk(root):
        if _name(node) == name and (not visible or _ext(node) is not None):
            return node
    raise RuntimeError(f"node not found: {name} visible={visible}")


def _wait_name(root_getter, name: str, timeout: float, visible: bool = True):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            return _find_by_name(root_getter(), name, visible=visible)
        except Exception as exc:
            last = exc
            time.sleep(0.1)
    raise RuntimeError(str(last) if last else f"timeout waiting {name}")


def _visible_note_items(app):
    list_view = _find_by_name(app, "NoteItemListView")
    items = []
    for node in _walk(list_view):
        if node is list_view:
            continue
        ext = _ext(node)
        if ext is None:
            continue
        role = _role(node)
        name = _name(node)
        if name and role in {"list item", "label", "panel"} and ext.width >= 40 and ext.height >= 20:
            items.append((ext.y, node))
    result, seen = [], set()
    for y, node in sorted(items, key=lambda pair: pair[0]):
        bucket = int(y / 8)
        if bucket in seen:
            continue
        seen.add(bucket)
        result.append(node)
    return result


def _move_click(ext, button: int = 1):
    x = int(ext.x + ext.width / 2)
    y = int(ext.y + ext.height / 2)
    subprocess.run(["xdotool", "mousemove", str(x), str(y), "click", str(button)], check=True)
    time.sleep(0.3)


def _move_to(ext):
    x = int(ext.x + ext.width / 2)
    y = int(ext.y + ext.height / 2)
    subprocess.run(["xdotool", "mousemove", str(x), str(y)], check=True)
    time.sleep(0.5)


def _press(node):
    try:
        n = node.get_n_actions()
    except Exception:
        n = 0
    for i in range(n):
        try:
            if (node.get_action_name(i) or "").lower() == "press":
                node.do_action(i)
                return
        except Exception:
            pass
    ext = _ext(node)
    if ext is None:
        raise RuntimeError(f"visible extents missing for {_name(node)}")
    _move_click(ext, 1)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=["保存为TXT", "保存为HTML"])
    parser.add_argument("--app", default="deepin-voice-note")
    parser.add_argument("--index", type=int, default=0)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    try:
        Atspi.init()
    except Exception:
        pass

    app = _find_app(args.app)
    items = _visible_note_items(app)
    if len(items) <= args.index:
        raise RuntimeError(f"need visible note item at index {args.index}, got {len(items)}")
    ext = _ext(items[args.index])
    if ext is None:
        raise RuntimeError("note item has no visible extents")
    _move_click(ext, 3)

    root_getter = lambda: _find_app(args.app)
    save_note = _wait_name(root_getter, "保存笔记", args.timeout, visible=True)
    save_ext = _ext(save_note)
    if save_ext is None:
        raise RuntimeError("保存笔记 has no visible extents")
    _move_to(save_ext)

    target = _wait_name(root_getter, args.target, args.timeout, visible=True)
    _press(target)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"open_note_save_as.py: {exc}", file=sys.stderr)
        raise SystemExit(1)
