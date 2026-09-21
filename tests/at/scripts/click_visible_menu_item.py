#!/usr/bin/env python3
"""Press a visible AT-SPI menu item by accessible name.

Qt/QML menus can leave hidden/stale menu items in the AT-SPI tree.  The
standard selector may match a stale item with zero extents first.  This helper
keeps the user path unchanged (the suite must already have opened the real
context/menu) and presses the currently visible item only.

Names may be locale-dependent (e.g. 语音朗读 vs Text to Speech). Pass every
acceptable name; the first visible match wins.
"""
from __future__ import annotations

import argparse
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


def _find_visible_item(app, names: set[str], role: str | None):
    candidates = []
    for node in _walk(app):
        if _name(node) not in names:
            continue
        if role and _role(node) != role:
            continue
        ext = _extents(node)
        if ext is None:
            continue
        candidates.append((ext.y, ext.x, node))
    if not candidates:
        role_msg = f" role={role}" if role else ""
        raise RuntimeError(
            f"visible menu item not found: names={sorted(names)}{role_msg}"
        )
    candidates.sort(key=lambda item: (item[0], item[1]))
    return candidates[0][2]


def _dump_visible_menuish(app, limit: int = 40) -> str:
    rows = []
    for node in _walk(app):
        name = _name(node)
        if not name:
            continue
        role = _role(node)
        if role not in {"menu item", "menu", "check menu item", "radio menu item"}:
            continue
        ext = _extents(node)
        if ext is None:
            continue
        rows.append(f"{name!r}/{role}@{ext.x},{ext.y}")
        if len(rows) >= limit:
            break
    return ", ".join(rows) if rows else "(none)"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "names",
        nargs="+",
        help="acceptable accessible names (locale variants allowed)",
    )
    parser.add_argument("--app", default="deepin-voice-note")
    parser.add_argument(
        "--role",
        default="menu item",
        help="AT-SPI role filter; empty string disables role matching",
    )
    parser.add_argument("--timeout", type=float, default=5.0)
    args = parser.parse_args()
    names = {n for n in args.names if n}
    role = args.role or None

    try:
        Atspi.init()
    except Exception:
        pass

    deadline = time.time() + args.timeout
    last_error = None
    while time.time() < deadline:
        try:
            app = _find_app(args.app)
            # Prefer exact role match; if the toolkit exposes a different role
            # string, fall back to name+extents only within the same poll.
            try:
                item = _find_visible_item(app, names, role)
            except RuntimeError:
                if role is None:
                    raise
                item = _find_visible_item(app, names, None)
            _press(item)
            print(f"clicked visible menu item via AT-SPI: {_name(item)}")
            return 0
        except Exception as exc:
            last_error = exc
            time.sleep(0.1)

    detail = str(last_error) if last_error else f"timeout pressing {sorted(names)}"
    try:
        app = _find_app(args.app)
        detail = f"{detail}; visible menus: {_dump_visible_menuish(app)}"
    except Exception:
        pass
    raise RuntimeError(detail)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"click_visible_menu_item.py: {exc}", file=sys.stderr)
        raise SystemExit(1)
