#!/usr/bin/env python3
"""Open deepin-voice-note's QML title-bar menu, optionally select one item.

This helper is intentionally selector/action based: it locates the application
through AT-SPI, finds the named WebViewTitleBar node, invokes the first visible
child button's AT-SPI Press action, and can invoke a menu item's Press action by
its accessible name. It does not use screen coordinates.
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
    result = []
    for i in range(count):
        try:
            child = node.get_child_at_index(i)
        except Exception:
            continue
        if child is not None:
            result.append(child)
    return result


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


def _visible_extents(node):
    try:
        ext = node.get_extents(Atspi.CoordType.SCREEN)
    except Exception:
        return None
    if ext.width <= 0 or ext.height <= 0:
        return None
    return ext


def _visible(node) -> bool:
    return _visible_extents(node) is not None


def _find_app(app_name: str):
    desktop = Atspi.get_desktop(0)
    for app in _children(desktop):
        if _name(app) == app_name:
            return app
    raise RuntimeError(f"application not found: {app_name}")


def _find_by_name(root, name: str, visible: bool = False):
    for node in _walk(root):
        if _name(node) == name and (not visible or _visible(node)):
            return node
    suffix = " visible" if visible else ""
    raise RuntimeError(f"AT-SPI{suffix} node not found by name: {name}")


def _press(node) -> None:
    try:
        n_actions = node.get_n_actions()
    except Exception as exc:
        raise RuntimeError(f"node has no actions: {_name(node)}") from exc
    if n_actions <= 0:
        raise RuntimeError(f"node action count is 0: {_name(node)}")

    # Prefer the explicit Press action when provided by Qt/DTK.
    for index in range(n_actions):
        try:
            if (node.get_action_name(index) or "").lower() == "press":
                node.do_action(index)
                return
        except Exception:
            continue
    node.do_action(0)


def _pointer_click(x: int, y: int) -> None:
    """Real pointer click. AT-SPI Press does not emit RadioButton.onClicked."""
    import subprocess
    from ctypes import CDLL, c_int, c_uint, c_ulong, c_void_p

    try:
        subprocess.check_call(
            ["xdotool", "mousemove", "--sync", str(x), str(y), "click", "1"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass

    x11 = CDLL("libX11.so.6")
    xtst = CDLL("libXtst.so.6")
    x11.XOpenDisplay.argtypes = [c_void_p]
    x11.XOpenDisplay.restype = c_void_p
    x11.XDefaultRootWindow.argtypes = [c_void_p]
    x11.XDefaultRootWindow.restype = c_ulong
    x11.XWarpPointer.argtypes = [
        c_void_p, c_ulong, c_ulong, c_int, c_int, c_uint, c_uint, c_int, c_int,
    ]
    x11.XFlush.argtypes = [c_void_p]
    x11.XCloseDisplay.argtypes = [c_void_p]
    xtst.XTestFakeButtonEvent.argtypes = [c_void_p, c_uint, c_int, c_ulong]
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError("cannot open X display to click InternalRadioButton")
    root = x11.XDefaultRootWindow(display)
    x11.XWarpPointer(display, c_ulong(0), root, 0, 0, 0, 0, x, y)
    xtst.XTestFakeButtonEvent(display, 1, 1, 0)
    x11.XFlush(display)
    time.sleep(0.05)
    xtst.XTestFakeButtonEvent(display, 1, 0, 0)
    x11.XFlush(display)
    x11.XCloseDisplay(display)


def _saved_audio_source():
    import os

    path = os.path.expanduser("~/.config/deepin/deepin-voice-note/config.conf")
    try:
        text = open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        return None
    for raw in text.splitlines():
        line = raw.replace(" ", "")
        if "audiosource.select=" in line or line.startswith("select="):
            try:
                return int(line.rsplit("=", 1)[1])
            except ValueError:
                continue
    return None


def _select_internal_radio(app, name: str, timeout: float) -> None:
    target = _wait_for_name(app, name, timeout, visible=True)
    ext = _visible_extents(target)
    if ext is None:
        raise RuntimeError(f"{name} is not visible")
    x = int(ext.x + ext.width / 2)
    y = int(ext.y + ext.height / 2)
    _pointer_click(x, y)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _saved_audio_source() == 0:
            print(f"titlebar_menu_press.py: {name} selected internal audio", flush=True)
            return
        time.sleep(0.2)
    raise RuntimeError(f"{name} click did not switch audio source to internal")


def _wait_for_name(root, name: str, timeout: float, visible: bool = False):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            return _find_by_name(root, name, visible=visible)
        except RuntimeError as exc:
            last_error = exc
            time.sleep(0.1)
    suffix = " visible" if visible else ""
    raise last_error or RuntimeError(f"AT-SPI{suffix} node not found by name: {name}")


def _process_running(app_name: str) -> bool:
    """Return whether the real application process still exists.

    Match executable basename via /proc only.  Avoid `pgrep -f` on the full
    command line: the project path contains `deepin-voice-note`, and YouQu's
    assert_process_not_running uses a different `ps|grep` filter — a mismatch
    can make this helper exit 0 while the later assert still sees the app.
    """
    import os

    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            raw = open(f"/proc/{entry}/cmdline", "rb").read()
        except (OSError, PermissionError):
            continue
        if not raw:
            continue
        argv0 = raw.split(b"\0", 1)[0].decode(errors="ignore")
        if os.path.basename(argv0) == app_name:
            return True
    return False


def _wait_process_stopped(app_name: str, timeout: float) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not _process_running(app_name):
            return
        time.sleep(0.2)
    raise RuntimeError(f"application process did not stop within {timeout:.1f}s: {app_name}")


def open_titlebar_menu(app_name: str, timeout: float):
    app = _find_app(app_name)
    titlebar = _wait_for_name(app, "WebViewTitleBar", timeout, visible=True)
    buttons = [n for n in _walk(titlebar) if _role(n) == "button" and _visible(n)]
    if not buttons:
        raise RuntimeError("no visible button under WebViewTitleBar")
    _press(buttons[0])
    # QML Menu items can remain in the AT-SPI tree after a previous menu closes.
    # Treat the menu as opened only when the concrete item is visible.
    _wait_for_name(app, "SettingsMenuItem", timeout, visible=True)
    return app


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", default="deepin-voice-note")
    parser.add_argument("--select", help="accessible name of menu item to press after opening")
    parser.add_argument("--wait-visible", help="accessible name that must become visible after selection")
    parser.add_argument("--click-visible", help="visible accessible name to press after selection")
    parser.add_argument("--timeout", type=float, default=5.0)
    args = parser.parse_args()

    try:
        Atspi.init()
    except Exception:
        pass

    app = open_titlebar_menu(args.app, args.timeout)
    # TitleBarMenu is a QML Menu root and is not exposed stably by AT-SPI.
    # Wait for a concrete menu item instead.
    wait_name = args.select or "SettingsMenuItem"
    item = _wait_for_name(app, wait_name, args.timeout, visible=True)
    if args.select:
        try:
            _press(item)
        except Exception as exc:
            # Selecting ExitMenuItem closes the application immediately; some
            # AT-SPI backends report the disappearing app as an exception after
            # the Press action has already taken effect.
            if args.select == "ExitMenuItem" and "no longer exists" in str(exc):
                _wait_process_stopped(args.app, args.timeout)
                return 0
            raise
        if args.select == "ExitMenuItem":
            _wait_process_stopped(args.app, args.timeout)
            return 0
        if args.wait_visible:
            app = _find_app(args.app)
            _wait_for_name(app, args.wait_visible, args.timeout, visible=True)
        if args.click_visible == "InternalRadioButton":
            app = _find_app(args.app)
            _select_internal_radio(app, args.click_visible, args.timeout)
        elif args.click_visible:
            app = _find_app(args.app)
            target = _wait_for_name(app, args.click_visible, args.timeout, visible=True)
            _press(target)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"titlebar_menu_press.py: {exc}", file=sys.stderr)
        raise SystemExit(1)
