#!/usr/bin/env python3
"""Assert the save-note flow is not triggerable for an empty note.

The script creates/selects an empty note through the real UI, opens the note row
context menu, hovers "保存笔记" when present, and verifies the save entry is not
enabled or no concrete TXT/HTML save item is exposed.  It also verifies no file
dialog is shown.  Text-note TXT/HTML availability is covered by save_exp_001.
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
    suffix = " visible" if visible else ""
    raise RuntimeError(f"node not found: {name}{suffix}")


def _wait_name(app_name: str, name: str, timeout: float, visible: bool = True):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            return _find_by_name(_find_app(app_name), name, visible=visible)
        except Exception as exc:
            last = exc
            time.sleep(0.1)
    raise RuntimeError(str(last) if last else f"timeout waiting {name}")


def _press(node) -> None:
    try:
        n = node.get_n_actions()
    except Exception:
        n = 0
    for i in range(max(n, 0)):
        try:
            if (node.get_action_name(i) or "").lower() in {"press", "click", "activate"}:
                node.do_action(i)
                time.sleep(0.25)
                return
        except Exception:
            continue
    if n > 0:
        node.do_action(0)
        time.sleep(0.25)
        return
    ext = _ext(node)
    if ext is None:
        raise RuntimeError(f"node has no action and no extents: {_name(node)}")
    _click_ext(ext, 1)


def _click_ext(ext, button: int = 1):
    x = int(ext.x + ext.width / 2)
    y = int(ext.y + ext.height / 2)
    subprocess.run(["xdotool", "mousemove", str(x), str(y), "click", str(button)], check=True)
    time.sleep(0.35)


def _move_ext(ext):
    x = int(ext.x + ext.width / 2)
    y = int(ext.y + ext.height / 2)
    subprocess.run(["xdotool", "mousemove", str(x), str(y)], check=True)
    time.sleep(0.5)


def _visible_note_items(app):
    list_view = _find_by_name(app, "NoteItemListView", visible=True)
    rows = []
    for node in _walk(list_view):
        if node is list_view:
            continue
        ext = _ext(node)
        if ext is None:
            continue
        name = _name(node)
        role = _role(node)
        if name and role in {"list item", "label", "panel"} and ext.width >= 40 and ext.height >= 20:
            rows.append((ext.y, node))
    out, seen = [], set()
    for y, node in sorted(rows, key=lambda t: t[0]):
        bucket = int(y / 8)
        if bucket in seen:
            continue
        seen.add(bucket)
        out.append(node)
    return out


def _state_enabled(node) -> bool:
    try:
        states = node.get_state_set()
        return bool(states.contains(Atspi.StateType.ENABLED) and states.contains(Atspi.StateType.SENSITIVE))
    except Exception:
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", default="deepin-voice-note")
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    try:
        Atspi.init()
    except Exception:
        pass

    app = _find_app(args.app)
    _press(_find_by_name(app, "NewNoteButton", visible=True))
    time.sleep(0.8)
    items = _visible_note_items(_find_app(args.app))
    if not items:
        raise RuntimeError("no visible note item after creating empty note")
    ext = _ext(items[0])
    if ext is None:
        raise RuntimeError("empty note item has no extents")
    _click_ext(ext, 3)

    save_note = _wait_name(args.app, "保存笔记", args.timeout, visible=True)
    save_ext = _ext(save_note)
    if save_ext is None:
        raise RuntimeError("保存笔记 has no extents")

    save_note_enabled = _state_enabled(save_note)
    _move_ext(save_ext)

    txt_enabled = False
    html_enabled = False
    # For an empty note the product may either disable the parent menu or avoid
    # exposing enabled submenu items.  Both mean the save flow cannot be used.
    try:
        txt = _wait_name(args.app, "保存为TXT", 1.5, visible=True)
        txt_enabled = _state_enabled(txt)
    except Exception:
        txt_enabled = False
    try:
        html = _wait_name(args.app, "保存为HTML", 1.5, visible=True)
        html_enabled = _state_enabled(html)
    except Exception:
        html_enabled = False

    if save_note_enabled and (txt_enabled or html_enabled):
        raise RuntimeError("empty note exposes enabled save entries")

    # Verify no file-dialog controls are visible.
    app = _find_app(args.app)
    for name in ("FileNameEdit", "fileNameEdit", "保存", "Save"):
        try:
            node = _find_by_name(app, name, visible=True)
            raise RuntimeError(f"unexpected file dialog/control visible: {name} role={_role(node)}")
        except RuntimeError as exc:
            if "unexpected file dialog" in str(exc):
                raise
    subprocess.run(["xdotool", "key", "Escape"], check=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"assert_empty_note_save_disabled.py: {exc}", file=sys.stderr)
        raise SystemExit(1)
