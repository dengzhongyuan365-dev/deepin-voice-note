#!/usr/bin/env python3
"""Open a visible note-row context menu and optionally activate one item.

Standalone AT-SPI helper: no YouQu/Dogtail import.  Suites only invoke this
script via `action: command`; the runner's Python path is irrelevant.
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
    # Note delegates and menu trees are shallow.  Avoid traversing the embedded
    # WebEngine subtree, which can block while it is rebuilding.
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


def _click_extents(ext, button: int) -> None:
    x = int(ext.x + ext.width / 2)
    y = int(ext.y + ext.height / 2)
    subprocess.run(["xdotool", "mousemove", str(x), str(y), "click", str(button)], check=True)


def _right_click(node) -> None:
    ext = _extents(node)
    if ext is None:
        raise RuntimeError(f"node is not visible: {_name(node)}")
    _click_extents(ext, 3)
    time.sleep(0.5)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", default="deepin-voice-note")
    parser.add_argument("--index", type=int, default=0)
    parser.add_argument("--expect", help="visible menu item name expected after right click")
    parser.add_argument("--click-expect", action="store_true")
    parser.add_argument("--cancel-after", action="store_true")
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    try:
        Atspi.init()
    except Exception:
        pass

    deadline = time.time() + args.timeout
    last = None
    while time.time() < deadline:
        try:
            app = _find_app(args.app)
            rows = _visible_note_items(app)
            if len(rows) <= args.index:
                raise RuntimeError(f"need visible note item at index {args.index}, got {len(rows)}")
            _right_click(rows[args.index])
            if not args.expect:
                return 0
            item = _wait_named(
                app, args.expect, min(2.0, max(0.2, deadline - time.time())), visible=True
            )
            if args.click_expect:
                _press(item)
                print(f"clicked visible menu item via AT-SPI: {args.expect}", flush=True)
                if args.cancel_after:
                    cancel = _wait_named(app, "CancelButton", 5.0, visible=True)
                    _press(cancel)
                    print("clicked CancelButton via AT-SPI", flush=True)
                elif args.expect == "删除":
                    _wait_named(app, "CancelButton", 5.0, visible=True)
                else:
                    time.sleep(0.5)
            return 0
        except Exception as exc:
            last = exc
            # Dismiss a stale popup before retrying the same concrete row.
            try:
                subprocess.run(["xdotool", "key", "Escape"], check=False)
            except Exception:
                pass
            time.sleep(0.2)
    raise RuntimeError(str(last) if last else "context menu operation timed out")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"open_note_context_menu.py: {exc}", file=sys.stderr)
        raise SystemExit(1)
