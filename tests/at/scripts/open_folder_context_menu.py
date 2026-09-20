#!/usr/bin/env python3
"""Open deepin-voice-note folder-list context menu by runtime AT-SPI extents.

This keeps the test on the real user path: locate a visible folder row in
FolderListView, right-click it, then wait for a concrete QML menu item such as
RenameMenuItem.  It does not use fixed screen coordinates.
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
    raise RuntimeError(f"AT-SPI{suffix} node not found by name: {name}")


def _wait_name(app_name: str, name: str, timeout: float, visible: bool = False):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            return _find_by_name(_find_app(app_name), name, visible=visible)
        except Exception as exc:
            last = exc
            time.sleep(0.12)
    raise RuntimeError(str(last) if last else f"timeout waiting for {name}")


def _visible_folder_items(app):
    list_view = _find_by_name(app, "FolderListView", visible=True)
    rows = []
    for node in _walk(list_view):
        if node is list_view:
            continue
        ext = _ext(node)
        if ext is None:
            continue
        name = _name(node)
        role = _role(node)
        if name and role in {"list item", "label", "panel"} and ext.width >= 40 and ext.height >= 18:
            rows.append((ext.y, ext.x, name, role, node))
    result = []
    seen = set()
    for y, x, name, role, node in sorted(rows, key=lambda t: (t[0], t[1])):
        bucket = int(y / 8)
        if bucket in seen:
            continue
        seen.add(bucket)
        result.append(node)
    return result


def _right_click_center(node) -> None:
    ext = _ext(node)
    if ext is None:
        raise RuntimeError(f"node is not visible: {_name(node)}")
    x = int(ext.x + ext.width / 2)
    y = int(ext.y + ext.height / 2)
    subprocess.run(["xdotool", "mousemove", str(x), str(y), "click", "3"], check=True)
    time.sleep(0.4)


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", default="deepin-voice-note")
    parser.add_argument("--expect", default="RenameMenuItem")
    parser.add_argument("--index", type=int, default=0)
    parser.add_argument("--close", action="store_true")
    parser.add_argument("--click-expect", action="store_true", help="Press the expected menu item")
    parser.add_argument(
        "--wait-confirm",
        action="store_true",
        help="After clicking expect, wait for ConfirmButton (delete dialog)",
    )
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
            items = _visible_folder_items(app)
            if not items:
                raise RuntimeError("no visible folder item")
            target = items[min(args.index, len(items) - 1)]
            _right_click_center(target)
            item = _wait_name(args.app, args.expect, timeout=1.5, visible=True)
            if args.click_expect:
                _press(item)
                print(f"clicked folder menu item via AT-SPI: {args.expect}", flush=True)
                if args.wait_confirm:
                    _wait_name(args.app, "ConfirmButton", timeout=5.0, visible=True)
                    print("ConfirmButton visible after folder delete menu", flush=True)
            if args.close:
                subprocess.run(["xdotool", "key", "Escape"], check=True)
                time.sleep(0.2)
            return 0
        except Exception as exc:
            last = exc
            time.sleep(0.2)
    raise RuntimeError(f"folder context menu did not expose {args.expect}: {last}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"open_folder_context_menu.py: {exc}", file=sys.stderr)
        raise SystemExit(1)
